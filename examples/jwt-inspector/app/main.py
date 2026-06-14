"""JWT Inspector — decode and verify JSON Web Tokens entirely on your machine.

The showcase angle: you should never paste a real token into a random website,
because that site now has your token. A Vessel runs locally — the token never
leaves your machine. This bundle declares **no** network capability at all
(there is no `capabilities.network` in the manifest), so the host's default-deny
egress means neither the Python backend nor the UI can phone home. The token you
inspect goes from the iframe UI, over the in-process ASGI bridge, into this
CPython-on-WebAssembly backend, and nowhere else.

What it does:
  * base64url-decodes the header + payload segments (correct `=` padding) and
    pretty-prints the JSON claims.
  * Renders `exp` / `iat` / `nbf` as absolute UTC time + a relative "expires in /
    expired N ago", and flags an expired or not-yet-valid token.
  * Verifies the signature:
      - HS256/384/512: stdlib `hmac` + `hashlib` with a user-supplied secret,
        compared in constant time (`hmac.compare_digest`).
      - RS256/384/512, PS256/384/512, ES256/384/512: against a user-supplied PEM
        public key using the `cryptography` library.
    With no key/secret supplied we just decode and report the signature as
    "not checked".
  * Persists a small, privacy-respecting history: alg + iss + sub + a label and
    the time inspected. It does NOT store the token or the secret by default;
    storing the raw token is opt-in per inspection (`store_token` checkbox) and
    is surfaced clearly in the UI. All SQLite access is parameterized.

Routes are `async def` because Pyodide has no OS threads — FastAPI would dispatch
a sync (`def`) route to a threadpool and raise "can't start new thread".
"""

import base64
import binascii
import hashlib
import hmac
import json
import sqlite3
import time

from fastapi import FastAPI
from pydantic import BaseModel, Field

DB = "data/store.sqlite"  # relative to the bundle root (the bridge chdir's into /bundle)
app = FastAPI()

# Limits — a JWT is a header.payload.signature triple of base64url text. We cap
# the whole thing well below anything that could choke the decoder.
MAX_TOKEN = 64 * 1024
MAX_SECRET = 8 * 1024
MAX_PEM = 16 * 1024
MAX_LABEL = 120

# Map of `alg` header value -> (family, hashlib hash name). Anything not here is
# reported as an unsupported / unknown algorithm rather than guessed at.
HMAC_ALGS = {"HS256": "sha256", "HS384": "sha384", "HS512": "sha512"}
RSA_ALGS = {"RS256": "sha256", "RS384": "sha384", "RS512": "sha512"}
PSS_ALGS = {"PS256": "sha256", "PS384": "sha384", "PS512": "sha512"}
EC_ALGS = {"ES256": "sha256", "ES384": "sha384", "ES512": "sha512"}

# Asymmetric verification needs the `cryptography` wheel. It is present in the
# pinned Pyodide 0.29.4 wheel set and is declared in the manifest's `packages`,
# so this import normally succeeds. We still guard it: if the wheel ever fails to
# load, the bundle degrades to HMAC-only verification instead of 500-ing, and the
# UI is told asymmetric verification is unavailable via /api/capabilities.
try:
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec, padding
    from cryptography.hazmat.primitives.asymmetric.ec import EllipticCurvePublicKey
    from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
    from cryptography.hazmat.primitives.asymmetric.utils import (
        decode_dss_signature,
        encode_dss_signature,
    )

    ASYMMETRIC_OK = True
except Exception as exc:  # pragma: no cover - defensive fallback
    ASYMMETRIC_OK = False
    _ASYMMETRIC_IMPORT_ERROR = str(exc)


def _con() -> sqlite3.Connection:
    con = sqlite3.connect(DB)
    con.execute(
        "CREATE TABLE IF NOT EXISTS history ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "label TEXT NOT NULL DEFAULT '', "
        "alg TEXT NOT NULL DEFAULT '', "
        "iss TEXT, "
        "sub TEXT, "
        "token TEXT, "  # NULL unless the user explicitly opted to store it
        "inspected_at TEXT NOT NULL DEFAULT (datetime('now')))"
    )
    con.commit()
    return con


def _b64url_decode(segment: str) -> bytes:
    """Decode a base64url JWT segment, adding the padding JWTs omit."""
    # JWT uses URL-safe base64 with the trailing '=' padding stripped.
    pad = (-len(segment)) % 4
    return base64.urlsafe_b64decode(segment + ("=" * pad))


def _decode_json_segment(segment: str) -> dict:
    raw = _b64url_decode(segment)
    obj = json.loads(raw.decode("utf-8"))
    if not isinstance(obj, dict):
        raise ValueError("segment is not a JSON object")
    return obj


def _hash_for(name: str):
    return {"sha256": hashes.SHA256, "sha384": hashes.SHA384, "sha512": hashes.SHA512}[name]()


class InspectIn(BaseModel):
    token: str = Field(min_length=1, max_length=MAX_TOKEN)
    secret: str = Field(default="", max_length=MAX_SECRET)
    public_key_pem: str = Field(default="", max_length=MAX_PEM)


class SaveIn(BaseModel):
    label: str = Field(default="", max_length=MAX_LABEL)
    token: str = Field(min_length=1, max_length=MAX_TOKEN)
    store_token: bool = False


@app.get("/api/capabilities")
async def capabilities():
    """Tell the UI which verification families this build can actually perform."""
    return {
        "hmac": True,
        "asymmetric": ASYMMETRIC_OK,
        "asymmetric_error": None if ASYMMETRIC_OK else _ASYMMETRIC_IMPORT_ERROR,
    }


def _verify(alg: str, signing_input: bytes, signature: bytes, secret: str, pem: str) -> dict:
    """Return a structured verification result.

    status is one of: "valid", "invalid", "not_checked", "unsupported", "error".
    """
    if alg == "none":
        return {"status": "unsupported", "detail": "Algorithm 'none' carries no signature."}

    if alg in HMAC_ALGS:
        if not secret:
            return {"status": "not_checked", "detail": "Provide the shared secret to verify HMAC."}
        digestmod = HMAC_ALGS[alg]
        expected = hmac.new(secret.encode("utf-8"), signing_input, digestmod).digest()
        # Constant-time comparison — never short-circuit on the first byte.
        ok = hmac.compare_digest(expected, signature)
        return {
            "status": "valid" if ok else "invalid",
            "detail": "HMAC matches the supplied secret." if ok else "HMAC does not match the supplied secret.",
        }

    is_asym = alg in RSA_ALGS or alg in PSS_ALGS or alg in EC_ALGS
    if is_asym:
        if not ASYMMETRIC_OK:
            return {
                "status": "unsupported",
                "detail": "Asymmetric verification is unavailable in this build.",
            }
        if not pem.strip():
            return {"status": "not_checked", "detail": "Provide a PEM public key to verify."}
        try:
            key = serialization.load_pem_public_key(pem.encode("utf-8"))
        except Exception as exc:
            return {"status": "error", "detail": f"Could not parse PEM public key: {exc}"}

        try:
            if alg in RSA_ALGS:
                if not isinstance(key, RSAPublicKey):
                    return {"status": "error", "detail": "Key is not an RSA public key for an RS* token."}
                key.verify(signature, signing_input, padding.PKCS1v15(), _hash_for(RSA_ALGS[alg]))
            elif alg in PSS_ALGS:
                if not isinstance(key, RSAPublicKey):
                    return {"status": "error", "detail": "Key is not an RSA public key for a PS* token."}
                h = _hash_for(PSS_ALGS[alg])
                key.verify(
                    signature,
                    signing_input,
                    padding.PSS(mgf=padding.MGF1(_hash_for(PSS_ALGS[alg])), salt_length=padding.PSS.DIGEST_LENGTH),
                    h,
                )
            else:  # EC_ALGS
                if not isinstance(key, EllipticCurvePublicKey):
                    return {"status": "error", "detail": "Key is not an EC public key for an ES* token."}
                # JWS ES* signatures are raw r||s; cryptography wants DER. Convert.
                half = len(signature) // 2
                if half * 2 != len(signature) or half == 0:
                    return {"status": "invalid", "detail": "Malformed ECDSA signature length."}
                r = int.from_bytes(signature[:half], "big")
                s = int.from_bytes(signature[half:], "big")
                der = encode_dss_signature(r, s)
                key.verify(der, signing_input, ec.ECDSA(_hash_for(EC_ALGS[alg])))
            return {"status": "valid", "detail": "Signature matches the supplied public key."}
        except InvalidSignature:
            return {"status": "invalid", "detail": "Signature does not match the supplied public key."}
        except Exception as exc:
            return {"status": "error", "detail": f"Verification error: {exc}"}

    return {"status": "unsupported", "detail": f"Unsupported or unknown algorithm: {alg!r}."}


@app.post("/api/inspect")
async def inspect(body: InspectIn):
    token = body.token.strip()
    parts = token.split(".")
    if len(parts) not in (2, 3):
        return {"ok": False, "error": "Not a JWT: expected 2 or 3 dot-separated segments."}

    try:
        header = _decode_json_segment(parts[0])
    except (binascii.Error, ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        return {"ok": False, "error": f"Could not decode header: {exc}"}
    try:
        payload = _decode_json_segment(parts[1])
    except (binascii.Error, ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        return {"ok": False, "error": f"Could not decode payload: {exc}"}

    alg = header.get("alg", "")
    if not isinstance(alg, str):
        alg = str(alg)

    # Build the time annotations for standard NumericDate claims.
    now = int(time.time())
    times = {}
    for claim in ("exp", "iat", "nbf"):
        val = payload.get(claim)
        if isinstance(val, (int, float)) and not isinstance(val, bool):
            times[claim] = {"value": int(val), "delta": int(val) - now}

    expired = False
    not_yet_valid = False
    if "exp" in times and times["exp"]["delta"] < 0:
        expired = True
    if "nbf" in times and times["nbf"]["delta"] > 0:
        not_yet_valid = True

    # Signature verification (only when there is a signature segment).
    if len(parts) == 3 and parts[2]:
        signing_input = (parts[0] + "." + parts[1]).encode("ascii")
        try:
            signature = _b64url_decode(parts[2])
        except (binascii.Error, ValueError):
            verification = {"status": "error", "detail": "Signature segment is not valid base64url."}
        else:
            verification = _verify(alg, signing_input, signature, body.secret, body.public_key_pem)
    else:
        verification = {"status": "unsupported", "detail": "Token has no signature segment."}

    return {
        "ok": True,
        "header": header,
        "payload": payload,
        "alg": alg,
        "times": times,
        "expired": expired,
        "not_yet_valid": not_yet_valid,
        "verification": verification,
    }


@app.get("/api/history")
async def list_history():
    con = _con()
    rows = con.execute(
        "SELECT id, label, alg, iss, sub, (token IS NOT NULL) AS has_token, inspected_at "
        "FROM history ORDER BY id DESC LIMIT 100"
    ).fetchall()
    con.close()
    return [
        {
            "id": r[0],
            "label": r[1],
            "alg": r[2],
            "iss": r[3],
            "sub": r[4],
            "has_token": bool(r[5]),
            "inspected_at": r[6],
        }
        for r in rows
    ]


@app.post("/api/history")
async def save_history(body: SaveIn):
    """Save metadata for an inspected token. The raw token is stored ONLY when
    store_token is true; otherwise just alg/iss/sub/label are kept."""
    token = body.token.strip()
    parts = token.split(".")
    if len(parts) < 2:
        return {"ok": False, "error": "Not a JWT."}
    try:
        header = _decode_json_segment(parts[0])
        payload = _decode_json_segment(parts[1])
    except Exception as exc:
        return {"ok": False, "error": f"Could not decode token: {exc}"}

    alg = str(header.get("alg", ""))
    iss = payload.get("iss")
    sub = payload.get("sub")
    iss = str(iss) if iss is not None else None
    sub = str(sub) if sub is not None else None
    stored_token = token if body.store_token else None

    con = _con()
    new_id = con.execute(
        "INSERT INTO history (label, alg, iss, sub, token) VALUES (?, ?, ?, ?, ?)",
        (body.label, alg, iss, sub, stored_token),
    ).lastrowid
    con.commit()
    con.close()
    return {"ok": True, "id": new_id}


@app.get("/api/history/{item_id}")
async def get_history_token(item_id: int):
    """Return the stored token for a history row, if one was saved."""
    con = _con()
    row = con.execute("SELECT token FROM history WHERE id = ?", (item_id,)).fetchone()
    con.close()
    if row is None:
        return {"ok": False, "error": "Not found."}
    return {"ok": True, "token": row[0]}


@app.delete("/api/history/{item_id}")
async def delete_history(item_id: int):
    con = _con()
    con.execute("DELETE FROM history WHERE id = ?", (item_id,))
    con.commit()
    con.close()
    return {"ok": True}
