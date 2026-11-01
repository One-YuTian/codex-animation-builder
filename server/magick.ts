import { debugLog } from "./debug-log";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
const require = createRequire(import.meta.url);
let modulePromise: Promise<any> | undefined;
let queue: Promise<unknown> = Promise.resolve();
async function moduleCore() {
  if (!modulePromise) {
    const dir = path.resolve("server/wasm-tools/dist/imagemagick");
    const factory = require(path.join(dir, "magick.cjs"));
    debugLog("WASM 初始化", { engine: "ImageMagick", module: path.join(dir, "magick.cjs") });
    modulePromise = factory({
      noInitialRun: true,
      noExitRuntime: true,
      locateFile: (p: string) => path.join(dir, p),
      print: (message: string) => debugLog("WASM stdout", { engine: "ImageMagick", message }),
      printErr: (message: string) => debugLog("WASM stderr", { engine: "ImageMagick", message }),
    });
  }
  return modulePromise;
}
export function pngSize(bytes: Uint8Array) {
  const b = Buffer.from(bytes);
  if (b.length < 24 || b.toString("hex", 0, 8) !== "89504e470d0a1a0a")
    throw Error("ImageMagick未输出有效PNG");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
export async function sourceBytes(source: string | Uint8Array) {
  return typeof source === "string" ? readFile(source) : Buffer.from(source);
}
async function command(
  files: Record<string, Uint8Array>,
  args: string[],
  output: string,
) {
  const run = queue.then(async () => {
    const started = Date.now();
    const actualArgs = ["-limit", "memory", "256MiB", "-limit", "map", "0", "-limit", "disk", "0", ...args];
    debugLog("WASM 调用开始", { engine: "ImageMagick", args: actualArgs, inputBytes: Object.values(files).reduce((n, b) => n + b.length, 0) });
    try {
    const c = await moduleCore();
    const names = [...Object.keys(files), output];
    try {
      for (const [name, bytes] of Object.entries(files))
        c.FS.writeFile(name, bytes);
      let code;
      try {
        code = c.callMain(actualArgs);
      } catch (error) {
        if ((error as any).status !== 0) throw error;
      }
      if (code && code !== 0) throw Error("ImageMagick处理失败 (" + code + ")");
      const bytes = Buffer.from(c.FS.readFile(output));
      debugLog("WASM 调用完成", { engine: "ImageMagick", output, bytes: bytes.length, exitCode: code ?? 0, elapsedMs: Date.now() - started });
      return bytes;
    } finally {
      for (const name of names)
        try {
          c.FS.unlink(name);
        } catch {}
    }
    } catch (error) {
      debugLog("WASM 调用失败", { engine: "ImageMagick", args: actualArgs, error: String(error), elapsedMs: Date.now() - started });
      throw error;
    }
  });
  queue = run.catch(() => {});
  return run;
}
export async function convertImage(
  source: string | Uint8Array,
  args: string[] = [],
) {
  return command(
    { "/input.bin": await sourceBytes(source) },
    ["/input.bin[0]", ...args, "PNG32:/output.png"],
    "/output.png",
  );
}
export async function decodeImage(source: string | Uint8Array) {
  const bytes = await sourceBytes(source);
  if (bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") {
    const { width, height } = pngSize(bytes);
    if (width * height > 16777216) throw Error("图片超过16777216像素");
  }
  const png = await convertImage(bytes, ["-auto-orient"]);
  const info = pngSize(png);
  if (info.width * info.height > 16777216) throw Error("图片超过16777216像素");
  const data = await command(
    { "/input.png": png },
    ["/input.png", "-alpha", "on", "-depth", "8", "RGBA:/output.bin"],
    "/output.bin",
  );
  return { data, info, png };
}
export async function encodeRgba(
  data: Uint8Array,
  width: number,
  height: number,
) {
  if (data.length !== width * height * 4) throw Error("RGBA尺寸不匹配");
  return command(
    { "/input.rgba": data },
    [
      "-size",
      `${width}x${height}`,
      "-depth",
      "8",
      "RGBA:/input.rgba",
      "PNG32:/output.png",
    ],
    "/output.png",
  );
}
export async function composeImages(
  width: number,
  height: number,
  background: string,
  overlays: { input: Uint8Array; left: number; top: number }[],
) {
  const files: Record<string, Uint8Array> = {};
  const args = [
    "-size",
    `${width}x${height}`,
    "xc:" + (background === "transparent" ? "none" : background),
  ];
  overlays.forEach((o, i) => {
    const name = `/layer-${i}.png`;
    files[name] = o.input;
    args.push(
      name,
      "-geometry",
      `${o.left >= 0 ? "+" : ""}${o.left}${o.top >= 0 ? "+" : ""}${o.top}`,
      "-compose",
      "Over",
      "-composite",
    );
  });
  args.push("PNG32:/output.png");
  return command(files, args, "/output.png");
}
// GIF metadata is read structurally, without decoding pixels or depending on a native package.
export function gifPages(source: Uint8Array) {
  const b = Buffer.from(source);
  if (!/^GIF8[79]a$/.test(b.toString("ascii", 0, 6)))
    throw Error("GIF格式无效");
  let at = 13 + (b[10] & 128 ? 3 * (1 << ((b[10] & 7) + 1)) : 0),
    pages = 0;
  const skip = () => {
    while (at < b.length) {
      const n = b[at++];
      if (!n) return;
      at += n;
    }
  };
  while (at < b.length) {
    const code = b[at++];
    if (code === 0x3b) break;
    if (code === 0x21) {
      at++;
      skip();
    } else if (code === 0x2c) {
      if (at + 9 > b.length) throw Error("GIF截断");
      const packed = b[at + 8];
      at += 9;
      if (packed & 128) at += 3 * (1 << ((packed & 7) + 1));
      at++;
      skip();
      pages++;
    } else throw Error("GIF数据无效");
  }
  return pages;
}

export async function encodeGif(frames: Uint8Array[], fps: number, onLog?: (event: string, details: unknown) => void) {
  const files: Record<string, Uint8Array> = {};
  const args = ["-dispose", "Background"];
  frames.forEach((png, i) => {
    const name = `/gif-${i}.png`;
    files[name] = png;
    args.push(
      "-delay",
      String(Math.round(((i + 1) * 100) / fps) - Math.round((i * 100) / fps)),
      name,
    );
  });
  args.push("-loop", "0", "GIF:/output.gif");
  onLog?.("WASM 命令", { engine: "ImageMagick", args: ["-limit", "memory", "256MiB", "-limit", "map", "0", "-limit", "disk", "0", ...args] });
  return command(files, args, "/output.gif");
}
