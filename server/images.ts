import { chromaMatte, type MatteOptions } from "./matte";
import { convertImage, decodeImage, encodeRgba, sourceBytes } from "./magick";
import type { Asset } from "../src/model";
import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
export async function saveAsset(
  bytes: Buffer,
  name: string,
  dir: string,
  width: number,
  height: number,
): Promise<Asset> {
  const id = randomUUID();
  await mkdir(dir, { recursive: true });
  const file = path.resolve(dir, id + ".png");
  await writeFile(file, bytes);
  const { data } = await decodeImage(bytes);
  let mass = 0,
    sx = 0,
    sy = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha < 8) continue;
      mass += alpha;
      sx += (x + 0.5) * alpha;
      sy += (y + 0.5) * alpha;
    }
  const visualCenter = mass
    ? { x: sx / mass / width, y: sy / mass / height }
    : { x: 0.5, y: 0.5 };
  return { id, name, path: file, width, height, visualCenter };
}
export async function makeAsset(
  source: string | Buffer,
  name: string,
  dir: string,
  minimum?: { width: number; height: number },
): Promise<Asset> {
  if (typeof source === "string") {
    if (!path.isAbsolute(source)) throw Error("图片必须使用绝对路径");
    const info = await stat(source);
    if (!info.isFile() || info.size > 24 * 1024 * 1024)
      throw Error("图片不是文件或超过24MB");
  } else if (source.length > 24 * 1024 * 1024) throw Error("图片超过24MB");
  const bytes = await sourceBytes(source);
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    throw Error("指定的magick.wasm未编译WebP，请使用PNG或JPEG输入");
  if (
    bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a" &&
    bytes.toString("hex", 0, 2) !== "ffd8" &&
    !/^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6))
  )
    throw Error("只支持PNG、JPEG或GIF图片");
  const { png, data, info } = await decodeImage(bytes);
  let transparent = false;
  for (let i = 3; i < data.length; i += 4)
    if (data[i] < 255) {
      transparent = true;
      break;
    }
  return {
    ...(await saveAsset(png, name, dir, info.width, info.height)),
    transparent,
  };
}
export type Rect = { x: number; y: number; width: number; height: number };
function rect(r: Rect, w: number, h: number) {
  if (
    !Object.values(r).every(Number.isInteger) ||
    r.width < 1 ||
    r.height < 1 ||
    r.x < 0 ||
    r.y < 0 ||
    r.x + r.width > w ||
    r.y + r.height > h
  )
    throw Error("分区/裁切区域超出图片");
}
export async function keyImage(
  asset: Asset,
  tolerance = 36,
  feather = 12,
  regions?: Rect[],
  targetDir?: string,
  options: MatteOptions = {},
): Promise<Asset> {
  const { data, info } = await decodeImage(asset.path);
  const { width: w, height: h } = info;
  const areas = regions?.length
    ? regions
    : [{ x: 0, y: 0, width: w, height: h }];
  for (const r of areas) rect(r, w, h);
  chromaMatte(data, w, h, areas, tolerance, feather, options);
  const result = await saveAsset(
    await encodeRgba(data, w, h),
    asset.name + " · 抠图",
    targetDir ?? path.dirname(asset.path),
    w,
    h,
  );
  return { ...result, sourceBounds: asset.sourceBounds };
}
export async function crop(
  asset: Asset,
  r: Rect,
  name: string,
  targetDir?: string,
): Promise<Asset> {
  rect(r, asset.width, asset.height);
  const result = await saveAsset(
    await convertImage(asset.path, [
      "-crop",
      `${r.width}x${r.height}+${r.x}+${r.y}`,
      "+repage",
    ]),
    name,
    targetDir ?? path.dirname(asset.path),
    r.width,
    r.height,
  );
  return { ...result, sourceBounds: r };
}
export async function splitComponents(
  asset: Asset,
  minArea = 16,
  mergeGap = 4,
  boxes?: Rect[],
  targetDir?: string,
): Promise<Asset[]> {
  if (boxes?.length)
    return Promise.all(
      boxes.map((r, i) => crop(asset, r, `${asset.name} ${i + 1}`, targetDir)),
    );
  const { data, info } = await decodeImage(asset.path);
  const w = info.width,
    h = info.height,
    seen = new Uint8Array(w * h),
    q = new Int32Array(w * h);
  let rects: Rect[] = [];
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || data[i * 4 + 3] < 16) continue;
    let start = 0,
      end = 1;
    q[0] = i;
    seen[i] = 1;
    let x0 = w,
      y0 = h,
      x1 = 0,
      y1 = 0,
      count = 0;
    while (start < end) {
      const at = q[start++],
        x = at % w,
        y = Math.floor(at / w);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      count++;
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (!seen[n] && data[n * 4 + 3] >= 16) {
          seen[n] = 1;
          q[end++] = n;
        }
      }
    }
    if (count >= minArea)
      rects.push({ x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 });
  }
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i],
          b = rects[j];
        if (
          a.x <= b.x + b.width + mergeGap &&
          b.x <= a.x + a.width + mergeGap &&
          a.y <= b.y + b.height + mergeGap &&
          b.y <= a.y + a.height + mergeGap
        ) {
          const x = Math.min(a.x, b.x),
            y = Math.min(a.y, b.y);
          rects[i] = {
            x,
            y,
            width: Math.max(a.x + a.width, b.x + b.width) - x,
            height: Math.max(a.y + a.height, b.y + b.height) - y,
          };
          rects.splice(j, 1);
          changed = true;
          break outer;
        }
      }
  }
  rects.sort((a, b) => a.y - b.y || a.x - b.x);
  if (rects.length > 500)
    throw Error("子图过多，请增大 mergeGap/minArea 或提供语义 boxes");
  return Promise.all(
    rects.map((r, i) => crop(asset, r, `${asset.name} ${i + 1}`, targetDir)),
  );
}
export async function splitGrid(
  asset: Asset,
  columns: number,
  rows: number,
  count: number,
  padding = 0,
  gap = 0,
  targetDir?: string,
) {
  const w = (asset.width - padding * 2 - gap * (columns - 1)) / columns,
    h = (asset.height - padding * 2 - gap * (rows - 1)) / rows;
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w <= 0 ||
    h <= 0 ||
    count > rows * columns
  )
    throw Error("Grid 必须是等尺寸整数单元格，count 不得超出容量");
  return Promise.all(
    Array.from({ length: count }, (_, i) =>
      crop(
        asset,
        {
          x: padding + (i % columns) * (w + gap),
          y: padding + Math.floor(i / columns) * (h + gap),
          width: w,
          height: h,
        },
        `${asset.name} · 帧 ${i + 1}`,
        targetDir,
      ),
    ),
  );
}

export async function resizeAsset(
  asset: Asset,
  width: number,
  height: number,
  dir: string,
  fit: "fill" | "contain" | "cover" = "fill",
) {
  const geometry = `${width}x${height}${fit === "fill" ? "!" : fit === "cover" ? "^" : ""}`;
  const png = await convertImage(asset.path, [
    "-resize",
    geometry,
    "-background",
    "none",
    "-gravity",
    "center",
    "-extent",
    `${width}x${height}`,
  ]);
  return {
    ...(await saveAsset(png, asset.name + " · 缩放", dir, width, height)),
    transparent: (await decodeImage(png)).data.some(
      (v, i) => i % 4 === 3 && v < 255,
    ),
  };
}
