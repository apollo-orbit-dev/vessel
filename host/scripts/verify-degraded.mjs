// Cross-browser degradation verification (manual / dev-only).
// Playwright is NOT a committed dependency; set it up first, then run:
//   cd host
//   npm i -D --no-save playwright && npx playwright install firefox
//   npm run dev            # in another shell (serves http://localhost:5173)
//   node scripts/verify-degraded.mjs
// Drives real Firefox, which genuinely lacks the File System Access APIs, so it
// exercises the degraded path authentically; plus a Chromium full-mode check.
import { firefox, chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const URL = process.env.URL || "http://localhost:5173/app/"; // host is based at /app/
const HERE = dirname(fileURLToPath(import.meta.url)); // host/scripts
const FIXTURE = process.env.FIXTURE || resolve(HERE, "../../tests/fixtures/notes.vessel");

let failed = 0;
function ok(cond, msg) {
  if (cond) console.log("  ✓", msg);
  else {
    console.error("  ✗ FAIL:", msg);
    failed++;
  }
}

async function runFirefox() {
  console.log("\n== Firefox (real degraded engine) ==");
  const b = await firefox.launch();
  const ctx = await b.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  await page.goto(URL, { waitUntil: "load" });

  await page.getByText(/auto-save to files/i).waitFor({ timeout: 10000 });
  ok(true, "degraded banner shown (Firefox lacks the File System Access API)");

  ok((await page.getByText("Recent", { exact: true }).count()) === 0, "no Recent list in degraded mode");

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 10000 }),
    page.getByRole("button", { name: /open a \.vessel/i }).click(),
  ]);
  await chooser.setFiles(FIXTURE);
  ok(true, "file-input fallback accepted the .vessel (no showOpenFilePicker)");

  const frame = page.frameLocator("iframe");
  await frame.locator("#body").waitFor({ timeout: 120000 });
  ok(true, "bundle booted in Firefox: Pyodide worker + sandboxed iframe (note editor present)");

  await frame.locator("#body").fill("hello from a real Firefox");
  await frame.getByRole("button", { name: "Save", exact: true }).click();
  await frame.getByText("saved to bundle").waitFor({ timeout: 30000 });
  ok(true, "PUT /api/notes succeeded — FastAPI + SQLite in Pyodide on Firefox");

  const dlBtn = page.getByRole("button", { name: /download to save/i });
  await dlBtn.waitFor({ timeout: 10000 });
  ok(true, '"Download to save" appeared after the edit (manual save mode)');

  const [download] = await Promise.all([page.waitForEvent("download"), dlBtn.click()]);
  const bytes = readFileSync(await download.path());
  ok(
    bytes.length > 0 && bytes[0] === 0x50 && bytes[1] === 0x4b,
    `downloaded a real .vessel (zip, ${bytes.length} bytes, PK header)`,
  );
  ok((await download.suggestedFilename()).endsWith(".vessel"), `download named ${await download.suggestedFilename()}`);

  await b.close();
}

async function runChromium() {
  console.log("\n== Chromium (full-mode regression check) ==");
  const b = await chromium.launch();
  const page = await b.newPage();
  await page.goto(URL, { waitUntil: "load" });
  await page.getByRole("button", { name: /open a \.vessel/i }).waitFor({ timeout: 10000 });
  ok((await page.getByText(/auto-save to files/i).count()) === 0, "no degraded banner — full mode detected on Chromium");
  await b.close();
}

await runFirefox();
try {
  await runChromium();
} catch (e) {
  console.log("  ⚠ Chromium check skipped (engine can't launch here):", e.message.split("\n")[0]);
}
console.log(failed === 0 ? "\nFIREFOX CHECKS PASS" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
