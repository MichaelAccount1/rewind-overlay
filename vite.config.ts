import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  base: mode === "web" ? "/rewind-overlay/" : "/",
  plugins: [react()],
  build: {
    outDir: mode === "web" ? "dist-web" : "dist",
    sourcemap: true
  },
  server: {
    port: 5173,
    strictPort: true
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true
  }
}));
