import { describe, it, expect } from "vitest";
import { decisionKey } from "../src/permission";

describe("decisionKey", () => {
  it("is independent of origin order", () => {
    expect(decisionKey("Tool", ["https://b.test", "https://a.test"])).toBe(
      decisionKey("Tool", ["https://a.test", "https://b.test"]),
    );
  });

  it("changes when the requested origin set changes (re-prompt)", () => {
    expect(decisionKey("Tool", ["https://a.test"])).not.toBe(
      decisionKey("Tool", ["https://a.test", "https://b.test"]),
    );
  });

  it("changes with the bundle name", () => {
    expect(decisionKey("A", ["https://x.test"])).not.toBe(decisionKey("B", ["https://x.test"]));
  });
});
