import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function toText(value) {
  return typeof value === "string" ? value : new TextDecoder().decode(value);
}

function escapeClosingTag(value, tagName) {
  return value.replace(new RegExp("</" + tagName, "gi"), "<\\/" + tagName);
}

function stripInlineScriptContents(html) {
  return html.replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, "$1$2");
}

export function inlineProductionAssets() {
  return {
    name: "netguard-inline-production-assets",
    apply: "build",
    enforce: "post",
    generateBundle: {
      order: "post",
      handler(_outputOptions, bundle) {
        const htmlAsset = bundle["index.html"];
        if (!htmlAsset || htmlAsset.type !== "asset") {
          throw new Error("NetGuard build did not emit index.html.");
        }

        const chunks = Object.values(bundle).filter((item) => item.type === "chunk");
        const entry = chunks.find((item) => item.isEntry);
        if (!entry || chunks.length !== 1) {
          throw new Error(
            "Expected one self-contained JavaScript chunk, received " + chunks.length + ". " +
            "Remove code splitting and keep the dashboard bootstrap self-contained."
          );
        }

        let html = toText(htmlAsset.source);
        const scriptTag = /<script\b(?=[^>]*\bsrc=["'][^"']+["'])[^>]*>\s*<\/script>/gi;
        const scriptTags = html.match(scriptTag) || [];
        if (!scriptTags.length) {
          throw new Error("NetGuard HTML does not contain the Vite application entry script.");
        }

        const scriptSources = scriptTags.map((tag) => tag.match(/\bsrc=["']([^"']+)["']/i)?.[1] || "");
        if (new Set(scriptSources).size !== 1 || scriptSources.some((source) => !source)) {
          throw new Error("NetGuard HTML contains multiple distinct external script entries.");
        }

        const inlineScript = escapeClosingTag(entry.code, "script");
        let entryReplaced = false;
        html = html.replace(scriptTag, () => {
          if (entryReplaced) return "";
          entryReplaced = true;
          return "<script type=\"module\">\n" + inlineScript + "\n</script>";
        });

        const cssAssets = Object.values(bundle).filter(
          (item) => item.type === "asset" && item.fileName.endsWith(".css")
        );
        let inlinedCssCount = 0;
        html = html.replace(
          /<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*>/gi,
          (tag) => {
            const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
            if (!href) throw new Error("A generated stylesheet link has no href.");
            const normalizedHref = href.split("?")[0].replace(/^\/+/, "");
            const cssAsset = cssAssets.find(
              (asset) => normalizedHref === asset.fileName || normalizedHref.endsWith("/" + asset.fileName)
            );
            if (!cssAsset) throw new Error("Could not find generated CSS asset for " + href + ".");
            inlinedCssCount += 1;
            return "<style>\n" + escapeClosingTag(toText(cssAsset.source), "style") + "\n</style>";
          }
        );

        if (inlinedCssCount !== cssAssets.length) {
          throw new Error("Not all generated CSS assets were inlined.");
        }

        html = html.replace(
          /<link\b(?=[^>]*\brel=["']modulepreload["'])[^>]*>\s*/gi,
          ""
        );

        const markupOnly = stripInlineScriptContents(html);
        if (
          /<script\b[^>]*\bsrc=/i.test(markupOnly) ||
          /<link\b(?=[^>]*\brel=["']stylesheet["'])/i.test(markupOnly) ||
          /<link\b(?=[^>]*\brel=["']modulepreload["'])/i.test(markupOnly)
        ) {
          throw new Error("NetGuard production HTML still references external bootstrap assets.");
        }

        htmlAsset.source = html;
        for (const [fileName, item] of Object.entries(bundle)) {
          if (
            item.type === "chunk" ||
            (item.type === "asset" && (fileName.endsWith(".css") || fileName.endsWith(".map")))
          ) {
            delete bundle[fileName];
          }
        }
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), inlineProductionAssets()],
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
