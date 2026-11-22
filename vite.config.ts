/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";

/**
 * `npm run dev`  → browser preview only (mock data, no yt-dlp).
 * `npm run app`  → same UI inside the Electron desktop shell, with real yt-dlp.
 */
export default defineConfig(({ mode }) => ({
  // The desktop build is opened from disk (file://), so asset URLs must be relative.
  base: mode === "electron" ? "./" : "/",
  plugins: [
    react(),
    mode === "electron" &&
      electron([
        {
          entry: "electron/main.ts",
          vite: {
            build: { outDir: "dist-electron", rollupOptions: { external: ["electron"] } },
          },
        },
        {
          entry: "electron/preload.ts",
          onstart({ reload }) {
            reload();
          },
          vite: {
            build: {
              outDir: "dist-electron",
              // Sandboxed preloads must be CommonJS (the plugin's lib mode defaults to ESM here).
              lib: { entry: "electron/preload.ts", formats: ["cjs"], fileName: () => "preload.cjs" },
              rollupOptions: { external: ["electron"], output: { inlineDynamicImports: true } },
            },
          },
        },
      ]),
  ],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  test: { include: ["src/**/*.test.ts"] },
}));
