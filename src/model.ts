import { shapeMaskSchema } from "./masks";
import { z } from "zod";

export const easingSchema = z.union([
  z.enum(["linear", "easeIn", "easeOut", "easeInOut"]),
  // Homogeneous items keep MCP tool schemas compatible with hosts that
  // cannot convert JSON Schema tuple-style items into model tool arguments.
  z.array(z.number())
    .length(4)
    .refine((v) => v[0] >= 0 && v[0] <= 1 && v[2] >= 0 && v[2] <= 1,
      { message: "Bezier x control points must be between 0 and 1" })
    .transform((v): [number, number, number, number] => [v[0], v[1], v[2], v[3]]),
]);

export type Easing = z.infer<typeof easingSchema>;

export const poseSchema = z.object({
  x: z.number(),
  y: z.number(),
  scaleX: z.number().positive().max(100),
  scaleY: z.number().positive().max(100),
  rotation: z.number(),
  opacity: z.number().min(0).max(1),
});

export const keyframeSchema = poseSchema.partial().extend({
  frame: z.number().int().min(0).max(71),
  easing: easingSchema.default("linear"),
});

export const sweepSchema = z.object({
  type: z.literal("sweep"),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .default("#ffffff"),
  width: z.number().min(0.02).max(1).default(0.25),
  angle: z.number().min(-75).max(75).default(20),
  opacity: z.number().min(0).max(1).default(0.7),
  startFrame: z.number().int().min(0).max(71).default(0),
  endFrame: z.number().int().min(1).max(71).optional(),
  direction: z.enum(["forward", "reverse"]).default("forward"),
});

export const layerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  assetId: z.string(),
  groupId: z.string().uuid().optional(),
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
  transformOrigin: z.enum(["visual-center", "legacy"]).optional(),
  pivotX: z.number().min(0).max(1).optional(),
  pivotY: z.number().min(0).max(1).optional(),
  effect: sweepSchema.nullable().optional(),
  shapeMask: shapeMaskSchema.nullable().optional(),
  keyframes: z.array(keyframeSchema).max(72).default([]),
  sequence: z.array(z.string()).max(72).default([]),
  sequenceStart: z.number().int().min(0).default(0),
  sequenceEnd: z.number().int().min(0).max(71).optional(),
});

export type Keyframe = z.infer<typeof keyframeSchema>;
export type Layer = z.infer<typeof layerSchema>;
export type Pose = z.infer<typeof poseSchema>;
export type Asset = {
  id: string;
  name: string;
  path: string;
  width: number;
  height: number;
  bytes?: number;
  sourceBounds?: { x: number; y: number; width: number; height: number };
  transparent?: boolean;
  visualCenter?: { x: number; y: number };
};
export type Review = {
  round: number;
  score: number;
  notes: string;
  snapshotHash: string;
  revision: number;
  at: string;
};
export type LayerGroup = {
  id: string;
  name: string;
  parentId?: string;
  visible: boolean;
};
export type Scene = { id: "scene"; name: string; visible: boolean };
export type Project = {
  groups?: LayerGroup[];
  scene?: Scene;
  backgroundExplicit?: boolean;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  background: string;
  revision: number;
  layers: Layer[];
  assets: Asset[];
  reference?: string;
  reviews: Review[];
  stage: "split" | "compose" | "animate" | "export" | "failed";
  frame: number;
  playing: boolean;
};

export const frameCount = (p: Pick<Project, "fps" | "duration">) =>
  Math.max(1, Math.round(p.fps * p.duration));

export function calculateFpsForDuration(
  desiredDuration: number,
  currentFps: number = 24,
): { duration: number; fps: number } {
  const clampedDuration = Math.min(3.0, Math.max(0.5, desiredDuration));
  const duration = clampedDuration;
  const fps = Math.min(24, Math.max(1, Math.round(currentFps || 24)));
  return { duration: Math.round(duration * fps) / fps, fps };
}

export function ease(t: number, e: Easing = "linear"): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (e === "linear") return t;
  if (e === "easeIn") return t * t;
  if (e === "easeOut") return 1 - (1 - t) ** 2;
  if (e === "easeInOut") return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  const [x1, y1, x2, y2] = e,
    bez = (a: number, b: number, s: number) =>
      3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s * s * b + s ** 3;
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (bez(x1, x2, mid) < t) lo = mid;
    else hi = mid;
  }
  return bez(y1, y2, (lo + hi) / 2);
}

export function poseAt(layer: Layer, frame: number): Pose {
  const base = {
    x: layer.x,
    y: layer.y,
    scaleX: layer.scaleX,
    scaleY: layer.scaleY,
    rotation: layer.rotation,
    opacity: layer.opacity,
  };
  for (const prop of Object.keys(base) as (keyof Pose)[]) {
    const keys = layer.keyframes
      .filter((k) => k[prop] !== undefined)
      .sort((a, b) => a.frame - b.frame);
    const points = [
      { frame: 0, value: base[prop], easing: "linear" as Easing },
      ...keys.map((k) => ({
        frame: k.frame,
        value: k[prop]!,
        easing: k.easing,
      })),
    ];
    let a = points[0],
      b = points[points.length - 1];
    for (const k of points) {
      if (k.frame <= frame) a = k;
      else {
        b = k;
        break;
      }
    }
    if (frame >= points[points.length - 1].frame) b = a;
    base[prop] =
      a.frame === b.frame
        ? a.value
        : a.value +
          (b.value - a.value) *
            ease((frame - a.frame) / (b.frame - a.frame), b.easing);
  }
  return base;
}

export function assetAt(l: Layer, frame: number, p: Project): string {
  if (!l.sequence.length || frame < l.sequenceStart) return l.assetId;
  const end = l.sequenceEnd ?? frameCount(p) - 1;
  const index = Math.min(
    l.sequence.length - 1,
    Math.floor(
      (Math.max(0, frame - l.sequenceStart) * l.sequence.length) /
        (end - l.sequenceStart + 1),
    ),
  );
  return l.sequence[index];
}

// x/y remain unscaled top-left. New layers scale/rotate around a fixed alpha-weighted visual pivot.
export function transformGeometry(
  l: Layer,
  p: Pose,
  w = l.width * p.scaleX,
  h = l.height * p.scaleY,
) {
  const px = l.transformOrigin === "visual-center" ? (l.pivotX ?? 0.5) : 0.5,
    py = l.transformOrigin === "visual-center" ? (l.pivotY ?? 0.5) : 0.5;
  const r = (p.rotation * Math.PI) / 180,
    c = Math.cos(r),
    s = Math.sin(r);
  const anchorX =
      p.x + (l.transformOrigin === "visual-center" ? l.width * px : w / 2),
    anchorY =
      p.y + (l.transformOrigin === "visual-center" ? l.height * py : h / 2);
  const dx = (0.5 - px) * w,
    dy = (0.5 - py) * h;
  return {
    pivotX: px,
    pivotY: py,
    anchorX,
    anchorY,
    centerX: anchorX + dx * c - dy * s,
    centerY: anchorY + dx * s + dy * c,
  };
}
export function bounds(l: Layer, p: Pose) {
  const w = l.width * p.scaleX,
    h = l.height * p.scaleY,
    r = (p.rotation * Math.PI) / 180;
  const bw = Math.abs(w * Math.cos(r)) + Math.abs(h * Math.sin(r)),
    bh = Math.abs(w * Math.sin(r)) + Math.abs(h * Math.cos(r));
  const g = transformGeometry(l, p, w, h);
  return {
    x: g.centerX - bw / 2,
    y: g.centerY - bh / 2,
    width: bw,
    height: bh,
  };
}

export function validateProject(p: Project) {
  if (
    !Number.isInteger(p.width) ||
    !Number.isInteger(p.height) ||
    p.width < 1 ||
    p.height < 1 ||
    p.width > 4096 ||
    p.height > 4096
  )
    throw Error("画布尺寸必须为 1–4096 整数");
  if (
    !Number.isInteger(p.fps) ||
    p.fps < 1 ||
    p.fps > 24 ||
    p.duration <= 0 ||
    p.duration > 3 ||
    !Number.isInteger(Math.round(p.duration * p.fps * 1e6) / 1e6)
  )
    throw Error("FPS 为 1–24，时长 ≤ 3 秒且必须为整帧");
  validateGroups(p);
  const ids = new Set(p.assets.map((a) => a.id));
  if (new Set(p.layers.map((l) => l.id)).size !== p.layers.length)
    throw Error("图层 ID 重复");
  for (const l of p.layers) {
    layerSchema.parse(l);
    if (
      l.effect &&
      (l.effect.startFrame >= (l.effect.endFrame ?? frameCount(p) - 1) ||
        (l.effect.endFrame ?? 0) >= frameCount(p))
    )
      throw Error("扫光时间段超出时间轴或起止帧无效");
    if (!ids.has(l.assetId) || l.sequence.some((id) => !ids.has(id)))
      throw Error("图层引用缺失资源");
    if (new Set(l.keyframes.map((k) => k.frame)).size !== l.keyframes.length)
      throw Error("同一帧只能有一个关键帧");
    if (
      l.keyframes.some((k) => k.frame >= frameCount(p)) ||
      l.sequenceStart >= frameCount(p) ||
      (l.sequenceEnd !== undefined &&
        (l.sequenceEnd < l.sequenceStart || l.sequenceEnd >= frameCount(p)))
    )
      throw Error("时间轴超出时长");
    for (let f = 0; f < frameCount(p); f++) {
      const b = bounds(l, poseAt(l, f));
      if (
        b.x < -0.01 ||
        b.y < -0.01 ||
        b.x + b.width > p.width + 0.01 ||
        b.y + b.height > p.height + 0.01
      )
        throw Error(`图层 ${l.name} 在第 ${f} 帧超出画布边界`);
    }
  }
}

// Remove only keys whose removal preserves every sampled pose within subpixel tolerances.
export function simplifyKeyframes(layer: Layer, frames: number): Keyframe[] {
  const keys = [...layer.keyframes].sort((a, b) => a.frame - b.frame);
  const original = Array.from({ length: frames }, (_, frame) =>
    poseAt(layer, frame),
  );
  const tolerance: Record<keyof Pose, number> = {
    x: 0.25,
    y: 0.25,
    scaleX: 0.001,
    scaleY: 0.001,
    rotation: 0.1,
    opacity: 0.001,
  };
  for (let i = keys.length - 2; i > 0; i--) {
    const candidate = keys.filter((_, index) => index !== i);
    const test = { ...layer, keyframes: candidate };
    if (
      original.every((pose, frame) => {
        const next = poseAt(test, frame);
        return (Object.keys(tolerance) as (keyof Pose)[]).every(
          (k) => Math.abs(pose[k] - next[k]) <= tolerance[k],
        );
      })
    )
      keys.splice(i, 1);
  }
  return keys;
}
export function retimeLayer(
  layer: Layer,
  oldFrames: number,
  newFrames: number,
) {
  const mapFrame = (f: number) =>
    oldFrames > 1
      ? Math.min(
          newFrames - 1,
          Math.round((f / (oldFrames - 1)) * (newFrames - 1)),
        )
      : 0;
  const mapped = new Map<number, Keyframe>();
  for (const key of simplifyKeyframes(layer, oldFrames)) {
    const frame = mapFrame(key.frame);
    mapped.set(frame, { ...mapped.get(frame), ...key, frame });
  }
  layer.keyframes = simplifyKeyframes(
    { ...layer, keyframes: [...mapped.values()] },
    newFrames,
  );
  if (layer.effect) {
    if (newFrames < 2) throw Error("扫光动画至少需要2帧");
    layer.effect.startFrame = Math.min(
      newFrames - 2,
      mapFrame(layer.effect.startFrame),
    );
    if (layer.effect.endFrame !== undefined)
      layer.effect.endFrame = Math.max(
        layer.effect.startFrame + 1,
        mapFrame(layer.effect.endFrame),
      );
  }
  layer.sequenceStart = mapFrame(layer.sequenceStart);
  if (layer.sequenceEnd !== undefined)
    layer.sequenceEnd = Math.max(
      layer.sequenceStart,
      mapFrame(layer.sequenceEnd),
    );
}
export function exportTiming(
  p: Pick<Project, "fps" | "duration">,
  options: { fps?: number; duration?: number } = {},
  frames?: number,
) {
  const fps = options.fps ?? p.fps,
    duration = options.duration ?? p.duration;
  if (
    !Number.isInteger(fps) ||
    fps < 1 ||
    fps > 24 ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 3
  )
    throw Error("导出 FPS 必须为1–24整数，时长大于0且不超过3秒");
  if (frames !== undefined) {
    if (options.fps !== undefined || options.duration !== undefined)
      throw Error("导出帧数不能与FPS/时长同时指定");
    if (!Number.isInteger(frames) || frames < 1 || frames > frameCount(p))
      throw Error("导出帧数不能超过预览状态下的帧数，且必须为正整数");
    return { fps: frames / p.duration, duration: p.duration, total: frames };
  }
  const total = Math.round(fps * duration);
  if (total < 1 || Math.abs(total - fps * duration) > 1e-6)
    throw Error("导出时长必须为整数帧/FPS");
  return { fps, duration, total };
}

export function isLayerVisible(p: Project, l: Layer) {
  if (!l.visible || p.scene?.visible === false) return false;
  let id = l.groupId;
  const seen = new Set<string>();
  while (id) {
    if (seen.has(id)) return false;
    seen.add(id);
    const group = p.groups?.find((g) => g.id === id);
    if (!group || !group.visible) return false;
    id = group.parentId;
  }
  return true;
}
export function validateGroups(p: Project) {
  const groups = p.groups ?? [];
  const ids = new Set(groups.map((g) => g.id));
  if (ids.size !== groups.length) throw Error("分组ID重复");
  for (const group of groups) {
    const seen = new Set([group.id]);
    let parent = group.parentId;
    while (parent) {
      if (!ids.has(parent)) throw Error("父分组不存在");
      if (seen.has(parent)) throw Error("分组不能循环嵌套");
      seen.add(parent);
      parent = groups.find((g) => g.id === parent)?.parentId;
    }
  }
  for (const layer of p.layers)
    if (layer.groupId && !ids.has(layer.groupId)) throw Error("图层分组不存在");
}
