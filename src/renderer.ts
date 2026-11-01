import { drawMask } from "./masks";
import { sweepGeometry } from "./effects";
import "pixi.js/unsafe-eval";
import {
  Application,
  Container,
  Graphics,
  Sprite,
  Texture,
  FillGradient,
} from "pixi.js";
import { readImageFile } from "./files";
import {
  assetAt,
  transformGeometry,
  poseAt,
  frameCount,
  isLayerVisible,
  type Project,
  type Asset,
} from "./model";
export class SceneRenderer {
  app = new Application();
  root = new Container();
  private background = new Graphics();
  private sweeps = new Map<
    string,
    {
      root: Container;
      mask: Sprite;
      light: Graphics;
      gradient: FillGradient;
      signature: string;
    }
  >();
  private shapeMasks = new Map<
    string,
    { graphics: Graphics; signature: string }
  >();
  private sprites = new Map<string, Sprite>();
  private textures = new Map<string, Texture>();
  private pending = new Map<string, Promise<Texture>>();
  private controllers = new Set<AbortController>();
  private disposed = false;
  private initialized = false;
  private generation = 0;
  private frame = 0;
  private lastFrame = -1;
  project?: Project;
  constructor(private onError: (message: string) => void = () => {}) {}
  async init(host: HTMLElement, width: number, height: number) {
    await this.app.init({
      width,
      height,
      backgroundAlpha: 0,
      antialias: true,
      preserveDrawingBuffer: true,
      preference: "webgl",
      resolution: 1,
      autoStart: false,
      sharedTicker: false,
    });
    this.initialized = true;
    host.appendChild(this.app.canvas);
    this.root.label = "Scene";
    this.root.sortableChildren = true;
    this.background.zIndex = -1e9;
    this.root.addChild(this.background);
    this.app.stage.addChild(this.root);
  }
  private texture(asset: Asset): Promise<Texture> {
    const cached = this.textures.get(asset.path);
    if (cached) return Promise.resolve(cached);
    const pending = this.pending.get(asset.path);
    if (pending) return pending;
    const task = (async () => {
      let last: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();
        this.controllers.add(controller);
        const timeout = setTimeout(() => controller.abort(), 60000);
        let objectUrl: string | undefined;
        try {
          objectUrl = URL.createObjectURL(
            await readImageFile(asset.path, controller.signal),
          );
          const image = await new Promise<HTMLImageElement>(
            (resolve, reject) => {
              const img = new Image();
              img.onload = () => resolve(img);
              img.onerror = () => reject(Error("图片解码失败"));
              img.src = objectUrl!;
            },
          );
          if (this.disposed) throw Error("画布已关闭");
          const texture = Texture.from(image);
          this.textures.set(asset.path, texture);
          this.draw(this.frame, true);
          return texture;
        } catch (error) {
          last = error;
          if (this.disposed) throw error;
        } finally {
          clearTimeout(timeout);
          this.controllers.delete(controller);
          if (objectUrl) URL.revokeObjectURL(objectUrl);
        }
      }
      throw Error(
        `无法加载图层图片「${asset.name}」：${last instanceof Error ? last.message : String(last)} (${asset.path})`,
      );
    })().finally(() => this.pending.delete(asset.path));
    this.pending.set(asset.path, task);
    return task;
  }
  async load(p: Project) {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.project = p;
    this.root.label = p.scene?.name ?? "Scene";
    this.root.visible = p.scene?.visible !== false;
    this.frame = p.frame;
    this.lastFrame = -1;
    if (
      this.app.renderer.width !== p.width ||
      this.app.renderer.height !== p.height
    )
      this.app.renderer.resize(p.width, p.height);
    this.background.clear();
    if (p.background !== "transparent")
      this.background.rect(0, 0, p.width, p.height).fill(p.background);
    const ids = new Set(p.layers.map((l) => l.id));
    for (const [id, sweep] of this.sweeps)
      if (!ids.has(id) || !p.layers.find((l) => l.id === id)?.effect) {
        sweep.light.setMask({ mask: null });
        sweep.root.destroy({ children: true });
        sweep.gradient.destroy();
        this.sweeps.delete(id);
      }
    for (const [id, s] of this.sprites)
      if (!ids.has(id)) {
        s.destroy();
        this.sprites.delete(id);
      }
    for (const [id, entry] of this.shapeMasks)
      if (!ids.has(id) || !p.layers.find((l) => l.id === id)?.shapeMask) {
        const sprite = this.sprites.get(id);
        if (sprite) sprite.mask = null;
        const sweep = this.sweeps.get(id);
        if (sweep) sweep.root.mask = null;
        entry.graphics.destroy();
        this.shapeMasks.delete(id);
      }
    const active = new Set(
      p.layers
        .filter((l) => isLayerVisible(p, l))
        .map((l) => assetAt(l, p.frame, p)),
    );
    const results = await Promise.allSettled(
      p.assets.filter((a) => active.has(a.id)).map((a) => this.texture(a)),
    );
    if (this.disposed || generation !== this.generation) return;
    this.draw(this.frame, true);
    const errors = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    if (errors.length)
      this.onError(errors.map((r) => String(r.reason)).join("\n"));
    return errors.length === 0;
  }
  draw(frame: number, force = false) {
    const p = this.project;
    if (
      this.disposed ||
      !this.initialized ||
      !p ||
      (!force && this.lastFrame === frame)
    )
      return;
    this.frame = frame;
    this.lastFrame = frame;
    for (const sweep of this.sweeps.values()) sweep.root.visible = false;
    for (const [order, layer] of [...p.layers]
      .sort((a, b) => a.z - b.z)
      .entries()) {
      let sprite = this.sprites.get(layer.id);
      if (!sprite) {
        sprite = new Sprite(Texture.EMPTY);
        sprite.anchor.set(0.5);
        this.sprites.set(layer.id, sprite);
        this.root.addChild(sprite);
      }
      sprite.zIndex = order * 2;
      sprite.visible = isLayerVisible(p, layer);
      if (!sprite.visible) continue;
      const asset = p.assets.find((a) => a.id === assetAt(layer, frame, p));
      const texture = asset && this.textures.get(asset.path);
      if (!texture) {
        sprite.visible = false;
        if (asset && !this.pending.has(asset.path))
          void this.texture(asset).catch((e) => {
            if (!this.disposed) this.onError(String(e));
          });
        continue;
      }
      if (sprite.texture !== texture) sprite.texture = texture;
      const pose = poseAt(layer, frame);
      let targetW = layer.width * pose.scaleX;
      let targetH = layer.height * pose.scaleY;
      if (asset) {
        const maxW =
          layer.transformOrigin === "visual-center"
            ? p.width
            : Math.min(p.width, asset.width);
        const maxH =
          layer.transformOrigin === "visual-center"
            ? p.height
            : Math.min(p.height, asset.height);
        if (targetW > maxW || targetH > maxH) {
          const scale = Math.min(
            maxW / Math.max(1, targetW),
            maxH / Math.max(1, targetH),
          );
          if (scale < 1) {
            targetW = Math.max(1, Math.round(targetW * scale));
            targetH = Math.max(1, Math.round(targetH * scale));
          }
        }
      }
      sprite.width = targetW;
      sprite.height = targetH;
      const transform = transformGeometry(layer, pose, targetW, targetH);
      sprite.anchor.set(transform.pivotX, transform.pivotY);
      sprite.position.set(transform.anchorX, transform.anchorY);
      sprite.rotation = (pose.rotation * Math.PI) / 180;
      sprite.alpha = pose.opacity;
      const geometry = sweepGeometry(layer, frame, p);
      if (layer.effect && geometry) {
        const effect = layer.effect;
        const signature = JSON.stringify([
          layer.width,
          layer.height,
          effect.color,
          effect.width,
        ]);
        let sweep = this.sweeps.get(layer.id);
        if (sweep && sweep.signature !== signature) {
          sweep.light.setMask({ mask: null });
          sweep.root.destroy({ children: true });
          sweep.gradient.destroy();
          this.sweeps.delete(layer.id);
          sweep = undefined;
        }
        if (!sweep) {
          const root = new Container(),
            mask = new Sprite(texture),
            light = new Graphics();
          mask.anchor.set(0.5);
          mask.width = layer.width;
          mask.height = layer.height;
          const gradient = new FillGradient({
            type: "linear",
            start: { x: 0, y: 0 },
            end: { x: 1, y: 0 },
            colorStops: [
              { offset: 0, color: effect.color + "00" },
              { offset: 0.5, color: effect.color + "ff" },
              { offset: 1, color: effect.color + "00" },
            ],
          });
          const length = Math.hypot(layer.width, layer.height) * 2;
          light
            .rect(-geometry.band / 2, -length / 2, geometry.band, length)
            .fill(gradient);
          root.addChild(light, mask);
          light.setMask({ mask, channel: "alpha" });
          this.root.addChild(root);
          sweep = { root, mask, light, gradient, signature };
          this.sweeps.set(layer.id, sweep);
        }
        sweep.mask.texture = texture;
        sweep.mask.width = layer.width;
        sweep.mask.height = layer.height;
        sweep.root.visible = true;
        sweep.root.zIndex = order * 2 + 1;
        sweep.root.position.set(transform.centerX, transform.centerY);
        sweep.root.rotation = sprite.rotation;
        sweep.root.scale.set(targetW / layer.width, targetH / layer.height);
        sweep.root.alpha = pose.opacity * effect.opacity;
        sweep.light.rotation = geometry.angle;
        sweep.light.position.set(
          geometry.nx * geometry.offset,
          geometry.ny * geometry.offset,
        );
      }
      if (layer.shapeMask) {
        const signature = JSON.stringify(layer.shapeMask);
        let entry = this.shapeMasks.get(layer.id);
        if (!entry) {
          entry = { graphics: new Graphics(), signature: "" };
          this.shapeMasks.set(layer.id, entry);
          this.root.addChild(entry.graphics);
        }
        if (entry.signature !== signature) {
          drawMask(entry.graphics, layer.shapeMask);
          entry.signature = signature;
        }
        const g = entry.graphics;
        if (layer.shapeMask.space === "layer") {
          g.position.set(transform.anchorX, transform.anchorY);
          g.pivot.set(
            layer.width * transform.pivotX,
            layer.height * transform.pivotY,
          );
          g.scale.set(targetW / layer.width, targetH / layer.height);
          g.rotation = sprite.rotation;
        } else {
          g.position.set(0, 0);
          g.pivot.set(0, 0);
          g.scale.set(1, 1);
          g.rotation = 0;
        }
        sprite.setMask({ mask: g, inverse: layer.shapeMask.inverse });
        const sweep = this.sweeps.get(layer.id);
        if (sweep)
          sweep.root.setMask({ mask: g, inverse: layer.shapeMask.inverse });
      }
      const next = p.assets.find(
        (a) =>
          a.id === assetAt(layer, Math.min(frame + 1, frameCount(p) - 1), p),
      );
      if (next && !this.textures.has(next.path) && !this.pending.has(next.path))
        void this.texture(next).catch(() => {});
    }
    this.app.renderer.render(this.app.stage);
  }
  png(): Promise<Uint8Array> {
    return new Promise((resolve, reject) =>
      this.app.canvas.toBlob(async (blob) => {
        if (!blob) {
          reject(Error("画布导出失败"));
          return;
        }
        resolve(new Uint8Array(await blob.arrayBuffer()));
      }, "image/png"),
    );
  }
  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    for (const c of this.controllers) c.abort();
    for (const sweep of this.sweeps.values()) {
      sweep.light.setMask({ mask: null });
      sweep.gradient.destroy();
    }
    this.sweeps.clear();
    for (const [id, entry] of this.shapeMasks) {
      const sprite = this.sprites.get(id);
      if (sprite) sprite.mask = null;
      entry.graphics.destroy();
    }
    this.shapeMasks.clear();
    this.app.destroy(true, { children: true });
    for (const t of this.textures.values()) t.destroy(true);
    this.textures.clear();
  }
}
