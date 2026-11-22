import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    // 127.0.0.1, not localhost: Node may resolve localhost to ::1, where uvicorn doesn't listen.
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  build: {
    target: "es2022",
    cssCodeSplit: true,
    sourcemap: false,
    assetsInlineLimit: 0,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
