import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/zotero-api": {
        target: "http://localhost:23124",
        changeOrigin: true,
        rewrite: (path: string): string =>
          path.replace(/^\/zotero-api/, "/api"),
        headers: {
          "Zotero-Allowed-Request": "1",
          "User-Agent": "Colloquia/1.0",
        },
      },
      "/zotero-plugin": {
        target: "http://localhost:23124",
        changeOrigin: true,
        rewrite: (path: string): string => path.replace(/^\/zotero-plugin/, ""),
        headers: {
          "Zotero-Allowed-Request": "1",
        },
      },
      "/api/ws": {
        target: "ws://localhost:8000",
        ws: true,
        rewrite: (path: string): string => path.replace(/^\/api\/ws/, "/ws"),
      },
    },
  },
});
