import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: "dist/ui",
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      onwarn(warning, warn) {
        if (
          warning.code === "MODULE_LEVEL_DIRECTIVE" &&
          warning.message.includes("use client")
        )
          return;
        warn(warning);
      },
    },
  },
  server: { proxy: { "/api": "http://127.0.0.1:4318" } },
});
