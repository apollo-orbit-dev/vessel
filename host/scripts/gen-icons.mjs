// Rasterize the host's SVG icons to the PNGs the web app manifest needs:
//   - app icons (icon-192/512.png, icon-32.png favicon fallback) from icon.svg
//   - maskable app icon (icon-maskable-512.png) from icon-maskable.svg
//   - .vessel file-type icons (vessel-file-16/32/48/256.png) from vessel-file.svg
//
// `sharp` is NOT a committed dependency (like Playwright). Install on demand:
//   npm i -D --no-save sharp
//   node host/scripts/gen-icons.mjs
// Commit the regenerated PNGs. Re-run only when the source SVGs change.
import sharp from "sharp";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PUB = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

// Render an SVG to a square PNG at `size`px. `intrinsic` is the SVG's width/height
// attribute so we pick a density that rasterizes ~1:1 (crisp, no up/downscale blur).
async function render(svg, intrinsic, out, size) {
  const density = Math.round((72 * size) / intrinsic);
  await sharp(join(PUB, svg), { density })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(join(PUB, out));
  console.log(`wrote public/${out} (${size}px)`);
}

// App mark (icon.svg: width/height 32). Transparent background.
await render("icon.svg", 32, "icon-32.png", 32);
await render("icon.svg", 32, "icon-192.png", 192);
await render("icon.svg", 32, "icon-512.png", 512);

// Maskable app icon (opaque bg baked into the SVG).
await render("icon-maskable.svg", 64, "icon-maskable-512.png", 512);

// .vessel document icon at the sizes Windows uses for file icons.
for (const s of [16, 32, 48, 256]) {
  await render("vessel-file.svg", 64, `vessel-file-${s}.png`, s);
}
