import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export function getWasmToolsDistDir(): string {
  for (const relative of ["./wasm-tools", "./wasm-tools/dist", "../server/wasm-tools/dist"]) {
    const candidate = fileURLToPath(new URL(relative, import.meta.url));
    if (fs.existsSync(path.join(candidate, "imagemagick/magick.cjs"))) return candidate;
  }
  throw Error("未找到插件内置 WASM 工具目录");
}
