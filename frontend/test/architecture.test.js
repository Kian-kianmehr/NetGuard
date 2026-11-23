import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const sourceDirectory = fileURLToPath(new URL("../src/", import.meta.url));

test("navigation pages are part of the initial bundle, not lazy-loaded chunks", async () => {
  const source = await readFile(new URL("pages/index.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /React\\.lazy|\\blazy\\s*\\(|import\\s*\\(/);
  assert.doesNotMatch(source, /<Suspense|در حال بارگذاری بخش/);
});

test("AI page reads a dedicated persisted intelligence record", async () => {
  const page = await readFile(new URL("pages/index.jsx", import.meta.url), "utf8");
  const data = await readFile(new URL("lib/data.js", import.meta.url), "utf8");
  assert.match(page, /intelligenceRecord/);
  assert.match(page, /record=\\{intelligenceRecord\\}/);
  assert.match(data, /\\/api\\/intelligence\\?hours=24/);
  assert.match(data, /page === "intelligence"/);
});
