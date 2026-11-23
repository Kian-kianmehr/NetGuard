import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const distDirectory = fileURLToPath(new URL("../dist/", import.meta.url));

test("production HTML references same-origin JavaScript and CSS assets", async () => {
  const html = await readFile(path.join(distDirectory, "index.html"), "utf8");
  const scriptTag = html.match(/<script\\b(?=[^>]*\\btype=["']module["'])[^>]*>/i)?.[0];
  const stylesheetTag = html.match(/<link\\b(?=[^>]*\\brel=["']stylesheet["'])[^>]*>/i)?.[0];
  const scriptSrc = scriptTag?.match(/\\bsrc=["']([^"']+)["']/i)?.[1];
  const stylesheetHref = stylesheetTag?.match(/\\bhref=["']([^"']+)["']/i)?.[1];

  assert.ok(scriptSrc, "Vite must emit an external module entry script.");
  assert.ok(stylesheetHref, "Vite must emit an external production stylesheet.");
  assert.ok(scriptSrc.startsWith("/assets/") && scriptSrc.endsWith(".js"));
  assert.ok(stylesheetHref.startsWith("/assets/") && stylesheetHref.endsWith(".css"));
  assert.match(html, /id=["']netguard-entry["']/i, "The boot recovery handler must retain its entry reference.");

  const assetFiles = await readdir(path.join(distDirectory, "assets"));
  assert.ok(assetFiles.includes(path.basename(scriptSrc.split("?")[0])));
  assert.ok(assetFiles.includes(path.basename(stylesheetHref.split("?")[0])));
});
