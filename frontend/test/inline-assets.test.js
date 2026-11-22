import test from "node:test";
import assert from "node:assert/strict";
import { inlineProductionAssets } from "../vite.config.js";

test("inlines the entry JavaScript and stylesheet into index.html", () => {
  const bundle = {
    "index.html": {
      type: "asset",
      fileName: "index.html",
      source: `<!doctype html>
<html>
<head>
<link rel="stylesheet" crossorigin href="/assets/index-test.css">
<link rel="modulepreload" crossorigin href="/assets/shared-test.js">
</head>
<body>
<script type="module" crossorigin src="/assets/index-test.js"></script>
</body>
</html>`,
    },
    "assets/index-test.js": {
      type: "chunk",
      fileName: "assets/index-test.js",
      isEntry: true,
      code: "globalThis.netguardBooted = true;",
    },
    "assets/index-test.css": {
      type: "asset",
      fileName: "assets/index-test.css",
      source: "body { color: #123456; }",
    },
    "favicon.svg": {
      type: "asset",
      fileName: "favicon.svg",
      source: "<svg></svg>",
    },
  };

  inlineProductionAssets().generateBundle.handler({}, bundle);

  const html = bundle["index.html"].source;
  assert.match(html, /<script type="module">[\\s\\S]*globalThis\\.netguardBooted = true;/);
  assert.match(html, /<style>[\\s\\S]*body \\{ color: #123456; \\}/);
  assert.doesNotMatch(html, /<script\\b[^>]*\\bsrc=/i);
  assert.doesNotMatch(html, /rel="modulepreload"/i);
  assert.doesNotMatch(html, /rel="stylesheet"/i);
  assert.equal(bundle["assets/index-test.js"], undefined);
  assert.equal(bundle["assets/index-test.css"], undefined);
  assert.ok(bundle["favicon.svg"]);
});

test("rejects builds that still contain split JavaScript chunks", () => {
  const bundle = {
    "index.html": { type: "asset", fileName: "index.html", source: "<html></html>" },
    "assets/index.js": {
      type: "chunk", fileName: "assets/index.js", isEntry: true, code: "entry();",
    },
    "assets/shared.js": {
      type: "chunk", fileName: "assets/shared.js", isEntry: false, code: "shared();",
    },
  };

  assert.throws(
    () => inlineProductionAssets().generateBundle.handler({}, bundle),
    /Expected one self-contained JavaScript chunk/
  );
});
