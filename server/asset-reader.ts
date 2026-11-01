import { open, realpath } from "node:fs/promises";
import path from "node:path";

// App-only transport: request by local path, return bounded binary chunks in UI metadata.
export async function readAssetChunk(
  root: string,
  file: string,
  offset: number,
  version?: string,
) {
  const canonicalRoot = await realpath(root),
    actual = await realpath(file);
  const relative = path.relative(canonicalRoot, actual);
  const topDir = relative.split(path.sep)[0];
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !["assets", "exports", "projects", "uploads"].includes(topDir)
  )
    throw Error("只能读取当前项目 assets、exports 或 projects 目录中的文件");
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw Error("无效的文件偏移");
  const handle = await open(actual, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024)
      throw Error("文件无效或超过64MB");
    const current = `${stat.size}:${stat.mtimeMs}`;
    if (version && version !== current)
      throw Error("文件读取期间已改变，请重新加载预览");
    if (offset > stat.size) throw Error("文件偏移超过文件大小");
    const buffer = Buffer.alloc(Math.min(49152, stat.size - offset));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    if (bytesRead !== buffer.length) throw Error("文件读取不完整");
    return {
      bytes: Array.from(buffer),
      total: stat.size,
      offset,
      next: offset + bytesRead,
      version: current,
    };
  } finally {
    await handle.close();
  }
}
