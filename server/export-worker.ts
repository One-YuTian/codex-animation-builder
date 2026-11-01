import { debugLog } from "./debug-log";
import { parentPort, workerData } from "node:worker_threads";
import { createWriteStream } from "node:fs";
import { mkdir as mkdirAsync, writeFile as writeAsync } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { encodeGif } from "./magick";
import { Zip, ZipPassThrough, strToU8 } from "fflate";
import { frameCount, type Project } from "../src/model";
import { renderFrame } from "./frame";
import { framesToGif, compressGif, framesToMedia } from "./wasm-gif";
const {
  project: p,
  format,
  frame,
  frames,
  exportFps: requestedFps,
  exportDuration,
  lossy = 30,
  compressionLevel = 4,
  output,
  tempDir,
  jobId,
} = workerData as {
  project: Project;
  format: string;
  frame: number;
  frames?: number;
  exportFps?: number;
  exportDuration?: number;
  lossy?: number;
  compressionLevel?: number;
  output: string;
  tempDir?: string;
  jobId: string;
};
const previewTotal = frameCount(p);
const total =
  format === "png" || format === "project"
    ? 1
    : Math.max(1, frames ?? previewTotal);
const duration = exportDuration ?? p.duration;
const exportFps = requestedFps ?? total / duration;
const log = (event: string, details: unknown) =>
  debugLog(event, { jobId, ...(details as Record<string, unknown>) });
async function main() {
  const started = Date.now();
  log("导出开始", {
    format,
    width: p.width,
    height: p.height,
    fps: exportFps,
    duration,
    frames: total,
    output,
    ...(format === "gif" ? { lossy } : {}),
  });
  await mkdirAsync(output, { recursive: true });
  if (tempDir) await mkdirAsync(tempDir, { recursive: true });
  const extension = (
    {
      gif: "gif",
      webp: "webp",
      webm: "webm",
      png: "png",
      "png-sequence": "zip",
      project: "json",
    } as Record<string, string>
  )[format];
  const file = path.join(output, `${p.id}-${jobId}.${extension}`);
  if (format === "project") {
    await writeAsync(file, JSON.stringify(p, null, 2));
    parentPort!.postMessage({
      type: "done",
      file,
      mimeType: "application/json",
    });
    return;
  }
  if (format === "png") {
    await writeAsync(file, await renderFrame(p, frame));
    parentPort!.postMessage({ type: "done", file, mimeType: "image/png" });
    return;
  }
  if (format === "png-sequence") {
    const stream = createWriteStream(file);
    let streamError: Error | undefined;
    stream.on("error", (e) => {
      streamError = e;
    });
    const zip = new Zip((error, chunk, final) => {
      if (error) {
        stream.destroy(error);
        return;
      }
      stream.write(chunk);
      if (final) stream.end();
    });
    const manifest = new ZipPassThrough("manifest.json");
    zip.add(manifest);
    manifest.push(
      strToU8(
        JSON.stringify({
          fps: Math.round(exportFps * 100) / 100,
          duration,
          width: p.width,
          height: p.height,
          frames: total,
        }),
      ),
      true,
    );
    for (let i = 0; i < total; i++) {
      const entry = new ZipPassThrough(
        `frame-${String(i).padStart(3, "0")}.png`,
      );
      zip.add(entry);
      const sampleFrame =
        total === 1 ? 0 : (i * (previewTotal - 1)) / (total - 1);
      entry.push(await renderFrame(p, sampleFrame), true);
      if (streamError) throw streamError;
      if (stream.writableNeedDrain) await once(stream, "drain");
      parentPort!.postMessage({ type: "progress", completed: i + 1, total });
      await new Promise((resolve) => setImmediate(resolve));
    }
    const finished = once(stream, "finish");
    zip.end();
    await finished;
    parentPort!.postMessage({
      type: "done",
      file,
      mimeType: "application/zip",
    });
    return;
  }
  const frameBuffers: Buffer[] = [];
  for (let i = 0; i < total; i++) {
    const sampleFrame =
      total === 1 ? 0 : (i * (previewTotal - 1)) / (total - 1);
    const png = await renderFrame(p, sampleFrame);
    frameBuffers.push(png);
    parentPort!.postMessage({
      type: "progress",
      completed: i + 1,
      total,
      stage: `正在渲染序列帧 (${i + 1}/${total})`,
    });
    await new Promise((resolve) => setImmediate(resolve));
  }

  log("序列帧合成完成", {
    frames: total,
    pngBytes: frameBuffers.reduce((n, b) => n + b.length, 0),
    elapsedMs: Date.now() - started,
  });
  if (format === "webp" || format === "webm") {
    const encodingStarted = Date.now();
    parentPort!.postMessage({
      type: "progress",
      completed: total,
      total,
      stage: format === "webp" ? "正在编码动态 WebP…" : "正在编码透明 WebM…",
    });
    const bytes = await framesToMedia(frameBuffers, format, {
      fps: exportFps,
      compressionLevel,
      onLog: log,
    });
    await writeAsync(file, bytes);
    log("媒体编码完成", {
      format,
      compressionLevel: format === "webp" ? compressionLevel : undefined,
      bytes: bytes.length,
      elapsedMs: Date.now() - encodingStarted,
    });
    parentPort!.postMessage({
      type: "done",
      file,
      mimeType: format === "webp" ? "image/webp" : "video/webm",
    });
    return;
  }
  try {
    const synthStarted = Date.now();
    parentPort!.postMessage({
      type: "progress",
      completed: total,
      total,
      stage: "正在使用 FFmpeg WASM 合成高质量透明 GIF...",
    });
    const rawGif = await framesToGif(frameBuffers, {
      onLog: log,
      fps: exportFps,
      transparencyColor: "ffffff",
    });

    parentPort!.postMessage({
      type: "progress",
      completed: total,
      total,
      stage: "正在使用 Gifsicle WASM 进行 -O3 极致压缩...",
    });
    log("首次合成 GIF", {
      bytes: rawGif.length,
      elapsedMs: Date.now() - synthStarted,
    });
    const compressStarted = Date.now();
    const optimizedGif = await compressGif(rawGif, {
      onLog: log,
      lossy,
      optimizeLevel: "-O3",
      expectedPages: total,
    });

    log("GIF 压缩完成", {
      selectedSource: Buffer.from(optimizedGif).equals(Buffer.from(rawGif))
        ? "original"
        : "optimized",
      lossy,
      beforeBytes: rawGif.length,
      afterBytes: optimizedGif.length,
      savedPercent: (1 - optimizedGif.length / rawGif.length) * 100,
      elapsedMs: Date.now() - compressStarted,
    });
    await writeAsync(file, Buffer.from(optimizedGif));
    parentPort!.postMessage({ type: "done", file, mimeType: "image/gif" });
    return;
  } catch (wasmError) {
    console.warn(
      "FFmpeg/Gifsicle WASM不可用，改用ImageMagick WASM合成GIF",
      wasmError,
    );
    log("FFmpeg/Gifsicle 失败，启用 ImageMagick 后备", {
      error: String(wasmError),
      compression: "未执行 Gifsicle 压缩",
    });
    const fallbackStarted = Date.now();
    const fallback = await encodeGif(frameBuffers, exportFps, log);
    log("ImageMagick 首次合成 GIF（未压缩）", {
      bytes: fallback.length,
      elapsedMs: Date.now() - fallbackStarted,
    });
    await writeAsync(file, fallback);
    parentPort!.postMessage({ type: "done", file, mimeType: "image/gif" });
  }
}
void main().catch((error) =>
  parentPort!.postMessage({
    type: "error",
    error: error instanceof Error ? error.message : String(error),
  }),
);
