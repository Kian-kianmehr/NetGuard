import { readFile, writeFile, unlink } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(scriptDir, "../dist");
const htmlPath = resolve(distDir, "index.html");
let html = await readFile(htmlPath, "utf8");

function resolveAsset(assetUrl) {
  const relativePath = assetUrl.replace(/^\/+/, "");
  const assetPath = resolve(distDir, relativePath);
  if (!assetPath.startsWith(distDir + sep)) {
    throw new Error(`Refusing to inline asset outside dist: ${assetUrl}`);
  }
  return assetPath;
}

// Inline the production stylesheet so the browser does not need a second
// network request after receiving the dashboard document.
const stylesheetPattern = /<link\b(?=[^>]*\brel=["']stylesheet["'])([^>]*?)\bhref=(["'])([^"']+\.css(?:\?[^"']*)?)\2([^>]*)\/?>/i;
const stylesheetMatch = html.match(stylesheetPattern);
if (stylesheetMatch) {
  const cssPath = resolveAsset(stylesheetMatch[3]);
  const css = await readFile(cssPath, "utf8");
  const mediaMatch = `${stylesheetMatch[1]} ${stylesheetMatch[4]}`.match(/\bmedia=(["'])(.*?)\1/i);
  const mediaAttribute = mediaMatch ? ` media="${mediaMatch[2]}"` : "";
  const inlineStyle = `<style${mediaAttribute}>${css.replace(/<\/style/gi, "<\\/style")}</style>`;
  html = html.replace(stylesheetMatch[0], inlineStyle);
  await unlink(cssPath);
  console.log("Inlined production CSS into dist/index.html");
}

// Inline the single Vite entry bundle. This avoids a separate JS asset request,
// which was being interrupted by ERR_NETWORK_CHANGED in some browsers.
const scriptPattern = /<script\b(?=[^>]*\btype=["']module["'])([^>]*?)\bsrc=(["'])([^"']+\.js(?:\?[^"']*)?)\2([^>]*)>\s*<\/script>/i;
const scriptMatch = html.match(scriptPattern);
if (!scriptMatch) {
  throw new Error("Could not find the production Vite module entry in dist/index.html");
}
const jsPath = resolveAsset(scriptMatch[3]);
const js = await readFile(jsPath, "utf8");
const attributes = `${scriptMatch[1]} ${scriptMatch[4]}`.replace(/\s+crossorigin(?:=(["']).*?\1)?/i, "");
const safeJs = js.replace(/<\/script/gi, "<\\/script");
html = html.replace(scriptMatch[0], `<script${attributes}>${safeJs}</script>`);
await unlink(jsPath);
await writeFile(htmlPath, html, "utf8");
console.log("Inlined production JavaScript into dist/index.html");
console.log(`Final HTML size: ${Buffer.byteLength(html)} bytes`);
