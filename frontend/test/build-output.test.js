import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const distDirectory = fileURLToPath(new URL("../dist/", import.meta.url));

test("production HTML has no external JavaScript or stylesheet bootstrap requests", async () => {
  const html = await readFile(path.join(distDirectory, "index.html"), "utf8");
  const markupOnly = html.replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, "$1$2");

  assert.match(markupOnly, /<script\b[^>]*type="module"[^>]*>[\s\S]*?<\/script>/i);
  assert.doesNotMatch(markupOnly, /<script\b[^>]*\bsrc=/i);
  assert.doesNotMatch(markupOnly, /<link\b(?=[^>]*\brel=["']stylesheet["'])/i);
  assert.doesNotMatch(markupOnly, /<link\b(?=[^>]*\brel=["']modulepreload["'])/i);

  let assetFiles = [];
  try {
    assetFiles = await readdir(path.join(distDirectory, "assets"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  assert.deepEqual(
    assetFiles.filter((name) => /\.(?:m?js|css)(?:\.map)?$/i.test(name)),
    [],
    "JavaScript and CSS should be embedded into the production HTML."
  );
});
