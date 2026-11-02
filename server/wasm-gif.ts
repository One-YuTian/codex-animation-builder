import { gifInfo, selectSmallerGif } from "./gif-selection";
import { debugLog } from "./debug-log";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

import { getWasmToolsDistDir } from "./wasm-paths";
export { getWasmToolsDistDir } from "./wasm-paths";

export type FramesToGifOptions = {
  onLog?: (event: string, details: unknown) => void;
  fps?: number;
  transparencyColor?: string;
  verbose?: boolean;
  distDir?: string;
};

export type CompressGifOptions = {
  onLog?: (event: string, details: unknown) => void;
  lossy?: number;
  optimizeLevel?: string;
  colors?: number;
  expectedPages?: number;
  verbose?: boolean;
  distDir?: string;
};

export type ProcessFramesOptions = FramesToGifOptions &
  CompressGifOptions & {
    onStage?: (stage: "synthesize" | "compress") => void;
  };

/**
 * 使用 ffmpeg.wasm 从 PNG 序列帧合成高质量透明 GIF
 */
async function framesToGifImpl(
  frameBuffers: (Buffer | Uint8Array)[],
  options: FramesToGifOptions = {},
): Promise<Uint8Array> {
  const fps = options.fps ?? 30;
  const color = options.transparencyColor ?? "ffffff";
  return runFFmpegFrames(
    frameBuffers,
    [
      "-filter_complex",
      `[0:v]split[a][b];[a]palettegen=reserve_transparent=on:transparency_color=${color}[p];[b][p]paletteuse=alpha_threshold=128`,
      "-r",
      String(fps),
    ],
    "intermediate_render.gif",
    options,
  );
}

/**
 * 使用 gifsicle.wasm 对 GIF 进行 -O3 和 --lossy 极致压缩优化
 */
async function compressGifImpl(
  gifBuffer: Buffer | Uint8Array,
  options: CompressGifOptions = {},
): Promise<Uint8Array> {
  const dist = options.distDir ?? getWasmToolsDistDir();
  const gifsicleJsPath = path.join(dist, "gifsicle", "gifsicle.js");
  const createGifsicleCore = require(gifsicleJsPath);
  if (typeof createGifsicleCore !== "function")
    throw Error(`Gifsicle 模块未导出工厂函数: ${gifsicleJsPath}`);
  const core = await createGifsicleCore({
    noInitialRun: true,
    noExitRuntime: true,
    locateFile: (p: string) => path.join(dist, "gifsicle", p),
    print: (message: string) =>
      options.onLog?.("WASM stdout", { engine: "gifsicle", message }),
    printErr: (message: string) =>
      options.onLog?.("WASM stderr", { engine: "gifsicle", message }),
  });

  const inFileName = "input.gif";
  const outFileName = "output.gif";

  const runGifsicle = (optLevel: string) => {
    core.FS.writeFile(inFileName, gifBuffer);
    const lossy = options.lossy !== undefined ? options.lossy : 30;
    const colors = options.colors || 0;

    const args = [optLevel];
    if (lossy > 0) {
      args.push(`--lossy=${lossy}`);
    }
    if (colors > 0) {
      args.push(`--colors=${colors}`);
    }
    args.push(inFileName, "-o", outFileName);

    try {
      options.onLog?.("WASM 命令", { engine: "gifsicle", args });
      const code=core.callMain(args);if(code&&code!==0)throw Error(`Gifsicle失败 (${code})`);
    } catch(error){if((error as any)?.status!==0)throw error;}

    const result = new Uint8Array(core.FS.readFile(outFileName));
    try {
      core.FS.unlink(inFileName);
      core.FS.unlink(outFileName);
    } catch (_) {}
    return result;
  };

  const initialLevel = options.optimizeLevel || "-O3";
  const resultData = runGifsicle(initialLevel);
  let chosen = selectSmallerGif(gifBuffer, resultData);
  options.onLog?.("GIF 候选评估", {
    level: initialLevel,
    beforeBytes: gifBuffer.length,
    candidateBytes: resultData.length,
    selectedSource: chosen.source,
    reason: chosen.reason,
    input: chosen.input,
    output: chosen.output,
    expectedPages: options.expectedPages,
  });
  // Frame count alone is not a failure. Retry O1 only if playback metadata or structure is invalid.
  if (
    chosen.reason !== "优化结果未减小" &&
    chosen.source === "original" &&
    initialLevel !== "-O1"
  ) {
    try {
      const retry = runGifsicle("-O1");
      const fallback = selectSmallerGif(gifBuffer, retry);
      if (fallback.bytes.length < chosen.bytes.length) chosen = fallback;
      options.onLog?.("GIF 候选评估", {
        level: "-O1",
        candidateBytes: retry.length,
        selectedSource: chosen.source,
        reason: fallback.reason,
      });
    } catch (error) {
      options.onLog?.("GIF 优化回退", {
        reason: String(error),
        selectedSource: "original",
      });
    }
  }
  options.onLog?.("GIF 优化选择", {
    selectedSource: chosen.source,
    beforeBytes: gifBuffer.length,
    afterBytes: chosen.bytes.length,
    reason: chosen.reason,
  });
  return chosen.bytes;
}

/**
 * 全自动流水线：从 PNG 序列帧直接生成经过 ffmpeg.wasm 与 gifsicle.wasm 优化的高质量透明 GIF
 */
export async function processFramesToOptimizedGif(
  frameBuffers: (Buffer | Uint8Array)[],
  options: ProcessFramesOptions = {},
): Promise<Uint8Array> {
  options.onStage?.("synthesize");
  const rawGif = await framesToGif(frameBuffers, options);

  options.onStage?.("compress");
  const compressedGif = await compressGif(rawGif, options);

  return compressedGif;
}

async function tracedWasm<
  T extends {
    onLog?: (event: string, details: unknown) => void;
    distDir?: string;
  },
>(engine: string, options: T, execute: (options: T) => Promise<Uint8Array>) {
  const onLog = options.onLog ?? debugLog;
  const started = Date.now();
  onLog("WASM 调用开始", {
    engine,
    options: { ...options, onLog: undefined },
    distDir: options.distDir ?? getWasmToolsDistDir(),
  });
  try {
    const bytes = await execute({ ...options, onLog });
    onLog("WASM 调用完成", {
      engine,
      bytes: bytes.length,
      elapsedMs: Date.now() - started,
    });
    return bytes;
  } catch (error) {
    onLog("WASM 调用失败", {
      engine,
      error: String(error),
      elapsedMs: Date.now() - started,
    });
    throw error;
  }
}
export async function framesToGif(
  frames: (Buffer | Uint8Array)[],
  options: FramesToGifOptions = {},
) {
  return tracedWasm("ffmpeg", options, (opts) => framesToGifImpl(frames, opts));
}
export async function compressGif(
  bytes: Buffer | Uint8Array,
  options: CompressGifOptions = {},
) {
  gifInfo(bytes);
  try {
    return await tracedWasm("gifsicle", options, (opts) =>
      compressGifImpl(bytes, opts),
    );
  } catch (error) {
    (options.onLog ?? debugLog)("GIF 优化回退", {
      selectedSource: "original",
      bytes: bytes.length,
      reason: String(error),
    });
    return new Uint8Array(bytes);
  }
}

async function runFFmpegFrames(
  frames: (Buffer | Uint8Array)[],
  encoderArgs: string[],
  filename: string,
  options: FramesToGifOptions,
) {
  const dist = options.distDir ?? getWasmToolsDistDir();
  const directory = path.join(dist, "ffmpeg");
  const factory = require(path.join(directory, "ffmpeg.js"));
  const emit = (type: string, message: string) =>
    options.onLog?.("WASM " + type, { engine: "ffmpeg", message });
  const errors: string[] = [];
  const wasmPath = path.join(directory, "ffmpeg-core.wasm");
  const core = await factory({
    noInitialRun: true,
    noExitRuntime: true,
    ...(fs.existsSync(wasmPath)
      ? { wasmBinary: fs.readFileSync(wasmPath) }
      : {}),
    locateFile: (name: string) => path.join(directory, name),
    print: (message: string) => emit("stdout", message),
    printErr: (message: string) => emit("stderr", message),
  });
  core.setLogger?.(({ type, message }: { type: string; message: string }) => {
    emit(type, message);
    if (type === "stderr") errors.push(message);
  });
  const names = frames.map((_, i) => `frame-${String(i).padStart(4, "0")}.png`);
  const args = [
    "-nostdin",
    "-framerate",
    String(options.fps ?? 24),
    "-i",
    "frame-%04d.png",
    ...encoderArgs,
    "-y",
    filename,
  ];
  try {
    frames.forEach((bytes, i) => core.FS.writeFile(names[i], bytes));
    options.onLog?.("WASM 命令", { engine: "ffmpeg", args });
    let code;
    try {
      code = core.exec ? core.exec(...args) : core.callMain([...args]);
    } catch (error) {
      if ((error as any).status !== 0) throw error;
    }
    if (code && code !== 0)
      throw Error(`FFmpeg 编码失败 (${code}): ${errors.slice(-8).join("\n")}`);
    return new Uint8Array(core.FS.readFile(filename));
  } finally {
    for (const name of [...names, filename])
      try {
        core.FS.unlink(name);
      } catch {}
    core.reset?.();
  }
}
export async function framesToMedia(
  frames: (Buffer | Uint8Array)[],
  format: "webp" | "webm",
  options: FramesToGifOptions & { compressionLevel?: number } = {},
) {
  return tracedWasm("ffmpeg", options, (opts) =>
    runFFmpegFrames(
      frames,
      format === "webp"
        ? [
            "-c:v",
            "libwebp_anim",
            "-quality",
            "80",
            "-compression_level",
            String(opts.compressionLevel ?? 4),
            "-loop",
            "0",
          ]
        : [
            "-c:v",
            "libvpx-vp9",
            "-pix_fmt",
            "yuva420p",
            "-auto-alt-ref",
            "0",
            "-b:v",
            "0",
            "-crf",
            "30",
            "-threads",
            "1",
            "-deadline",
            "good",
            "-cpu-used",
            "4",
            "-an",
          ],
      "output." + format,
      opts,
    ),
  );
}
