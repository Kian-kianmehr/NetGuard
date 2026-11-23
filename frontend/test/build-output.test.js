import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const distDirectory = fileURLToPath(new URL("../dist/", import.meta.url));

test("production HTML references generated same-origin JavaScript and CSS assets", async () => {
  const html = await readFile(path.join(distDirectory, "index.html"), "utf8");
  const script = html.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/i);
  const stylesheet = html.match(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/i);

  assert.ok(script, "Vite must emit an external module entry script.");
  assert.ok(stylesheet, "Vite must emit a production stylesheet.");
  assert.ok(script[1].startsWith("/assets/") && script[1].endsWith(".js"));
  assert.ok(stylesheet[1].startsWith("/assets/") && stylesheet[1].endsWith(".css"));

  const assetFiles = await readdir(path.join(distDirectory, "assets"));
  assert.ok(assetFiles.includes(path.basename(script[1].split("?")[0])));
  assert.ok(assetFiles.includes(path.basename(stylesheet[1].split("?")[0])));
});
