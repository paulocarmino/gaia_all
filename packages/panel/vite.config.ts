import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const CORE_URL = process.env["GAIA_CORE_URL"] ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "src") },
    // pnpm's layout let base-ui pull its own React copy, which breaks hooks
    // with "cannot read properties of null (reading 'useRef')".
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 5173,
    // In production Fastify serves this build, so the panel and the core share
    // an origin. Dev proxies to keep that assumption true instead of baking a
    // second origin into the client.
    proxy: {
      "/api": {
        target: CORE_URL,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  // base-ui resolved React's CJS build while the app used ESM, which React sees
  // as two copies and rejects with "invalid hook call". Pre-bundling them
  // together forces one shared instance.
  optimizeDeps: {
    include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
  },
  build: { outDir: "dist" },
});
