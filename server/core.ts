import { shapeMaskSchema } from "../src/masks";
import { decodeImage, convertImage, composeImages, pngSize } from "./magick";
import { suggestBackground, rgbLab, hexRGB, deltaE00 } from "./chroma";
import type { ExportJobs } from "./jobs";
import { z } from "zod";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import {
  keyframeSchema,
  retimeLayer,
  exportTiming,
  simplifyKeyframes,
  layerSchema,
  frameCount,
  poseAt,
  assetAt,
  validateProject,
  type Project,
  type Asset,
  isLayerVisible,
} from "../src/model";
import {
  makeAsset,
  keyImage,
  splitComponents,
  splitGrid,
  resizeAsset,
  crop,
} from "./images";
const id = z.string().uuid(),
  num = z.number().finite(),
  rect = z.object({
    x: num.int().min(0),
    y: num.int().min(0),
    width: num.int().positive(),
    height: num.int().positive(),
  });
export const operations = {
  set_mask: z.object({
    projectId: id,
    layerIds: z.array(id).min(1).max(100),
    mask: shapeMaskSchema.nullable(),
  }),
  process_layer: z.object({
    projectId: id,
    path: z.string().min(1),
    name: z.string().min(1),
    preparationId: id,
    parts: z
      .array(
        z.object({
          name: z.string().min(1),
          box: rect,
          target: rect.optional(),
          z: num.int().optional(),
          semantic: z.string().optional(),
        }),
      )
      .min(1)
      .max(100)
      .optional(),
    backgroundColor: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .optional(),
    mode: z.enum(["connected", "all"]).default("all"),
    innerThreshold: num.min(0).max(100).default(4),
    outerThreshold: num.positive().max(100).default(18),
    despill: num.min(0).max(1).default(1),
    smoothRadius: num.int().min(0).max(3).default(1),
    addLayer: z.literal(false).default(false),
    z: num.int().default(0),
    semantic: z.string().default("element"),
  }),
  prepare_regions: z.object({
    combine: z.boolean().default(false),
    projectId: id,
    assetId: id,
    regions: z
      .array(rect.extend({ name: z.string().min(1) }))
      .min(1)
      .max(30),
    padding: num.int().min(0).max(256).default(12),
    backgroundColor: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .optional(),
  }),
  batch_layers: z.object({
    projectId: id,
    expectedRevision: num.int().nonnegative().optional(),
    add: z
      .array(layerSchema.omit({ id: true }))
      .max(100)
      .default([]),
    update: z
      .array(
        z.object({
          layerId: id,
          patch: layerSchema.omit({ id: true }).partial(),
        }),
      )
      .max(100)
      .default([]),
    remove: z.array(id).max(100).default([]),
  }),

  list: z.object({}),
  current: z.object({ detail: z.enum(["summary", "full"]).default("summary") }),
  export_status: z.object({ jobId: id }),
  cancel_export: z.object({ jobId: id }),
  reveal_export: z.object({ jobId: id }),
  group_create: z.object({
    projectId: id,
    name: z.string().min(1),
    parentId: id.optional(),
    layerIds: z.array(id).max(500).default([]),
  }),
  group_update: z.object({
    projectId: id,
    groupId: id,
    patch: z.object({
      name: z.string().min(1).optional(),
      visible: z.boolean().optional(),
      parentId: id.nullable().optional(),
    }),
  }),
  group_assign: z.object({
    projectId: id,
    groupId: id.nullable(),
    layerIds: z.array(id).min(1).max(500),
  }),
  group_remove: z.object({ projectId: id, groupId: id }),
  scene_update: z.object({
    projectId: id,
    name: z.string().min(1).optional(),
    visible: z.boolean().optional(),
  }),
  resize_image: z.object({
    projectId: id,
    assetId: id,
    width: num.int().min(1).max(4096),
    height: num.int().min(1).max(4096),
    fit: z.enum(["fill", "contain", "cover"]).default("fill"),
  }),
  create: z.object({
    name: z.string().default("未命名动画"),
    width: num.int().min(1).max(4096),
    height: num.int().min(1).max(4096),
    fps: num.int().min(1).max(24).default(24),
    duration: num.positive().max(3).default(3),
    background: z
      .string()
      .regex(/^(#[0-9a-f]{6}|transparent)$/i)
      .default("transparent"),
  }),
  get: z.object({
    projectId: id,
    activate: z.boolean().default(false),
    detail: z.enum(["summary", "full"]).default("summary"),
  }),
  restore: z.object({ project: z.unknown() }),
  settings: z.object({
    projectId: id,
    name: z.string().optional(),
    width: num.int().positive().max(4096).optional(),
    height: num.int().positive().max(4096).optional(),
    fps: num.int().min(1).max(24).optional(),
    duration: num.positive().max(3).optional(),
    background: z
      .string()
      .regex(/^(#[0-9a-f]{6}|transparent)$/i)
      .optional(),
  }),
  reset: z.object({
    preserve: z.boolean().default(true),
  }),
  import_image: z.object({
    projectId: id,
    path: z.string().min(1),
    name: z.string(),
    reference: z.boolean().default(false),
    fit: z.enum(["none", "canvas", "contain"]).default("none"),
    width: num.int().positive().max(4096).optional(),
    height: num.int().positive().max(4096).optional(),
  }),
  key_image: z.object({
    projectId: id,
    assetId: id,
    backgroundColor: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .optional(),
    mode: z.enum(["connected", "all"]).optional(),
    metric: z.enum(["rgb", "lab"]).optional(),
    innerThreshold: num.min(0).max(255).optional(),
    outerThreshold: num.positive().max(441).optional(),
    despill: num.min(0).max(1).default(1),
    smoothRadius: num.int().min(0).max(3).default(1),
    tolerance: num.min(0).max(255).default(36),
    feather: num.min(0).max(100).default(12),
    regions: z.array(rect).max(100).optional(),
  }),
  split_atlas: z.object({
    projectId: id,
    assetId: id,
    minArea: num.int().positive().default(16),
    mergeGap: num.int().min(0).max(100).default(4),
    boxes: z.array(rect).max(500).optional(),
    addLayers: z.boolean().default(true),
    z: num.int().default(0),
  }),
  split_grid: z.object({
    projectId: id,
    assetId: id,
    columns: num.int().positive().max(72),
    rows: num.int().positive().max(72),
    count: num.int().positive().max(72),
    padding: num.int().min(0).default(0),
    gap: num.int().min(0).default(0),
  }),
  add_layer: z.object({ projectId: id, layer: layerSchema.omit({ id: true }) }),
  update_layer: z.object({
    projectId: id,
    layerId: id,
    patch: layerSchema
      .omit({
        id: true,
        keyframes: true,
        sequence: true,
        sequenceStart: true,
        sequenceEnd: true,
      })
      .partial(),
  }),
  remove_layer: z.object({ projectId: id, layerId: id }),
  keyframes: z.object({
    projectId: id,
    layerId: id,
    keyframes: z.array(keyframeSchema).max(72),
  }),
  sequence: z.object({
    projectId: id,
    layerId: id,
    assetIds: z.array(id).min(1).max(72),
    startFrame: num.int().min(0).default(0),
    endFrame: num.int().min(0).max(71).optional(),
  }),
  playback: z.object({
    projectId: id,
    frame: num.int().min(0).optional(),
    playing: z.boolean().optional(),
  }),
  snapshot: z.object({ projectId: id, frame: num.int().min(0).default(0) }),
  review: z.object({
    projectId: id,
    score: num.min(0).max(1),
    notes: z.string().min(1),
    snapshotHash: z.string().length(64),
  }),
  export: z.object({
    projectId: id,
    format: z
      .enum(["gif", "webp", "webm", "png", "png-sequence", "project"])
      .default("gif"),
    frame: num.int().min(0).default(0),
    frames: num.int().positive().optional(),
    fps: num.int().min(1).max(24).optional(),
    duration: num.positive().max(3).optional(),
    lossy: num.int().min(0).max(200).optional(),
    compressionLevel: num.int().min(0).max(6).optional(),
    manualToken: z.string().optional(),
  }),
};
export type Operation = keyof typeof operations;
export const descriptions: Record<Operation, string> = {
  set_mask:
    "创建/替换图形遮罩并绑定一个或多个图层，null移除。支持rect/roundedRect/circle/ellipse/polygon坐标点。space=canvas固定在画布，layer跟随图层变换。inverse反向裁切；自动作用于主体及扫光，预览/导出一致。",
  list: "列出本地动画项目",
  current: "读取当前预览项目，实时读取磁盘以同步其他MCP连接的修改",
  export_status: "仅供面板读取手动导出进度",
  cancel_export: "仅供面板取消手动导出任务",
  reveal_export: "在文件资源管理器中选中本次已完成的导出文件",
  group_create: "创建可嵌套的语义目录分组，并将指定图层分配到组",
  group_update: "修改分组名称、父目录或可见性，防止循环嵌套",
  group_assign: "将图层移动到分组；groupId=null移回Scene",
  group_remove: "解散分组，保留所有图层并移到上级目录",
  scene_update: "修改Scene根节点名称或可见性",
  resize_image:
    "由MCP使用ImageMagick WASM缩放图片到目标尺寸，返回新资源；不需要用户确认缩放",
  create: "创建原尺寸画布，最大 24FPS / 3 秒",
  get: "默认读取项目和图层摘要；需要资源、完整关键帧或审查记录时显式detail=full。",
  restore: "恢复项目JSON到新的项目；保留资源动画，重新进行视觉审查",
  settings: "调整画布、FPS、整帧时长；自动重定时并合并同帧关键帧；越界时拒绝",
  import_image:
    "按路径导入素材；不按相对原图尺寸/比例拒绝。fit=canvas等比对齐并保留原生资源，尺寸要求只在Skill指导",
  key_image:
    "ImageMagick解码编码；连续Alpha、原图引导双边平滑、去底色混合。显式backgroundColor默认清除封闭孔洞；mode=connected保护同色内部。先处理原生图再缩放。",
  split_atlas: "连通区域拆图，可提供语义 boxes 合并文字/按钮，返回原图坐标",
  split_grid: "按等尺寸 Grid 行优先拆分序列帧",
  add_layer: "添加图层，x/y 为未旋转左上角坐标",
  update_layer:
    "修改位置/尺寸/层级/可见性/锁定；patch.effect 配置 sweep 扫光，设 null 移除。预览用同纹理副本的alpha遮罩裁切Pixi渐变形状，导出同步",
  remove_layer: "删除图层",
  keyframes:
    "替换稀疏关键帧，支持贝塞尔曲线，检查每帧边界；只设起止和转折点，禁止常规动画逐帧打点",
  sequence: "均匀分配序列帧到图层时间段",
  playback: "播放/暂停或定位帧",
  snapshot: "用相同 Pixi 渲染器返回画布 PNG 与视觉审查 hash",
  review:
    "记录 Codex 视觉判断，至少80%，连续失败最多3轮；成功后修改可重新审查；必须匹配最新合图截图",
  export: "仅供面板人工点击后启动后台导出；AI工作流禁止调用",
  process_layer:
    "处理生成图但不加入画布：传preparationId读取MCP配色，不按尺寸比例拒绝，按底色抠图/缩放/裁边返回pendingLayer；图集传parts（生成图原生像素box、原图target、z、semantic），返回独立pendingLayers（视觉中心）。所有层处理完后一次batch_layers(add:pendingLayers)统一加入画布。",
  prepare_regions:
    "生图前提供图层内容区域坐标，MCP裁剪区域用于CIELAB/CIEDE2000配色分析，返回preparationId、背景色、原图完整画布尺寸/比例和生成建议。区域裁片仅供分析/局部参考，尺寸比例只作Skill建议，内容可用即可；combine=true联合配色，返回atlas.preparationId，供互不连接的元素同图生成；全部图层process_layer处理完后统一batch_layers加入画布。",
  batch_layers:
    "原子批量新增/修改/删除图层（含关键帧），一次校验与保存；expectedRevision防覆盖。新画面仍需snapshot/review，失败不写入。",
  reset: "重置编辑器并清空当前画板（历史项目保留在磁盘中）",
};
export const visualHash = (p: Project) => {
  const visible = p.layers
    .filter((l) => isLayerVisible(p, l) && poseAt(l, 0).opacity > 0)
    .sort((a, b) => a.z - b.z);
  const used = new Set(visible.map((l) => assetAt(l, 0, p)));
  if (p.reference) used.add(p.reference);
  return createHash("sha256")
    .update(
      JSON.stringify({
        width: p.width,
        height: p.height,
        background: p.background,
        ...(p.scene?.visible === false ? { sceneVisible: false } : {}),
        assets: p.assets.filter((a) => used.has(a.id)),
        layers: visible.map((l) => ({
          effect: l.effect,
          shapeMask: l.shapeMask,
          transformOrigin: l.transformOrigin,
          pivotX: l.pivotX,
          pivotY: l.pivotY,
          assetId: assetAt(l, 0, p),
          width: l.width,
          height: l.height,
          z: l.z,
          visible: true,
          ...poseAt(l, 0),
        })),
      }),
    )
    .digest("hex");
};
export function initializeVisualOrigin(l: any, p: Pick<Project, "assets">) {
  const asset = p.assets.find((a) => a.id === l.assetId);
  l.transformOrigin = "visual-center";
  l.pivotX = asset?.visualCenter?.x ?? 0.5;
  l.pivotY = asset?.visualCenter?.y ?? 0.5;
  return l;
}
export function autoScaleLayer(
  layer: { width: number; height: number; assetId?: string },
  p: Pick<Project, "width" | "height" | "assets">,
) {
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
      targetMaxHeight / Math.max(1, layer.height),
    );
    if (scale < 1) {
      layer.width = Math.max(1, Math.round(layer.width * scale));
      layer.height = Math.max(1, Math.round(layer.height * scale));
    }
  }
}
export class Store {
  projects = new Map<string, Project>();
  snapshots = new Map<string, string>();
  getProjectDirs(projectId: string) {
    const projectDir = path.join(this.root, "projects", projectId);
    return {
      root: projectDir,
      inputs: path.join(projectDir, "inputs"),
      outputs: path.join(projectDir, "outputs"),
      temp: path.join(projectDir, "temp"),
      assets: path.join(projectDir, "assets"),
      projectFile: path.join(projectDir, "project.json"),
    };
  }
  async reset(): Promise<void> {
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(path.join(this.root, ".active-project"));
    } catch {}
  }
  async focus(projectId: string) {
    await mkdir(this.root, { recursive: true });
    await writeFile(path.join(this.root, ".active-project"), projectId);
  }
  async active() {
    try {
      return id.parse(
        await readFile(path.join(this.root, ".active-project"), "utf8"),
      );
    } catch {
      return undefined;
    }
  }
  constructor(
    public root: string,
    public render: (
      p: Project,
      format: string,
      frame: number,
    ) => Promise<{ file: string; mimeType: string }>,
    public jobs?: Pick<ExportJobs, "start" | "status" | "cancel" | "reveal">,
  ) {}
  async get(projectId: string) {
    const dirs = this.getProjectDirs(projectId);
    let p: Project;
    try {
      p = JSON.parse(await readFile(dirs.projectFile, "utf8"));
    } catch {
      p = JSON.parse(
        await readFile(path.join(this.root, projectId + ".json"), "utf8"),
      );
    }
    // Migrate embedded legacy assets once on disk; never send them over MCP/HTTP.
    let migrated = false;
    for (const legacy of p.assets) {
      if ((legacy as any).data) {
        const { migrateEmbeddedAsset } = await import("./migration");
        const asset = await migrateEmbeddedAsset(legacy as any, dirs.assets);
        Object.assign(legacy, asset);
        delete (legacy as any).data;
        migrated = true;
      }
    }
    if (migrated) {
      p.reviews = [];
      p.stage = p.stage === "failed" ? "failed" : "compose";
      p.revision++;
      await this.save(p);
    }
    p.backgroundExplicit ??= p.background !== "transparent";
    p.groups ??= [];
    p.scene ??= { id: "scene", name: "Scene", visible: true };
    this.projects.set(projectId, p);
    return structuredClone(p);
  }
  async save(p: Project) {
    await mkdir(this.root, { recursive: true });
    await mkdir(path.join(this.root, "assets"), { recursive: true });
    await mkdir(path.join(this.root, "exports"), { recursive: true });
    const dirs = this.getProjectDirs(p.id);
    await mkdir(dirs.root, { recursive: true });
    await mkdir(dirs.inputs, { recursive: true });
    await mkdir(dirs.outputs, { recursive: true });
    await mkdir(dirs.temp, { recursive: true });
    await mkdir(dirs.assets, { recursive: true });

    const tempProj = dirs.projectFile + "." + randomUUID() + ".tmp";
    await writeFile(tempProj, JSON.stringify(p, null, 2));
    await rename(tempProj, dirs.projectFile);

    const dest = path.join(this.root, p.id + ".json");
    const temporary = dest + "." + randomUUID() + ".tmp";
    await writeFile(temporary, JSON.stringify(p));
    await rename(temporary, dest);

    this.projects.set(p.id, p);
  }
  async execute(op: Operation, input: unknown): Promise<any> {
    const a: any = operations[op].parse(input);
    if (op === "reset") {
      await this.reset();
      return { project: null };
    }
    if (op === "current") {
      const active = await this.active();
      return { project: active ? await this.get(active) : null };
    }
    if (op === "export_status") {
      if (!this.jobs) throw Error("导出服务未启动");
      return { job: this.jobs.status(a.jobId) };
    }
    if (op === "reveal_export") {
      if (!this.jobs) throw Error("导出服务未启动");
      return await this.jobs.reveal(a.jobId);
    }
    if (op === "cancel_export") {
      if (!this.jobs) throw Error("导出服务未启动");
      return { job: await this.jobs.cancel(a.jobId) };
    }
    if (op === "restore") {
      const parsed = z
        .object({
          name: z.string().min(1),
          width: num.int(),
          height: num.int(),
          fps: num.int(),
          duration: num,
          background: z.string().regex(/^(#[0-9a-f]{6}|transparent)$/i),
          layers: z.array(layerSchema).max(500),
          groups: z
            .array(
              z.object({
                id,
                name: z.string(),
                parentId: id.optional(),
                visible: z.boolean(),
              }),
            )
            .default([]),
          scene: z
            .object({
              id: z.literal("scene"),
              name: z.string(),
              visible: z.boolean(),
            })
            .optional(),
          assets: z
            .array(
              z.object({
                id,
                name: z.string(),
                path: z.string().min(1),
                width: num.int().positive(),
                height: num.int().positive(),
                sourceBounds: rect.optional(),
                visualCenter: z
                  .object({ x: num.min(0).max(1), y: num.min(0).max(1) })
                  .optional(),
              }),
            )
            .max(500),
          reference: id.optional(),
        })
        .parse(a.project);
      for (const l of parsed.layers) id.parse(l.id);
      if (new Set(parsed.assets.map((a) => a.id)).size !== parsed.assets.length)
        throw Error("资源ID重复");
      if (
        parsed.reference &&
        !parsed.assets.some((a) => a.id === parsed.reference)
      )
        throw Error("参考图不存在");
      let total = 0;
      for (const asset of parsed.assets) {
        total += (await (await import("node:fs/promises")).stat(asset.path))
          .size;
        if (total > 256 * 1024 * 1024) throw Error("项目资源超过256MB");
        const checked = await makeAsset(
          asset.path,
          asset.name,
          path.join(this.root, "assets"),
        );
        if (checked.width !== asset.width || checked.height !== asset.height)
          throw Error("资源尺寸与实际图片不符");
        asset.path = checked.path;
      }
      const p: Project = {
        ...parsed,
        id: randomUUID(),
        revision: 0,
        reviews: [],
        stage: "compose",
        backgroundExplicit: true,
        frame: 0,
        playing: false,
      };
      validateProject(p);
      await this.save(p);
      await this.focus(p.id);
      return { project: p };
    }
    if (op === "list") {
      const { readdir } = await import("node:fs/promises");
      await mkdir(this.root, { recursive: true });
      const summarize = async (p: Project) => {
        const modified = await stat(
          this.getProjectDirs(p.id).projectFile,
        ).catch(() => stat(path.join(this.root, p.id + ".json")));
        return {
          id: p.id,
          name: p.name,
          width: p.width,
          height: p.height,
          fps: p.fps,
          duration: p.duration,
          layerCount: p.layers.length,
          updatedAt: modified.mtime.toISOString(),
        };
      };
      const projects = [];
      const seenIds = new Set<string>();

      // Read from projects/ subdirectory
      const projectsDir = path.join(this.root, "projects");
      try {
        const subdirs = await readdir(projectsDir);
        for (const sub of subdirs) {
          if (/^[0-9a-f-]{36}$/.test(sub)) {
            try {
              const p = await this.get(sub);
              projects.push(await summarize(p));
              seenIds.add(p.id);
            } catch {}
          }
        }
      } catch {}

      // Read legacy root JSON files
      const files = await readdir(this.root);
      for (const f of files.filter((f) => /^[0-9a-f-]{36}\.json$/.test(f))) {
        const id = f.slice(0, -5);
        if (!seenIds.has(id)) {
          try {
            const p = await this.get(id);
            projects.push(await summarize(p));
            seenIds.add(p.id);
          } catch {}
        }
      }
      projects.sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
      );
      return { projects, activeProjectId: await this.active() };
    }
    if (op === "create") {
      const p: Project = {
        ...a,
        id: randomUUID(),
        revision: 0,
        layers: [],
        groups: [],
        scene: { id: "scene", name: "Scene", visible: true },
        backgroundExplicit:
          !!input &&
          typeof input === "object" &&
          Object.hasOwn(input, "background"),
        assets: [],
        reviews: [],
        stage: "split",
        frame: 0,
        playing: false,
      };
      validateProject(p);
      await this.save(p);
      await this.focus(p.id);
      return { project: p };
    }
    const p = structuredClone(await this.get(a.projectId));
    if (op === "get") {
      if (a.activate) {
        await this.focus(p.id);
        // Local user choice to reopen a saved project; separate from review scores.
        await mkdir(this.getProjectDirs(p.id).root, { recursive: true });
        await writeFile(
          path.join(this.getProjectDirs(p.id).root, ".history-opened"),
          new Date().toISOString(),
        );
      }
      return { project: p };
    }
    const historyOpened = await readFile(
      path.join(this.getProjectDirs(p.id).root, ".history-opened"),
      "utf8",
    )
      .then(() => true)
      .catch(() => false);
    if (
      !historyOpened &&
      p.stage === "failed" &&
      !["snapshot", "export", "playback"].includes(op)
    )
      throw Error("任务失败：3轮审查已用尽，请创建新项目");
    const layer = () => {
      const l = p.layers.find((l) => l.id === a.layerId);
      if (!l) throw Error("图层不存在");
      return l;
    };
    const asset = () => {
      const s = p.assets.find((s) => s.id === a.assetId);
      if (!s) throw Error("资源不存在");
      return s;
    };
    const approved = p.reviews.some(
      (r) => r.score >= 0.8 && r.snapshotHash === visualHash(p),
    );
    const animationGate = () => {
      if (historyOpened) return;
      if (p.stage === "failed") throw Error("3轮审查未通过，任务失败");
      if (!approved) throw Error("合图需先通过 ≥80% 的视觉审查");
    };
    let extra: Record<string, unknown> = {};
    if (op === "snapshot") {
      if (a.frame >= frameCount(p)) throw Error("帧超出时长");
      const result = await this.render(p, "png", a.frame);
      const hash = visualHash(p);
      if (a.frame === 0) this.snapshots.set(p.id, hash);
      return {
        ...result,
        projectId: p.id,
        snapshotHash: hash,
        frame: a.frame,
        layers: p.layers,
      };
    }
    if (op === "review") {
      if (
        p.stage === "failed" ||
        (p.reviews.length >= 3 &&
          p.reviews.slice(-3).every((r) => r.score < 0.8))
      )
        throw Error("已达到最多3轮审查");
      const hash = visualHash(p);
      if (
        this.snapshots.get(p.id) !== a.snapshotHash ||
        hash !== a.snapshotHash
      )
        throw Error("截图已过期，请先获取当前第0帧 snapshot");
      p.reviews.push({
        round: p.reviews.length + 1,
        score: a.score,
        notes: a.notes,
        snapshotHash: hash,
        revision: p.revision,
        at: new Date().toISOString(),
      });
      p.stage =
        a.score >= 0.8
          ? "animate"
          : p.reviews.length >= 3
            ? "failed"
            : "compose";
      this.snapshots.delete(p.id);
    }
    if (op === "export") {
      exportTiming(p, { fps: a.fps, duration: a.duration }, a.frames);
      if (a.frame >= frameCount(p)) throw Error("帧超出时长");
      if (a.format !== "project") animationGate();
      if (!this.jobs) throw Error("导出只能由用户在面板中手动启动");
      const dirs = this.getProjectDirs(p.id);
      await mkdir(dirs.outputs, { recursive: true });
      await mkdir(dirs.temp, { recursive: true });
      return {
        job: this.jobs.start(
          p,
          a.format,
          a.frame,
          a.frames,
          dirs.outputs,
          dirs.temp,
          {
            fps: a.fps,
            duration: a.duration,
            lossy: a.lossy,
            compressionLevel: a.compressionLevel,
          },
        ),
        projectId: p.id,
      };
    }
    if (op === "settings") {
      const oldFrames = frameCount(p);
      const { projectId, ...patch } = a;
      Object.assign(p, patch);
      if (Object.hasOwn(patch, "background")) p.backgroundExplicit = true;
      p.frame = Math.min(p.frame, frameCount(p) - 1);
      const newFrames = frameCount(p);
      if (oldFrames !== newFrames) {
        for (const l of p.layers) retimeLayer(l, oldFrames, newFrames);
      }
    }
    if (op === "import_image") {
      const dirs = this.getProjectDirs(p.id);
      await mkdir(dirs.inputs, { recursive: true });
      let s = await makeAsset(a.path, a.name, dirs.inputs);
      const nativeAsset = s;

      if (!a.reference && (a.fit !== "none" || a.width || a.height))
        s = await resizeAsset(
          s,
          a.width ?? p.width,
          a.height ?? p.height,
          dirs.assets,
          "contain",
        );
      if (nativeAsset.id !== s.id) {
        p.assets.push(nativeAsset);
        extra.nativeAsset = nativeAsset;
      }
      p.assets.push(s);
      if (a.reference) {
        p.reference = s.id;
        if (s.transparent && !p.backgroundExplicit)
          p.background = "transparent";
      }
      extra.asset = s;
    }
    if (op === "process_layer") {
      const dirs = this.getProjectDirs(p.id);
      let plan: any;
      try {
        plan = JSON.parse(
          await readFile(
            path.join(dirs.temp, a.preparationId + "-preparation.json"),
            "utf8",
          ),
        );
      } catch {
        throw Error(
          "配色预处理记录不存在，请先调用prepare_regions并传入返回的preparationId",
        );
      }
      if (plan.projectId !== p.id) throw Error("预处理记录与当前项目不匹配");
      const backgroundColor = plan.background.color;
      if (
        a.backgroundColor &&
        a.backgroundColor.toUpperCase() !== backgroundColor.toUpperCase()
      )
        throw Error(
          "背景色必须使用MCP预处理返回的颜色；需换色时重新prepare_regions",
        );
      const native = await makeAsset(a.path, a.name, dirs.inputs);
      if (native.transparent)
        throw Error("分层生图应使用MCP返回的纯色不透明背景，由MCP抠图");
      extra.geometryAdjusted =
        native.width !== plan.generationCanvas.width ||
        native.height !== plan.generationCanvas.height;
      const raw = await decodeImage(native.path),
        bgLab = rgbLab(hexRGB(backgroundColor));
      let samples = 0,
        matches = 0;
      for (
        let y = 0;
        y < native.height;
        y += Math.max(1, Math.floor(native.height / 64))
      )
        for (const x of [0, native.width - 1]) {
          const i = (y * native.width + x) * 4;
          samples++;
          if (
            deltaE00(
              rgbLab([raw.data[i], raw.data[i + 1], raw.data[i + 2]]),
              bgLab,
            ) < 12
          )
            matches++;
        }
      for (
        let x = 0;
        x < native.width;
        x += Math.max(1, Math.floor(native.width / 64))
      )
        for (const y of [0, native.height - 1]) {
          const i = (y * native.width + x) * 4;
          samples++;
          if (
            deltaE00(
              rgbLab([raw.data[i], raw.data[i + 1], raw.data[i + 2]]),
              bgLab,
            ) < 12
          )
            matches++;
        }
      if (matches / samples < 0.3)
        throw Error(
          "生成图边缘与MCP建议背景色不符，请使用返回的纯色填充完整背景",
        );
      const keyed = await keyImage(native, 36, 12, undefined, dirs.assets, {
        backgroundColor,
        mode: a.mode,
        innerThreshold: a.innerThreshold,
        outerThreshold: a.outerThreshold,
        despill: a.despill,
        smoothRadius: a.smoothRadius,
      });
      p.assets.push(native, keyed);
      const pendingLayers: any[] = [],
        assets: Asset[] = [];
      const parts = a.parts ?? [
        {
          name: a.name,
          box: { x: 0, y: 0, width: native.width, height: native.height },
          target: { x: 0, y: 0, width: p.width, height: p.height },
          z: a.z,
          semantic: a.semantic,
        },
      ];
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const x = parts[i].box,
            y = parts[j].box;
          if (
            x.x < y.x + y.width &&
            y.x < x.x + x.width &&
            x.y < y.y + y.height &&
            y.y < x.y + x.height
          )
            throw Error("图集语义框重叠，请按独立元素分别标注box");
        }
      for (const part of parts) {
        const region = plan.regions?.find((v: any) => v.name === part.name),
          rb = region?.sourceBounds;
        const target =
          part.target ??
          (rb
            ? {
                x: Math.round((rb.x * p.width) / plan.generationCanvas.width),
                y: Math.round((rb.y * p.height) / plan.generationCanvas.height),
                width: Math.max(
                  1,
                  Math.round(
                    (rb.width * p.width) / plan.generationCanvas.width,
                  ),
                ),
                height: Math.max(
                  1,
                  Math.round(
                    (rb.height * p.height) / plan.generationCanvas.height,
                  ),
                ),
              }
            : undefined);
        if (!target)
          throw Error(
            "图集每个part需要target原图位置，或与prepare_regions相同的name",
          );
        if (
          target.x + target.width > p.width ||
          target.y + target.height > p.height
        )
          throw Error("目标区域超出画布");
        const cut = await crop(
          keyed,
          part.box,
          part.name + " · 图集切片",
          dirs.assets,
        );
        const display = await resizeAsset(
          cut,
          target.width,
          target.height,
          dirs.assets,
          "contain",
        );
        const { data, info } = await decodeImage(display.path);
        let x0 = info.width,
          y0 = info.height,
          x1 = -1,
          y1 = -1;
        for (let y = 0; y < info.height; y++)
          for (let x = 0; x < info.width; x++)
            if (data[(y * info.width + x) * 4 + 3] > 2) {
              x0 = Math.min(x0, x);
              y0 = Math.min(y0, y);
              x1 = Math.max(x1, x);
              y1 = Math.max(y1, y);
            }
        if (x1 < 0)
          throw Error(
            "图层 " + part.name + " 抠图后为空，请检查语义框或背景色",
          );
        const clipped = await crop(
          display,
          { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 },
          part.name,
          dirs.assets,
        );
        clipped.sourceBounds = {
          x: target.x + x0,
          y: target.y + y0,
          width: clipped.width,
          height: clipped.height,
        };
        p.assets.push(cut, display, clipped);
        assets.push(clipped);
        const pending = initializeVisualOrigin(
          layerSchema.parse({
            id: randomUUID(),
            name: part.name,
            assetId: clipped.id,
            ...clipped.sourceBounds,
            z: part.z ?? a.z,
            semantic: part.semantic ?? a.semantic,
          }),
          p,
        );
        const { id: unused, ...pendingLayer } = pending;
        pendingLayers.push(pendingLayer);
      }
      extra.nativeAsset = native;
      extra.assets = assets;
      extra.pendingLayers = pendingLayers;
      if (pendingLayers.length === 1) {
        extra.asset = assets[0];
        extra.pendingLayer = pendingLayers[0];
        extra.placement = assets[0].sourceBounds;
      }
      extra.preparationId = a.preparationId;
      extra.backgroundColor = backgroundColor;
    }
    if (op === "prepare_regions") {
      const source = asset(),
        dirs = this.getProjectDirs(p.id),
        items = [];
      for (const region of a.regions) {
        if (region.x >= source.width || region.y >= source.height)
          throw Error("区域起点超出图片");
        const x = Math.max(0, region.x - a.padding),
          y = Math.max(0, region.y - a.padding);
        const bounds = {
          x,
          y,
          width:
            Math.min(source.width, region.x + region.width + a.padding) - x,
          height:
            Math.min(source.height, region.y + region.height + a.padding) - y,
        };
        const reference = await crop(
          source,
          bounds,
          region.name + " · 生成参考",
          dirs.temp,
        );
        const background = await suggestBackground(
          reference.path,
          a.backgroundColor,
        );
        const generationCanvas = { width: source.width, height: source.height };
        const scale = Math.max(
          1,
          Math.ceil(1024 / Math.max(source.width, source.height)),
          Math.ceil(Math.sqrt(655360 / (source.width * source.height))),
        );
        const preparationId = randomUUID();
        const plan = {
          projectId: p.id,
          preparationId,
          name: region.name,
          requestedBounds: region,
          sourceBounds: bounds,
          reference,
          fullReference: {
            path: source.path,
            width: source.width,
            height: source.height,
          },
          background,
          generationCanvas,
          suggestedNativeSize: {
            width: source.width * scale,
            height: source.height * scale,
          },
          generation: {
            canvas: "full-reference",
            transparentBackground: false,
            backgroundColor: background.color,
            contentRegion: region,
            preserveOriginalPosition: true,
            aspectRatio: source.width / source.height,
          },
          nextStep:
            "generate full-canvas solid-background layers; process each with process_layer(preparationId), collect pendingLayer, then batch_layers(add:allPendingLayers) only after ALL layers are ready",
        };
        await writeFile(
          path.join(dirs.temp, preparationId + "-preparation.json"),
          JSON.stringify(plan),
        );
        items.push(plan);
      }
      let atlas: any;
      if (a.combine) {
        const overlays = [];
        let top = 0,
          maxWidth = 0;
        for (const item of items) {
          const input = await convertImage(item.reference.path, [
            "-resize",
            "128x128>",
          ]);
          const size = pngSize(input);
          overlays.push({ input, left: 0, top });
          top += size.height;
          maxWidth = Math.max(maxWidth, size.width);
        }
        const bytes = await composeImages(
          maxWidth,
          top,
          "transparent",
          overlays,
        );
        const analysis = await makeAsset(bytes, "图集联合配色参考", dirs.temp);
        const background = await suggestBackground(
            analysis.path,
            a.backgroundColor,
          ),
          preparationId = randomUUID();
        atlas = {
          projectId: p.id,
          preparationId,
          name: "非连接元素图集",
          regions: items.map(({ name, sourceBounds }) => ({
            name,
            sourceBounds,
          })),
          background,
          generationCanvas: { width: source.width, height: source.height },
          suggestedNativeSize: items[0].suggestedNativeSize,
          fullReference: items[0].fullReference,
          generation: {
            transparentBackground: false,
            backgroundColor: background.color,
          },
          nextStep:
            "generate disjoint separated elements in ONE image; inspect native pixel boxes then process_layer(preparationId,parts:[{name,box,target,z,semantic}]); collect pendingLayers then batch import",
        };
        await writeFile(
          path.join(dirs.temp, preparationId + "-preparation.json"),
          JSON.stringify(atlas),
        );
      }
      return {
        projectId: p.id,
        revision: p.revision,
        coordinateSpace: {
          assetId: source.id,
          width: source.width,
          height: source.height,
        },
        regions: items,
        ...(atlas ? { atlas } : {}),
      };
    }
    if (op === "batch_layers") {
      if (a.expectedRevision !== undefined && a.expectedRevision !== p.revision)
        throw Error("项目已更新，请读取最新revision后重试");
      for (const layerId of a.remove) {
        const l = p.layers.find((l) => l.id === layerId);
        if (!l) throw Error("图层不存在");
        if (l.locked) throw Error("请先解锁图层");
      }
      p.layers = p.layers.filter((l) => !a.remove.includes(l.id));
      const created = [];
      for (const input of a.add) {
        const l = layerSchema.parse({ ...input, id: randomUUID() });
        autoScaleLayer(l, p);
        initializeVisualOrigin(l, p);
        p.layers.push(l);
        created.push(l.id);
      }
      for (const { layerId, patch } of a.update) {
        const l = p.layers.find((l) => l.id === layerId);
        if (!l) throw Error("图层不存在");
        if (l.locked && Object.keys(patch).some((k) => k !== "locked"))
          throw Error("请先解锁图层");
        Object.assign(l, patch);
        if (patch.assetId) initializeVisualOrigin(l, p);
        autoScaleLayer(l, p);
      }
      for (const l of p.layers)
        l.keyframes = simplifyKeyframes(l, frameCount(p));
      if (created.length) {
        p.frame = 0;
        p.playing = false;
      }
      extra.createdLayerIds = created;
      extra.updatedLayerIds = a.update.map((v: any) => v.layerId);
      extra.removedLayerIds = a.remove;
    }
    if (op === "resize_image") {
      const s = await resizeAsset(
        asset(),
        a.width,
        a.height,
        this.getProjectDirs(p.id).assets,
        a.fit,
      );
      p.assets.push(s);
      extra.asset = s;
    }
    if (op === "group_create") {
      const group = {
        id: randomUUID(),
        name: a.name,
        parentId: a.parentId,
        visible: true,
      };
      p.groups ??= [];
      if (p.groups.length >= 500) throw Error("项目最多500个分组");
      p.groups.push(group);
      for (const id of a.layerIds) {
        const l = p.layers.find((l) => l.id === id);
        if (!l) throw Error("图层不存在");
        l.groupId = group.id;
      }
      extra.group = group;
    }
    if (op === "group_update" || op === "group_remove") {
      const group = p.groups?.find((g) => g.id === a.groupId);
      if (!group) throw Error("分组不存在");
      if (op === "group_update") {
        const patch = { ...a.patch };
        if (patch.parentId === null) patch.parentId = undefined;
        Object.assign(group, patch);
      } else {
        for (const l of p.layers)
          if (l.groupId === group.id) l.groupId = group.parentId;
        for (const g of p.groups ?? [])
          if (g.parentId === group.id) g.parentId = group.parentId;
        p.groups = p.groups!.filter((g) => g.id !== group.id);
      }
    }
    if (op === "group_assign") {
      if (a.groupId && !p.groups?.some((g) => g.id === a.groupId))
        throw Error("分组不存在");
      for (const id of a.layerIds) {
        const l = p.layers.find((l) => l.id === id);
        if (!l) throw Error("图层不存在");
        l.groupId = a.groupId ?? undefined;
      }
    }
    if (op === "scene_update") {
      p.scene ??= { id: "scene", name: "Scene", visible: true };
      if (a.name !== undefined) p.scene.name = a.name;
      if (a.visible !== undefined) p.scene.visible = a.visible;
    }
    if (op === "key_image") {
      const dirs = this.getProjectDirs(p.id);
      await mkdir(dirs.assets, { recursive: true });
      const s = await keyImage(
        asset(),
        a.tolerance,
        a.feather,
        a.regions,
        dirs.assets,
        {
          backgroundColor: a.backgroundColor,
          mode: a.mode,
          metric: a.metric,
          innerThreshold: a.innerThreshold,
          outerThreshold: a.outerThreshold,
          despill: a.despill,
          smoothRadius: a.smoothRadius,
        },
      );
      p.assets.push(s);
      extra.asset = s;
    }
    if (op === "split_atlas" || op === "split_grid") {
      const dirs = this.getProjectDirs(p.id);
      await mkdir(dirs.assets, { recursive: true });
      const items: Asset[] =
        op === "split_grid"
          ? await splitGrid(
              asset(),
              a.columns,
              a.rows,
              a.count,
              a.padding,
              a.gap,
              dirs.assets,
            )
          : await splitComponents(
              asset(),
              a.minArea,
              a.mergeGap,
              a.boxes,
              dirs.assets,
            );
      p.assets.push(...items);
      extra.assets = items;
      if (op === "split_atlas" && a.addLayers)
        for (const [index, s] of items.entries()) {
          const b = s.sourceBounds!;
          const l = layerSchema.parse({
            id: randomUUID(),
            name: s.name,
            assetId: s.id,
            x: b.x,
            y: b.y,
            width: s.width,
            height: s.height,
            z: a.z + index,
          });
          autoScaleLayer(l, p);
          initializeVisualOrigin(l, p);
          p.layers.push(l);
        }
      p.stage = "compose";
    }
    if (op === "add_layer") {
      const l = { ...a.layer, id: randomUUID() };
      autoScaleLayer(l, p);
      initializeVisualOrigin(l, p);
      p.layers.push(l);
    }
    if (op === "update_layer") {
      const l = layer();
      if (l.locked && Object.keys(a.patch).some((k) => k !== "locked"))
        throw Error("请先解锁图层");
      Object.assign(l, a.patch);
      if (a.patch.assetId) initializeVisualOrigin(l, p);
      autoScaleLayer(l, p);
    }
    if (op === "remove_layer") {
      if (layer().locked) throw Error("请先解锁图层");
      p.layers = p.layers.filter((l) => l.id !== a.layerId);
    }
    if (op === "set_mask") {
      for (const target of a.layerIds) {
        const l = p.layers.find((l) => l.id === target);
        if (!l) throw Error("遮罩目标图层不存在");
        if (l.locked) throw Error("请先解锁图层");
        l.shapeMask = a.mask ? structuredClone(a.mask) : null;
      }
      extra.layerIds = a.layerIds;
    }
    if (op === "keyframes") {
      animationGate();
      if (layer().locked) throw Error("请先解锁图层");
      layer().keyframes = simplifyKeyframes(
        { ...layer(), keyframes: a.keyframes },
        frameCount(p),
      );
      p.stage = "animate";
    }
    if (op === "sequence") {
      animationGate();
      const l = layer();
      if (l.locked) throw Error("请先解锁图层");
      l.sequence = a.assetIds;
      l.sequenceStart = a.startFrame;
      l.sequenceEnd = a.endFrame ?? frameCount(p) - 1;
      p.stage = "animate";
    }
    if (op === "playback") {
      if (a.frame !== undefined) {
        if (a.frame >= frameCount(p)) throw Error("帧超出时长");
        p.frame = a.frame;
      }
      if (a.playing !== undefined) p.playing = a.playing;
    }
    validateProject(p);
    if (
      [
        "settings",
        "set_mask",
        "batch_layers",
        "process_layer",
        "keyframes",
        "sequence",
        "add_layer",
        "update_layer",
        "remove_layer",
        "group_create",
        "group_update",
        "group_assign",
        "group_remove",
        "scene_update",
      ].includes(op) &&
      p.stage !== "failed" &&
      !p.reviews.some((r) => r.score >= 0.8 && r.snapshotHash === visualHash(p))
    )
      p.stage = "compose";
    p.revision++;
    await this.save(p);
    if (op !== "playback") await this.focus(p.id);
    return { project: p, ...extra };
  }
}
