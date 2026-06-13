import { describe, it, expect } from "vitest";
import { newBridgeToken, parseRequestMessage, bridgeShim } from "../src/bridge";
import { BUNDLE_CSP, injectIntoHead } from "../src/iframe";

describe("newBridgeToken", () => {
  it("returns distinct 128-bit hex tokens", () => {
    const a = newBridgeToken();
    const b = newBridgeToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe("parseRequestMessage", () => {
  const token = "tok123";
  const good = { __vessel: "request", token, id: "1", method: "GET", path: "/api/note", headers: { a: "b" }, body: null };

  it("accepts a well-formed, token-matched request", () => {
    const r = parseRequestMessage(good, token);
    expect(r).not.toBeNull();
    expect(r!.req).toEqual({ method: "GET", path: "/api/note", headers: { a: "b" }, body: null });
  });

  it.each([
    ["wrong token", { ...good, token: "nope" }],
    ["wrong __vessel tag", { ...good, __vessel: "response" }],
    ["missing method", { ...good, method: undefined }],
    ["bad method", { ...good, method: "GET; rm -rf" }],
    ["non-/ path", { ...good, path: "api/note" }],
    ["non-string body becomes null but path empty", { ...good, path: "" }],
    ["not an object", "string"],
    ["null", null],
  ])("rejects %s", (_label, bad) => {
    expect(parseRequestMessage(bad, token)).toBeNull();
  });

  it("drops non-string header values and caps body to string|null", () => {
    const r = parseRequestMessage({ ...good, headers: { ok: "x", bad: 5 }, body: 42 }, token);
    expect(r!.req.headers).toEqual({ ok: "x" });
    expect(r!.req.body).toBeNull();
  });
});

describe("bridgeShim", () => {
  it("embeds the token and gates responses on it; no bare wildcard accept", () => {
    const shim = bridgeShim("abc123");
    expect(shim).toContain('"abc123"');
    expect(shim).toContain("m.token !== TOKEN");
    expect(shim).toContain("__vessel");
  });
});

describe("CSP + injection", () => {
  it("blocks real egress and all-by-default", () => {
    expect(BUNDLE_CSP).toContain("default-src 'none'");
    expect(BUNDLE_CSP).toContain("connect-src 'none'");
  });

  it("injects right after <head>", () => {
    const out = injectIntoHead("<!doctype html><html><head><title>t</title></head><body></body></html>", "INJ");
    expect(out).toBe("<!doctype html><html><head>INJ<title>t</title></head><body></body></html>");
  });

  it("falls back to after <html> when no head", () => {
    expect(injectIntoHead("<html><body>x</body></html>", "INJ")).toBe("<html>INJ<body>x</body></html>");
  });

  it("prepends when neither head nor html present", () => {
    expect(injectIntoHead("<body>x</body>", "INJ")).toBe("INJ<body>x</body>");
  });
});
