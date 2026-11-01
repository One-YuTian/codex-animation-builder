type FileReader = (path: string, signal: AbortSignal) => Promise<Blob>;
let hostReader: FileReader | undefined;
let activeReads = 0;
const waiting: (() => void)[] = [];
export function setHostFileReader(reader: FileReader) {
  hostReader = reader;
}
export async function readImageFile(
  path: string,
  signal: AbortSignal,
): Promise<Blob> {
  if (hostReader) {
    if (activeReads >= 2)
      await new Promise<void>((resolve) => waiting.push(resolve));
    else activeReads++;
    try {
      signal.throwIfAborted();
      return await hostReader(path, signal);
    } finally {
      const next = waiting.shift();
      if (next) next();
      else activeReads--;
    }
  }
  const response = await fetch(fileUrl(path), { signal, cache: "no-store" });
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  return response.blob();
}
export function fileUrl(path: string, download = false) {
  const r = window.__RUNTIME__;
  if (!r) throw Error("本机文件服务尚未连接");
  return `${r.origin}/api/file?path=${encodeURIComponent(path)}&token=${r.token}${download ? "&download=1" : ""}`;
}
export async function uploadFile(file: File) {
  const r = window.__RUNTIME__;
  if (!r) throw Error("本机文件服务尚未连接");
  const response = await fetch(
    `${r.origin}/api/upload?name=${encodeURIComponent(file.name)}`,
    {
      method: "POST",
      headers: {
        "X-Animation-Token": r.token,
        "Content-Type": "application/octet-stream",
      },
      body: file,
    },
  );
  const result = await response.json();
  if (!response.ok) throw Error(result.error ?? "上传失败");
  return result.path as string;
}
export function downloadFile(path: string) {
  const a = document.createElement("a");
  a.href = fileUrl(path, true);
  a.download = path.split(/[\\/]/).at(-1) ?? "animation";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
