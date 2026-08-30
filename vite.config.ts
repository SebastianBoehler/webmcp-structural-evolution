import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["occt-wasm"],
  },
  build: {
    target: "esnext",
    rollupOptions: {
      input: {
        app: "index.html",
        "occt-worker": "src/cad/kernel/occt-worker.ts",
      },
      output: {
        assetFileNames: (asset) => asset.names.includes("occt-wasm.wasm")
          ? "assets/occt-wasm.wasm"
          : "assets/[name]-[hash][extname]",
      },
    },
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
