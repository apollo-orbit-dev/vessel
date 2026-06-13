import { describe, it, expect } from "vitest";
import { allowedOrigins, isEgressAllowed, installEgressPolicy } from "@vessel/core";
import { bundleCsp } from "../src/iframe";

const manifest = (network?: string[]) =>
  ({
    format_version: 1,
    name: "T",
    version: "0",
    ui: "ui/index.html",
    backend: "app.main:app",
    data: "data/store.sqlite",
    capabilities: network ? { network } : undefined,
  }) as any;

describe("allowedOrigins", () => {
  it("reduces declared https URLs to distinct origins", () => {
    expect(allowedOrigins(manifest(["https://api.weather.gov/points/1", "https://api.weather.gov/x"]))).toEqual([
      "https://api.weather.gov",
    ]);
  });
  it("is empty when no network is declared", () => {
    expect(allowedOrigins(manifest())).toEqual([]);
  });
});

describe("isEgressAllowed", () => {
  const allowed = new Set(["https://api.weather.gov"]);
  it("allows an https URL on an allowed origin", () => {
    expect(isEgressAllowed("https://api.weather.gov/x", allowed)).toBe(true);
  });
  it.each([
    ["other origin", "https://evil.test/x"],
    ["http (not https)", "http://api.weather.gov/x"],
    ["relative url", "/api/note"],
    ["garbage", "not a url"],
  ])("denies %s", (_l, url) => {
    expect(isEgressAllowed(url, allowed)).toBe(false);
  });
  it("denies everything when the allowlist is empty (default-deny)", () => {
    expect(isEgressAllowed("https://api.weather.gov/x", new Set())).toBe(false);
  });
});

describe("installEgressPolicy", () => {
  function fakeTarget() {
    const target: any = {
      fetch: (input: any) => Promise.resolve(`REAL:${typeof input === "string" ? input : input.url}`),
    };
    target.XMLHttpRequest = function () {} as any;
    target.XMLHttpRequest.prototype.open = function (this: any, _m: string, u: string) {
      this.url = u;
    };
    return target;
  }

  it("passes through allowed fetch and rejects the rest", async () => {
    const t = fakeTarget();
    installEgressPolicy(t, new Set(["https://api.weather.gov"]));
    await expect(t.fetch("https://api.weather.gov/x")).resolves.toContain("REAL:");
    await expect(t.fetch("https://evil.test/x")).rejects.toThrow(/not allowed/);
  });

  it("gates XMLHttpRequest.open the same way", () => {
    const t = fakeTarget();
    installEgressPolicy(t, new Set(["https://api.weather.gov"]));
    expect(() => new t.XMLHttpRequest().open("GET", "https://api.weather.gov/y")).not.toThrow();
    expect(() => new t.XMLHttpRequest().open("GET", "https://evil.test/y")).toThrow(/not allowed/);
  });
});

describe("bundleCsp", () => {
  it("is connect-src 'none' with no network", () => {
    expect(bundleCsp([])).toContain("connect-src 'none'");
  });
  it("lists allowed origins in connect-src", () => {
    expect(bundleCsp(["https://api.weather.gov"])).toContain("connect-src https://api.weather.gov");
  });
});
