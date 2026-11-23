import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const distDirectory = fileURLToPath(new URL("../dist/", import.meta.url));

test("production HTML contains a self-contained application bootstrap", async () => {
  const html = await readFile(path.join(distDirectory, "index.html"), "utf8");
  const markupOnly = html.replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, "$1$2");

  assert.match(html, /<script type="module">[\s\S]*?<\/script>/i);
  assert.match(html, /<style>[\s\S]*?<\/style>/i);
  assert.doesNotMatch(markupOnly, /<script\b[^>]*\bsrc=/i);
  assert.doesNotMatch(markupOnly, /<link\b(?=[^>]*\brel=["']stylesheet["'])/i);
  assert.doesNotMatch(markupOnly, /<link\b(?=[^>]*\brel=["']modulepreload["'])/i);
});
