import { stat } from "node:fs/promises";
import path from "node:path";
// Resolve only. Native opening belongs to the Codex host, never a child process.
export async function revealFile(file: string) {
  if (!path.isAbsolute(file) || !(await stat(file)).isFile())
    throw Error("导出文件不存在");
  return { file, directory: path.dirname(file) };
}
