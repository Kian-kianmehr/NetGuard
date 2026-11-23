import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("navigation pages are part of the initial bundle, not lazy-loaded chunks", async () => {
  const source = await readFile(new URL("../src/pages/index.jsx", import.meta.url), "utf8");
  assert.equal(source.includes("React.lazy"), false);
  assert.equal(source.includes("lazy("), false);
  assert.equal(source.includes("import("), false);
  assert.equal(source.includes("<Suspense"), false);
  assert.equal(source.includes("در حال بارگذاری بخش"), false);
});

test("AI page reads a dedicated persisted intelligence record", async () => {
  const page = await readFile(new URL("../src/pages/index.jsx", import.meta.url), "utf8");
  const data = await readFile(new URL("../src/lib/data.js", import.meta.url), "utf8");
  assert.ok(page.includes("intelligenceRecord"));
  assert.ok(page.includes("record={intelligenceRecord}"));
  assert.ok(data.includes("/api/intelligence?hours=24"));
  assert.ok(data.includes('page === "intelligence"'));
});
