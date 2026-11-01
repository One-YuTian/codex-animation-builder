import { frameCount, type Layer, type Project } from "./model";
export function sweepGeometry(layer: Layer, frame: number, project: Project) {
  const effect = layer.effect;
  if (!effect) return undefined;
  const end = effect.endFrame ?? frameCount(project) - 1;
  if (frame < effect.startFrame || frame > end || end <= effect.startFrame) return undefined;
  const angle = effect.angle * Math.PI / 180;
  const nx = Math.cos(angle), ny = Math.sin(angle);
  const band = Math.max(layer.width, layer.height) * effect.width;
  const reach = (Math.abs(nx) * layer.width + Math.abs(ny) * layer.height + band) / 2;
  let progress = (frame - effect.startFrame) / (end - effect.startFrame);
  if (effect.direction === "reverse") progress = 1 - progress;
  return { nx, ny, angle, band, offset: (progress * 2 - 1) * reach };
}
export function sweepAlpha(x: number, y: number, geometry: NonNullable<ReturnType<typeof sweepGeometry>>) {
  return Math.max(0, 1 - Math.abs(x * geometry.nx + y * geometry.ny - geometry.offset) / (geometry.band / 2));
}
