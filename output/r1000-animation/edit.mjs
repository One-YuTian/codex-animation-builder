var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/images.ts
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
async function saveAsset(bytes, name, dir, width, height) {
  const id2 = randomUUID();
  await mkdir(dir, { recursive: true });
  const file = path.resolve(dir, id2 + ".png");
  await writeFile(file, bytes);
  return { id: id2, name, path: file, width, height };
}
async function makeAsset(source, name, dir) {
  if (typeof source === "string") {
    if (!path.isAbsolute(source)) throw Error("\u56FE\u7247\u5FC5\u987B\u4F7F\u7528\u7EDD\u5BF9\u8DEF\u5F84");
    const info2 = await stat(source);
    if (!info2.isFile() || info2.size > 24 * 1024 * 1024)
      throw Error("\u56FE\u7247\u4E0D\u662F\u6587\u4EF6\u6216\u8D85\u8FC724MB");
  } else if (source.length > 24 * 1024 * 1024) throw Error("\u56FE\u7247\u8D85\u8FC724MB");
  const image = sharp(source, { limitInputPixels: 16777216 });
  const metadata = await image.metadata();
  if (!["png", "jpeg", "webp"].includes(metadata.format ?? ""))
    throw Error("\u53EA\u652F\u6301 PNG/JPEG/WebP \u56FE\u7247");
  const { data, info } = await image.rotate().png().toBuffer({ resolveWithObject: true });
  return saveAsset(data, name, dir, info.width, info.height);
}
function rect(r, w, h) {
  if (!Object.values(r).every(Number.isInteger) || r.width < 1 || r.height < 1 || r.x < 0 || r.y < 0 || r.x + r.width > w || r.y + r.height > h)
    throw Error("\u5206\u533A/\u88C1\u5207\u533A\u57DF\u8D85\u51FA\u56FE\u7247");
}
async function keyImage(asset, tolerance = 36, feather = 12, regions, targetDir) {
  const { data, info } = await sharp(asset.path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const areas = regions?.length ? regions : [{ x: 0, y: 0, width: w, height: h }];
  for (const r of areas) {
    rect(r, w, h);
    const corners = [
      [r.x, r.y],
      [r.x + r.width - 1, r.y],
      [r.x, r.y + r.height - 1],
      [r.x + r.width - 1, r.y + r.height - 1]
    ];
    const colors = corners.map(([x, y]) => [
      data[(y * w + x) * 4],
      data[(y * w + x) * 4 + 1],
      data[(y * w + x) * 4 + 2]
    ]);
    const seen = new Uint8Array(w * h), queue = new Int32Array(r.width * r.height);
    let start = 0, end = 0;
    const enqueue = (x, y) => {
      if (x < r.x || y < r.y || x >= r.x + r.width || y >= r.y + r.height)
        return;
      const at = y * w + x;
      if (seen[at]) return;
      seen[at] = 1;
      const i = at * 4;
      const d = Math.min(
        ...colors.map(
          (c) => Math.hypot(data[i] - c[0], data[i + 1] - c[1], data[i + 2] - c[2])
        )
      );
      if (d > tolerance + feather) return;
      data[i + 3] = Math.round(
        data[i + 3] * Math.max(0, Math.min(1, (d - tolerance) / Math.max(1, feather)))
      );
      queue[end++] = at;
    };
    for (const [x, y] of corners) enqueue(x, y);
    while (start < end) {
      const at = queue[start++], x = at % w, y = Math.floor(at / w);
      enqueue(x - 1, y);
      enqueue(x + 1, y);
      enqueue(x, y - 1);
      enqueue(x, y + 1);
    }
  }
  const result = await saveAsset(
    await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer(),
    asset.name + " \xB7 \u62A0\u56FE",
    targetDir ?? path.dirname(asset.path),
    w,
    h
  );
  return { ...result, sourceBounds: asset.sourceBounds };
}
async function crop(asset, r, name, targetDir) {
  rect(r, asset.width, asset.height);
  const result = await saveAsset(
    await sharp(asset.path).extract({ left: r.x, top: r.y, width: r.width, height: r.height }).png().toBuffer(),
    name,
    targetDir ?? path.dirname(asset.path),
    r.width,
    r.height
  );
  return { ...result, sourceBounds: r };
}
async function splitComponents(asset, minArea = 16, mergeGap = 4, boxes, targetDir) {
  if (boxes?.length)
    return Promise.all(
      boxes.map((r, i) => crop(asset, r, `${asset.name} ${i + 1}`, targetDir))
    );
  const { data, info } = await sharp(asset.path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, seen = new Uint8Array(w * h), q = new Int32Array(w * h);
  let rects = [];
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || data[i * 4 + 3] < 16) continue;
    let start = 0, end = 1;
    q[0] = i;
    seen[i] = 1;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, count = 0;
    while (start < end) {
      const at = q[start++], x = at % w, y = Math.floor(at / w);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      count++;
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1]
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
        const a = rects[i], b = rects[j];
        if (a.x <= b.x + b.width + mergeGap && b.x <= a.x + a.width + mergeGap && a.y <= b.y + b.height + mergeGap && b.y <= a.y + a.height + mergeGap) {
          const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
          rects[i] = {
            x,
            y,
            width: Math.max(a.x + a.width, b.x + b.width) - x,
            height: Math.max(a.y + a.height, b.y + b.height) - y
          };
          rects.splice(j, 1);
          changed = true;
          break outer;
        }
      }
  }
  rects.sort((a, b) => a.y - b.y || a.x - b.x);
  if (rects.length > 500)
    throw Error("\u5B50\u56FE\u8FC7\u591A\uFF0C\u8BF7\u589E\u5927 mergeGap/minArea \u6216\u63D0\u4F9B\u8BED\u4E49 boxes");
  return Promise.all(
    rects.map((r, i) => crop(asset, r, `${asset.name} ${i + 1}`, targetDir))
  );
}
async function splitGrid(asset, columns, rows, count, padding = 0, gap = 0, targetDir) {
  const w = (asset.width - padding * 2 - gap * (columns - 1)) / columns, h = (asset.height - padding * 2 - gap * (rows - 1)) / rows;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0 || count > rows * columns)
    throw Error("Grid \u5FC5\u987B\u662F\u7B49\u5C3A\u5BF8\u6574\u6570\u5355\u5143\u683C\uFF0Ccount \u4E0D\u5F97\u8D85\u51FA\u5BB9\u91CF");
  return Promise.all(
    Array.from(
      { length: count },
      (_, i) => crop(
        asset,
        {
          x: padding + i % columns * (w + gap),
          y: padding + Math.floor(i / columns) * (h + gap),
          width: w,
          height: h
        },
        `${asset.name} \xB7 \u5E27 ${i + 1}`,
        targetDir
      )
    )
  );
}
var init_images = __esm({
  "server/images.ts"() {
    "use strict";
  }
});

// server/migration.ts
var migration_exports = {};
__export(migration_exports, {
  migrateEmbeddedAsset: () => migrateEmbeddedAsset
});
async function migrateEmbeddedAsset(legacy, dir) {
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(legacy.data))
    throw Error("\u65E7\u9879\u76EE\u56FE\u7247\u683C\u5F0F\u65E0\u6548");
  const result = await makeAsset(
    Buffer.from(legacy.data.split(",")[1], "base64"),
    legacy.name,
    dir
  );
  return { ...result, id: legacy.id, sourceBounds: legacy.sourceBounds };
}
var init_migration = __esm({
  "server/migration.ts"() {
    "use strict";
    init_images();
  }
});

// server/core.ts
import { z as z2 } from "zod";
import { randomUUID as randomUUID2, createHash } from "node:crypto";
import { mkdir as mkdir2, readFile, writeFile as writeFile2, rename } from "node:fs/promises";
import path2 from "node:path";

// src/model.ts
import { z } from "zod";
var easingSchema = z.union([
  z.enum(["linear", "easeIn", "easeOut", "easeInOut"]),
  z.tuple([
    z.number().min(0).max(1),
    z.number(),
    z.number().min(0).max(1),
    z.number()
  ])
]);
var poseSchema = z.object({
  x: z.number(),
  y: z.number(),
  scaleX: z.number().positive().max(100),
  scaleY: z.number().positive().max(100),
  rotation: z.number(),
  opacity: z.number().min(0).max(1)
});
var keyframeSchema = poseSchema.partial().extend({
  frame: z.number().int().min(0).max(71),
  easing: easingSchema.default("linear")
});
var layerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  assetId: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  scaleX: z.number().positive().default(1),
  scaleY: z.number().positive().default(1),
  rotation: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  z: z.number().int().default(0),
  semantic: z.string().default("element"),
  keyframes: z.array(keyframeSchema).max(72).default([]),
  sequence: z.array(z.string()).max(72).default([]),
  sequenceStart: z.number().int().min(0).default(0),
  sequenceEnd: z.number().int().min(0).max(71).optional()
});
var frameCount = (p) => Math.max(1, Math.round(p.fps * p.duration));
function ease(t, e = "linear") {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (e === "linear") return t;
  if (e === "easeIn") return t * t;
  if (e === "easeOut") return 1 - (1 - t) ** 2;
  if (e === "easeInOut")
    return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  const [x1, y1, x2, y2] = e, bez = (a, b, s) => 3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s * s * b + s ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (bez(x1, x2, mid) < t) lo = mid;
    else hi = mid;
  }
  return bez(y1, y2, (lo + hi) / 2);
}
function poseAt(layer, frame) {
  const base = {
    x: layer.x,
    y: layer.y,
    scaleX: layer.scaleX,
    scaleY: layer.scaleY,
    rotation: layer.rotation,
    opacity: layer.opacity
  };
  for (const prop of Object.keys(base)) {
    const keys = layer.keyframes.filter((k) => k[prop] !== void 0).sort((a2, b2) => a2.frame - b2.frame);
    const points = [
      { frame: 0, value: base[prop], easing: "linear" },
      ...keys.map((k) => ({
        frame: k.frame,
        value: k[prop],
        easing: k.easing
      }))
    ];
    let a = points[0], b = points[points.length - 1];
    for (const k of points) {
      if (k.frame <= frame) a = k;
      else {
        b = k;
        break;
      }
    }
    if (frame >= points[points.length - 1].frame) b = a;
    base[prop] = a.frame === b.frame ? a.value : a.value + (b.value - a.value) * ease((frame - a.frame) / (b.frame - a.frame), b.easing);
  }
  return base;
}
function assetAt(l, frame, p) {
  if (!l.sequence.length || frame < l.sequenceStart) return l.assetId;
  const end = l.sequenceEnd ?? frameCount(p) - 1;
  const index = Math.min(
    l.sequence.length - 1,
    Math.floor(
      Math.max(0, frame - l.sequenceStart) * l.sequence.length / (end - l.sequenceStart + 1)
    )
  );
  return l.sequence[index];
}
function bounds(l, p) {
  const w = l.width * p.scaleX, h = l.height * p.scaleY, r = p.rotation * Math.PI / 180;
  const bw = Math.abs(w * Math.cos(r)) + Math.abs(h * Math.sin(r)), bh = Math.abs(w * Math.sin(r)) + Math.abs(h * Math.cos(r));
  return {
    x: p.x + w / 2 - bw / 2,
    y: p.y + h / 2 - bh / 2,
    width: bw,
    height: bh
  };
}
function validateProject(p) {
  if (!Number.isInteger(p.width) || !Number.isInteger(p.height) || p.width < 1 || p.height < 1 || p.width > 4096 || p.height > 4096)
    throw Error("\u753B\u5E03\u5C3A\u5BF8\u5FC5\u987B\u4E3A 1\u20134096 \u6574\u6570");
  if (!Number.isInteger(p.fps) || p.fps < 1 || p.fps > 24 || p.duration <= 0 || p.duration > 3 || !Number.isInteger(Math.round(p.duration * p.fps * 1e6) / 1e6))
    throw Error("FPS \u4E3A 1\u201324\uFF0C\u65F6\u957F \u2264 3 \u79D2\u4E14\u5FC5\u987B\u4E3A\u6574\u5E27");
  const ids = new Set(p.assets.map((a) => a.id));
  if (new Set(p.layers.map((l) => l.id)).size !== p.layers.length)
    throw Error("\u56FE\u5C42 ID \u91CD\u590D");
  for (const l of p.layers) {
    layerSchema.parse(l);
    if (!ids.has(l.assetId) || l.sequence.some((id2) => !ids.has(id2)))
      throw Error("\u56FE\u5C42\u5F15\u7528\u7F3A\u5931\u8D44\u6E90");
    if (new Set(l.keyframes.map((k) => k.frame)).size !== l.keyframes.length)
      throw Error("\u540C\u4E00\u5E27\u53EA\u80FD\u6709\u4E00\u4E2A\u5173\u952E\u5E27");
    if (l.keyframes.some((k) => k.frame >= frameCount(p)) || l.sequenceStart >= frameCount(p) || l.sequenceEnd !== void 0 && (l.sequenceEnd < l.sequenceStart || l.sequenceEnd >= frameCount(p)))
      throw Error("\u65F6\u95F4\u8F74\u8D85\u51FA\u65F6\u957F");
    for (let f = 0; f < frameCount(p); f++) {
      const b = bounds(l, poseAt(l, f));
      if (b.x < -0.01 || b.y < -0.01 || b.x + b.width > p.width + 0.01 || b.y + b.height > p.height + 0.01)
        throw Error(`\u56FE\u5C42 ${l.name} \u5728\u7B2C ${f} \u5E27\u8D85\u51FA\u753B\u5E03\u8FB9\u754C`);
    }
  }
}

// server/core.ts
init_images();
var id = z2.string().uuid();
var num = z2.number().finite();
var rect2 = z2.object({
  x: num.int().min(0),
  y: num.int().min(0),
  width: num.int().positive(),
  height: num.int().positive()
});
var operations = {
  list: z2.object({}),
  current: z2.object({}),
  export_status: z2.object({ jobId: id }),
  cancel_export: z2.object({ jobId: id }),
  create: z2.object({
    name: z2.string().default("\u672A\u547D\u540D\u52A8\u753B"),
    width: num.int().min(1).max(4096),
    height: num.int().min(1).max(4096),
    fps: num.int().min(1).max(24).default(24),
    duration: num.positive().max(3).default(3),
    background: z2.string().regex(/^(#[0-9a-f]{6}|transparent)$/i).default("transparent")
  }),
  get: z2.object({ projectId: id, activate: z2.boolean().default(false) }),
  restore: z2.object({ project: z2.unknown() }),
  settings: z2.object({
    projectId: id,
    name: z2.string().optional(),
    width: num.int().positive().max(4096).optional(),
    height: num.int().positive().max(4096).optional(),
    fps: num.int().min(1).max(24).optional(),
    duration: num.positive().max(3).optional(),
    background: z2.string().regex(/^(#[0-9a-f]{6}|transparent)$/i).optional()
  }),
  reset: z2.object({
    preserve: z2.boolean().default(true)
  }),
  import_image: z2.object({
    projectId: id,
    path: z2.string().min(1),
    name: z2.string(),
    reference: z2.boolean().default(false)
  }),
  key_image: z2.object({
    projectId: id,
    assetId: id,
    tolerance: num.min(0).max(255).default(36),
    feather: num.min(0).max(100).default(12),
    regions: z2.array(rect2).max(100).optional()
  }),
  split_atlas: z2.object({
    projectId: id,
    assetId: id,
    minArea: num.int().positive().default(16),
    mergeGap: num.int().min(0).max(100).default(4),
    boxes: z2.array(rect2).max(500).optional(),
    addLayers: z2.boolean().default(true),
    z: num.int().default(0)
  }),
  split_grid: z2.object({
    projectId: id,
    assetId: id,
    columns: num.int().positive().max(72),
    rows: num.int().positive().max(72),
    count: num.int().positive().max(72),
    padding: num.int().min(0).default(0),
    gap: num.int().min(0).default(0)
  }),
  add_layer: z2.object({ projectId: id, layer: layerSchema.omit({ id: true }) }),
  update_layer: z2.object({
    projectId: id,
    layerId: id,
    patch: layerSchema.omit({
      id: true,
      keyframes: true,
      sequence: true,
      sequenceStart: true,
      sequenceEnd: true
    }).partial()
  }),
  remove_layer: z2.object({ projectId: id, layerId: id }),
  keyframes: z2.object({
    projectId: id,
    layerId: id,
    keyframes: z2.array(keyframeSchema).max(72)
  }),
  sequence: z2.object({
    projectId: id,
    layerId: id,
    assetIds: z2.array(id).min(1).max(72),
    startFrame: num.int().min(0).default(0),
    endFrame: num.int().min(0).max(71).optional()
  }),
  playback: z2.object({
    projectId: id,
    frame: num.int().min(0).optional(),
    playing: z2.boolean().optional()
  }),
  snapshot: z2.object({ projectId: id, frame: num.int().min(0).default(0) }),
  review: z2.object({
    projectId: id,
    score: num.min(0).max(1),
    notes: z2.string().min(1),
    snapshotHash: z2.string().length(64)
  }),
  export: z2.object({
    projectId: id,
    format: z2.enum(["gif", "png", "png-sequence", "project"]).default("gif"),
    frame: num.int().min(0).default(0),
    frames: num.int().positive().optional(),
    manualToken: z2.string().optional()
  })
};
var visualHash = (p) => createHash("sha256").update(
  JSON.stringify({
    width: p.width,
    height: p.height,
    background: p.background,
    assets: p.assets.filter(
      (a) => p.layers.some((l) => assetAt(l, 0, p) === a.id) || p.reference === a.id
    ),
    layers: p.layers.map((l) => ({
      assetId: assetAt(l, 0, p),
      width: l.width,
      height: l.height,
      z: l.z,
      visible: l.visible,
      ...poseAt(l, 0)
    }))
  })
).digest("hex");
function autoScaleLayer(layer, p) {
  let targetMaxWidth = p.width;
  let targetMaxHeight = p.height;
  if (layer.assetId) {
    const asset = p.assets.find((s) => s.id === layer.assetId);
    if (asset) {
      targetMaxWidth = Math.min(targetMaxWidth, asset.width);
      targetMaxHeight = Math.min(targetMaxHeight, asset.height);
    }
  }
  if (layer.width > targetMaxWidth || layer.height > targetMaxHeight) {
    const scale = Math.min(
      targetMaxWidth / Math.max(1, layer.width),
      targetMaxHeight / Math.max(1, layer.height)
    );
    if (scale < 1) {
      layer.width = Math.max(1, Math.round(layer.width * scale));
      layer.height = Math.max(1, Math.round(layer.height * scale));
    }
  }
}
var Store = class {
  constructor(root, render, jobs) {
    this.root = root;
    this.render = render;
    this.jobs = jobs;
  }
  projects = /* @__PURE__ */ new Map();
  snapshots = /* @__PURE__ */ new Map();
  getProjectDirs(projectId2) {
    const projectDir = path2.join(this.root, "projects", projectId2);
    return {
      root: projectDir,
      inputs: path2.join(projectDir, "inputs"),
      outputs: path2.join(projectDir, "outputs"),
      temp: path2.join(projectDir, "temp"),
      assets: path2.join(projectDir, "assets"),
      projectFile: path2.join(projectDir, "project.json")
    };
  }
  async reset() {
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(path2.join(this.root, ".active-project"));
    } catch {
    }
  }
  async focus(projectId2) {
    await mkdir2(this.root, { recursive: true });
    await writeFile2(path2.join(this.root, ".active-project"), projectId2);
  }
  async active() {
    try {
      return id.parse(
        await readFile(path2.join(this.root, ".active-project"), "utf8")
      );
    } catch {
      return void 0;
    }
  }
  async get(projectId2) {
    const dirs = this.getProjectDirs(projectId2);
    let p;
    try {
      p = JSON.parse(await readFile(dirs.projectFile, "utf8"));
    } catch {
      p = JSON.parse(
        await readFile(path2.join(this.root, projectId2 + ".json"), "utf8")
      );
    }
    let migrated = false;
    for (const legacy of p.assets) {
      if (legacy.data) {
        const { migrateEmbeddedAsset: migrateEmbeddedAsset2 } = await Promise.resolve().then(() => (init_migration(), migration_exports));
        const asset = await migrateEmbeddedAsset2(
          legacy,
          dirs.assets
        );
        Object.assign(legacy, asset);
        delete legacy.data;
        migrated = true;
      }
    }
    if (migrated) {
      p.reviews = [];
      p.stage = p.stage === "failed" ? "failed" : "compose";
      p.revision++;
      await this.save(p);
    }
    this.projects.set(projectId2, p);
    return structuredClone(p);
  }
  async save(p) {
    await mkdir2(this.root, { recursive: true });
    await mkdir2(path2.join(this.root, "assets"), { recursive: true });
    await mkdir2(path2.join(this.root, "exports"), { recursive: true });
    const dirs = this.getProjectDirs(p.id);
    await mkdir2(dirs.root, { recursive: true });
    await mkdir2(dirs.inputs, { recursive: true });
    await mkdir2(dirs.outputs, { recursive: true });
    await mkdir2(dirs.temp, { recursive: true });
    await mkdir2(dirs.assets, { recursive: true });
    const tempProj = dirs.projectFile + "." + randomUUID2() + ".tmp";
    await writeFile2(tempProj, JSON.stringify(p, null, 2));
    await rename(tempProj, dirs.projectFile);
    const dest = path2.join(this.root, p.id + ".json");
    const temporary = dest + "." + randomUUID2() + ".tmp";
    await writeFile2(temporary, JSON.stringify(p));
    await rename(temporary, dest);
    this.projects.set(p.id, p);
  }
  async execute(op, input) {
    const a = operations[op].parse(input);
    if (op === "reset") {
      await this.reset();
      return { project: null };
    }
    if (op === "current") {
      const active = await this.active();
      return { project: active ? await this.get(active) : null };
    }
    if (op === "export_status") {
      if (!this.jobs) throw Error("\u5BFC\u51FA\u670D\u52A1\u672A\u542F\u52A8");
      return { job: this.jobs.status(a.jobId) };
    }
    if (op === "cancel_export") {
      if (!this.jobs) throw Error("\u5BFC\u51FA\u670D\u52A1\u672A\u542F\u52A8");
      return { job: await this.jobs.cancel(a.jobId) };
    }
    if (op === "restore") {
      const parsed = z2.object({
        name: z2.string().min(1),
        width: num.int(),
        height: num.int(),
        fps: num.int(),
        duration: num,
        background: z2.string().regex(/^(#[0-9a-f]{6}|transparent)$/i),
        layers: z2.array(layerSchema).max(500),
        assets: z2.array(
          z2.object({
            id,
            name: z2.string(),
            path: z2.string().min(1),
            width: num.int().positive(),
            height: num.int().positive(),
            sourceBounds: rect2.optional()
          })
        ).max(500),
        reference: id.optional()
      }).parse(a.project);
      for (const l of parsed.layers) id.parse(l.id);
      if (new Set(parsed.assets.map((a2) => a2.id)).size !== parsed.assets.length)
        throw Error("\u8D44\u6E90ID\u91CD\u590D");
      if (parsed.reference && !parsed.assets.some((a2) => a2.id === parsed.reference))
        throw Error("\u53C2\u8003\u56FE\u4E0D\u5B58\u5728");
      let total = 0;
      for (const asset2 of parsed.assets) {
        total += (await (await import("node:fs/promises")).stat(asset2.path)).size;
        if (total > 256 * 1024 * 1024) throw Error("\u9879\u76EE\u8D44\u6E90\u8D85\u8FC7256MB");
        const checked = await makeAsset(
          asset2.path,
          asset2.name,
          path2.join(this.root, "assets")
        );
        if (checked.width !== asset2.width || checked.height !== asset2.height)
          throw Error("\u8D44\u6E90\u5C3A\u5BF8\u4E0E\u5B9E\u9645\u56FE\u7247\u4E0D\u7B26");
        asset2.path = checked.path;
      }
      const p2 = {
        ...parsed,
        id: randomUUID2(),
        revision: 0,
        reviews: [],
        stage: "compose",
        frame: 0,
        playing: false
      };
      validateProject(p2);
      await this.save(p2);
      await this.focus(p2.id);
      return { project: p2 };
    }
    if (op === "list") {
      const { readdir } = await import("node:fs/promises");
      await mkdir2(this.root, { recursive: true });
      const projects = [];
      const seenIds = /* @__PURE__ */ new Set();
      const projectsDir = path2.join(this.root, "projects");
      try {
        const subdirs = await readdir(projectsDir);
        for (const sub of subdirs) {
          if (/^[0-9a-f-]{36}$/.test(sub)) {
            try {
              const p2 = await this.get(sub);
              projects.push({
                id: p2.id,
                name: p2.name,
                width: p2.width,
                height: p2.height
              });
              seenIds.add(p2.id);
            } catch {
            }
          }
        }
      } catch {
      }
      const files = await readdir(this.root);
      for (const f of files.filter((f2) => /^[0-9a-f-]{36}\.json$/.test(f2))) {
        const id2 = f.slice(0, -5);
        if (!seenIds.has(id2)) {
          try {
            const p2 = await this.get(id2);
            projects.push({
              id: p2.id,
              name: p2.name,
              width: p2.width,
              height: p2.height
            });
            seenIds.add(p2.id);
          } catch {
          }
        }
      }
      return { projects, activeProjectId: await this.active() };
    }
    if (op === "create") {
      const p2 = {
        ...a,
        id: randomUUID2(),
        revision: 0,
        layers: [],
        assets: [],
        reviews: [],
        stage: "split",
        frame: 0,
        playing: false
      };
      validateProject(p2);
      await this.save(p2);
      await this.focus(p2.id);
      return { project: p2 };
    }
    const p = await this.get(a.projectId);
    if (op === "get") {
      if (a.activate) await this.focus(p.id);
      return { project: p };
    }
    if (p.stage === "failed" && !["snapshot", "export", "playback"].includes(op))
      throw Error("\u4EFB\u52A1\u5931\u8D25\uFF1A3\u8F6E\u5BA1\u67E5\u5DF2\u7528\u5C3D\uFF0C\u8BF7\u521B\u5EFA\u65B0\u9879\u76EE");
    const layer = () => {
      const l = p.layers.find((l2) => l2.id === a.layerId);
      if (!l) throw Error("\u56FE\u5C42\u4E0D\u5B58\u5728");
      return l;
    };
    const asset = () => {
      const s = p.assets.find((s2) => s2.id === a.assetId);
      if (!s) throw Error("\u8D44\u6E90\u4E0D\u5B58\u5728");
      return s;
    };
    const approved = p.reviews.some(
      (r) => r.score >= 0.8 && r.snapshotHash === visualHash(p)
    );
    const animationGate = () => {
      if (p.stage === "failed") throw Error("3\u8F6E\u5BA1\u67E5\u672A\u901A\u8FC7\uFF0C\u4EFB\u52A1\u5931\u8D25");
      if (!approved) throw Error("\u5408\u56FE\u9700\u5148\u901A\u8FC7 \u226580% \u7684\u89C6\u89C9\u5BA1\u67E5");
    };
    let extra = {};
    if (op === "snapshot") {
      if (a.frame >= frameCount(p)) throw Error("\u5E27\u8D85\u51FA\u65F6\u957F");
      const result = await this.render(p, "png", a.frame);
      const hash = visualHash(p);
      if (a.frame === 0) this.snapshots.set(p.id, hash);
      return {
        ...result,
        projectId: p.id,
        snapshotHash: hash,
        frame: a.frame,
        layers: p.layers
      };
    }
    if (op === "review") {
      if (p.stage === "failed" || p.reviews.length >= 3)
        throw Error("\u5DF2\u8FBE\u5230\u6700\u591A3\u8F6E\u5BA1\u67E5");
      const hash = visualHash(p);
      if (this.snapshots.get(p.id) !== a.snapshotHash || hash !== a.snapshotHash)
        throw Error("\u622A\u56FE\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u5148\u83B7\u53D6\u5F53\u524D\u7B2C0\u5E27 snapshot");
      p.reviews.push({
        round: p.reviews.length + 1,
        score: a.score,
        notes: a.notes,
        snapshotHash: hash,
        revision: p.revision,
        at: (/* @__PURE__ */ new Date()).toISOString()
      });
      p.stage = a.score >= 0.8 ? "animate" : p.reviews.length >= 3 ? "failed" : "compose";
      this.snapshots.delete(p.id);
    }
    if (op === "export") {
      if (a.frame >= frameCount(p)) throw Error("\u5E27\u8D85\u51FA\u65F6\u957F");
      if (a.frames !== void 0 && a.frames > frameCount(p)) {
        throw Error("\u4FEE\u6539\u5E27\u6570\u4E0D\u80FD\u8D85\u8FC7\u9884\u89C8\u72B6\u6001\u4E0B\u7684\u5E27\u6570");
      }
      if (a.format !== "project") animationGate();
      if (!this.jobs) throw Error("\u5BFC\u51FA\u53EA\u80FD\u7531\u7528\u6237\u5728\u9762\u677F\u4E2D\u624B\u52A8\u542F\u52A8");
      const dirs = this.getProjectDirs(p.id);
      await mkdir2(dirs.outputs, { recursive: true });
      await mkdir2(dirs.temp, { recursive: true });
      return {
        job: this.jobs.start(
          p,
          a.format,
          a.frame,
          a.frames,
          dirs.outputs,
          dirs.temp
        ),
        projectId: p.id
      };
    }
    if (op === "settings") {
      const oldFrames = frameCount(p);
      const { projectId: projectId2, ...patch } = a;
      Object.assign(p, patch);
      p.frame = Math.min(p.frame, frameCount(p) - 1);
      const newFrames = frameCount(p);
      if (oldFrames !== newFrames) {
        for (const l of p.layers) {
          l.keyframes = l.keyframes.map((k) => ({
            ...k,
            frame: oldFrames > 1 && newFrames > 1 ? Math.min(
              newFrames - 1,
              Math.round(k.frame / (oldFrames - 1) * (newFrames - 1))
            ) : Math.min(newFrames - 1, k.frame)
          }));
          if (l.sequenceEnd !== void 0) {
            l.sequenceEnd = oldFrames > 1 && newFrames > 1 ? Math.min(
              newFrames - 1,
              Math.round(
                l.sequenceEnd / (oldFrames - 1) * (newFrames - 1)
              )
            ) : Math.min(newFrames - 1, l.sequenceEnd);
          }
          if (l.sequenceStart > 0) {
            l.sequenceStart = oldFrames > 1 && newFrames > 1 ? Math.min(
              newFrames - 1,
              Math.round(
                l.sequenceStart / (oldFrames - 1) * (newFrames - 1)
              )
            ) : Math.min(newFrames - 1, l.sequenceStart);
          }
        }
      }
    }
    if (op === "import_image") {
      const dirs = this.getProjectDirs(p.id);
      await mkdir2(dirs.inputs, { recursive: true });
      const s = await makeAsset(a.path, a.name, dirs.inputs);
      p.assets.push(s);
      if (a.reference) p.reference = s.id;
      extra.asset = s;
    }
    if (op === "key_image") {
      const dirs = this.getProjectDirs(p.id);
      await mkdir2(dirs.assets, { recursive: true });
      const s = await keyImage(asset(), a.tolerance, a.feather, a.regions, dirs.assets);
      p.assets.push(s);
      extra.asset = s;
    }
    if (op === "split_atlas" || op === "split_grid") {
      const dirs = this.getProjectDirs(p.id);
      await mkdir2(dirs.assets, { recursive: true });
      const items = op === "split_grid" ? await splitGrid(
        asset(),
        a.columns,
        a.rows,
        a.count,
        a.padding,
        a.gap,
        dirs.assets
      ) : await splitComponents(
        asset(),
        a.minArea,
        a.mergeGap,
        a.boxes,
        dirs.assets
      );
      p.assets.push(...items);
      extra.assets = items;
      if (op === "split_atlas" && a.addLayers)
        for (const [index, s] of items.entries()) {
          const b = s.sourceBounds;
          const l = layerSchema.parse({
            id: randomUUID2(),
            name: s.name,
            assetId: s.id,
            x: b.x,
            y: b.y,
            width: s.width,
            height: s.height,
            z: a.z + index
          });
          autoScaleLayer(l, p);
          p.layers.push(l);
        }
      p.stage = "compose";
    }
    if (op === "add_layer") {
      const l = { ...a.layer, id: randomUUID2() };
      autoScaleLayer(l, p);
      p.layers.push(l);
    }
    if (op === "update_layer") {
      const l = layer();
      if (l.locked && Object.keys(a.patch).some((k) => k !== "locked"))
        throw Error("\u8BF7\u5148\u89E3\u9501\u56FE\u5C42");
      Object.assign(l, a.patch);
      autoScaleLayer(l, p);
    }
    if (op === "remove_layer") {
      if (layer().locked) throw Error("\u8BF7\u5148\u89E3\u9501\u56FE\u5C42");
      p.layers = p.layers.filter((l) => l.id !== a.layerId);
    }
    if (op === "keyframes") {
      animationGate();
      if (layer().locked) throw Error("\u8BF7\u5148\u89E3\u9501\u56FE\u5C42");
      layer().keyframes = a.keyframes;
      p.stage = "animate";
    }
    if (op === "sequence") {
      animationGate();
      const l = layer();
      if (l.locked) throw Error("\u8BF7\u5148\u89E3\u9501\u56FE\u5C42");
      l.sequence = a.assetIds;
      l.sequenceStart = a.startFrame;
      l.sequenceEnd = a.endFrame ?? frameCount(p) - 1;
      p.stage = "animate";
    }
    if (op === "playback") {
      if (a.frame !== void 0) {
        if (a.frame >= frameCount(p)) throw Error("\u5E27\u8D85\u51FA\u65F6\u957F");
        p.frame = a.frame;
      }
      if (a.playing !== void 0) p.playing = a.playing;
    }
    validateProject(p);
    if (["settings", "add_layer", "update_layer", "remove_layer"].includes(op) && p.stage !== "failed" && !p.reviews.some((r) => r.score >= 0.8 && r.snapshotHash === visualHash(p)))
      p.stage = "compose";
    p.revision++;
    await this.save(p);
    if (op !== "playback") await this.focus(p.id);
    return { project: p, ...extra };
  }
};

// output/r1000-animation/edit.ts
import path3 from "node:path";
var store = new Store(path3.resolve(".animation-data"), async () => {
  throw Error("Use MCP snapshot");
});
var projectId = "f4f4d8a6-17cc-4ace-a514-10f287d0c9a7";
var action = process.argv[2];
var exec = (op, args) => store.execute(op, { projectId, ...args });
if (action === "compose") {
  await exec("get", {});
  await exec("add_layer", { layer: { name: "\u4E3B\u4F53 \xB7 R$1000 / Pix", assetId: "7ec574ce-e25f-4f06-a828-eb7687735717", x: 12, y: 0, width: 728, height: 666, z: 10, semantic: "foreground" } });
  await exec("add_layer", { layer: { name: "DOBRAR AGORA \xB7 \u7F29\u653E\u6309\u94AE", assetId: "c3fd93bf-0857-4c40-99b8-f77fbb494439", x: 149, y: 650, width: 470, height: 117.5, z: 20, semantic: "button" } });
  const xs = [40, 130, 240, 360, 475, 580, 670, 80, 620, 310, 530, 180];
  for (let i = 0; i < xs.length; i++) {
    const size = 35 + i % 4 * 8;
    await exec("add_layer", { layer: { name: `\u80CC\u540E\u91D1\u5E01 ${i + 1}`, assetId: "38ef15fc-d194-457a-87a3-22ada347776a", x: xs[i], y: 35 + i * 127 % 640, width: size, height: size * 200 / 205, z: i % 3, semantic: "falling coin" } });
  }
}
if (action === "prepare") {
  const p = await exec("get", {});
  const xs = [40, 130, 240, 360, 475, 580, 670, 80, 620, 310, 530, 180];
  for (const [i, l] of p.project.layers.filter((l2) => l2.semantic === "falling coin").entries()) {
    const t = i * 6 % 72 / 71;
    await exec("update_layer", { layerId: l.id, patch: { x: xs[i] + Math.sin(t * Math.PI * 2 + i) * 9, y: 18 + t * (745 - l.height), rotation: -25 + t * 140, opacity: t < 0.07 ? t / 0.07 : t > 0.9 ? (1 - t) / 0.1 : 1 } });
  }
}
if (action === "animate") {
  const p = await exec("get", {});
  const b = p.project.layers.find((l) => l.semantic === "button");
  const keys = [0, 12, 24, 36, 48, 60, 71].map((frame, i) => {
    const s = i % 2 ? 1.07 : 1;
    return { frame, scaleX: s, scaleY: s, x: b.x - b.width * (s - 1) / 2, y: b.y - b.height * (s - 1) / 2, easing: "easeInOut" };
  });
  await exec("keyframes", { layerId: b.id, keyframes: keys });
  const coins = p.project.layers.filter((l) => l.semantic === "falling coin");
  for (const [i, l] of coins.entries()) {
    const ks = [];
    for (let frame = 0; frame < 72; frame++) {
      const t = (frame + i * 6) % 72 / 71;
      const xs = [40, 130, 240, 360, 475, 580, 670, 80, 620, 310, 530, 180];
      ks.push({ frame, x: xs[i] + Math.sin(t * Math.PI * 2 + i) * 9, y: 18 + t * (745 - l.height), rotation: -25 + t * 140, opacity: t < 0.07 ? t / 0.07 : t > 0.9 ? (1 - t) / 0.1 : 1, easing: "linear" });
    }
    await exec("keyframes", { layerId: l.id, keyframes: ks });
  }
}
console.log(JSON.stringify({ done: action }));
