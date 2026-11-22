import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Port is fixed so the Tauri shell (added in a later milestone) can point at it.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
});
