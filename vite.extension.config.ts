import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * Builds the Chrome extension into extension/dist. Two passes, because a content script
 * must be one classic script with no imports:
 *   EXTENSION_PART=pages   (default) background service worker, popup and approval window
 *   EXTENSION_PART=content the content script, as a single IIFE
 * `npm run build:extension` runs both.
 */
const root = resolve(__dirname, "extension");
const part = process.env.EXTENSION_PART ?? "pages";

/** The shared assessor imports the web app's Firebase setup; the extension has its own App Check. */
function extensionFirebase(): Plugin {
  const webFirebase = resolve(__dirname, "src/firebase.ts");
  return {
    name: "edge-guard-extension-firebase",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!importer || !source.endsWith("firebase")) return null;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      return resolved?.id === webFirebase ? resolve(root, "src/firebase.ts") : null;
    },
  };
}

export default defineConfig({
  root,
  envDir: __dirname,
  publicDir: part === "pages" ? resolve(root, "public") : false,
  plugins: [extensionFirebase()],
  build: {
    outDir: resolve(root, "dist"),
    emptyOutDir: part === "pages",
    target: "chrome138",
    modulePreload: false,
    rollupOptions:
      part === "content"
        ? {
            input: resolve(root, "src/content.ts"),
            output: { format: "iife", entryFileNames: "content.js", inlineDynamicImports: true },
          }
        : {
            input: {
              background: resolve(root, "src/background.ts"),
              popup: resolve(root, "popup.html"),
              approve: resolve(root, "approve.html"),
            },
            output: { entryFileNames: "[name].js", chunkFileNames: "chunks/[name]-[hash].js", assetFileNames: "assets/[name]-[hash][extname]" },
          },
  },
});
