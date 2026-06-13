import { describe, it, expect } from "vitest";
import { contentType, injectReloadScript } from "../src/commands/dev";

describe("dev server helpers", () => {
  it("maps extensions to content types", () => {
    expect(contentType("ui/index.html")).toBe("text/html");
    expect(contentType("a/b.css")).toBe("text/css");
    expect(contentType("x.svg")).toBe("image/svg+xml");
    expect(contentType("weird.xyz")).toBe("application/octet-stream");
  });

  it("injects the live-reload client before </body>", () => {
    const out = injectReloadScript("<html><body><h1>hi</h1></body></html>");
    expect(out).toContain("EventSource(\"/__vessel_reload\")");
    expect(out.indexOf("EventSource")).toBeLessThan(out.indexOf("</body>"));
  });

  it("appends the client when there is no </body>", () => {
    expect(injectReloadScript("<h1>hi</h1>")).toContain("EventSource");
  });
});
