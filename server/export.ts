import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Project } from "../src/model";
import type { Runtime } from "./gateway";
import { renderFrame } from "./frame";
export async function closeRenderer() {}
export async function renderProject(
  p: Project,
  format: string,
  frame: number,
  _html: string,
  output: string,
  _runtime: Runtime,
) {
  if (format !== "png") throw Error("动画导出只能由用户在面板中手动启动");
  await mkdir(output, { recursive: true });
  const file = path.join(output, `${p.id}-snapshot-${randomUUID()}.png`);
  await writeFile(file, await renderFrame(p, frame));
  return { file, mimeType: "image/png" };
}
