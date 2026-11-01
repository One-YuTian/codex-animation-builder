import { debugLog } from "./debug-log";
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { readdir, unlink } from "node:fs/promises";
import {
  exportTiming,
  bounds,
  poseAt,
  frameCount,
  type Project,
} from "../src/model";
import { revealFile } from "./reveal";
export type ExportJob = {
  id: string;
  projectId: string;
  state: "running" | "complete" | "failed" | "cancelled";
  completed: number;
  total: number;
  fps?: number;
  duration?: number;
  lossy?: number;
  compressionLevel?: number;
  stage?: string;
  file?: string;
  mimeType?: string;
  error?: string;
};
export class ExportJobs {
  private worker?: Worker;
  private active?: string;
  private jobs = new Map<string, ExportJob>();
  constructor(private output: string) {}
  start(
    project: Project,
    format: string,
    frame: number,
    frames?: number,
    outputDir?: string,
    tempDir?: string,
    options: { fps?: number; duration?: number; lossy?: number; compressionLevel?: number } = {},
  ) {
    const lossy = options.lossy ?? 30;
    if (format === "gif" && (!Number.isInteger(lossy) || lossy < 0 || lossy > 200)) throw Error("GIF Loss 必须为0–200的整数");
    const compressionLevel = options.compressionLevel ?? 4;
    if (format === "webp" && (!Number.isInteger(compressionLevel) || compressionLevel < 0 || compressionLevel > 6)) throw Error("WebP压缩等级必须为0–6整数");
    const started = Date.now();
    const timing = exportTiming(project, options, frames);
    const exportTotal =
      format === "png" || format === "project" ? 1 : timing.total;
    if (["gif", "webp", "webm", "png-sequence"].includes(format))
      for (let i = 0; i < exportTotal; i++) {
        const sample =
          exportTotal === 1
            ? 0
            : (i * (frameCount(project) - 1)) / (exportTotal - 1);
        for (const layer of project.layers) {
          const b = bounds(layer, poseAt(layer, sample));
          if (
            b.x < -0.01 ||
            b.y < -0.01 ||
            b.x + b.width > project.width + 0.01 ||
            b.y + b.height > project.height + 0.01
          )
            throw Error(`图层 ${layer.name} 在导出第 ${i} 帧超出画布边界`);
        }
      }
    const pixels = project.width * project.height * exportTotal;
    if (format !== "project" && pixels > 64000000)
      throw Error(
        "导出超过6400万总帧像素，请降低尺寸、导出FPS或导出时长后重试",
      );
    if (this.active) throw Error("已有导出任务正在运行，请先完成或取消");
    const id = randomUUID(),
      job: ExportJob = {
        id,
        projectId: project.id,
        state: "running",
        completed: 0,
        total: exportTotal,
        fps: timing.fps,
        duration: timing.duration,
        ...(format === "gif" ? { lossy } : {}),
        ...(format === "webp" ? { compressionLevel } : {}),
      };
    this.jobs.set(id, job);
    this.active = id;
    const outDir = outputDir || this.output;
    const worker = new Worker(new URL("./export-worker.js", import.meta.url), {
      workerData: {
        project: structuredClone(project),
        format,
        frame,
        frames: exportTotal,
        exportFps: timing.fps,
        exportDuration: timing.duration,
        lossy,
        compressionLevel,
        output: outDir,
        tempDir,
        jobId: id,
      },
      resourceLimits: { maxOldGenerationSizeMb: 384 },
    });
    this.worker = worker;
    const timeout = setTimeout(() => {
      if (job.state === "running") {
        Object.assign(job, {
          state: "failed",
          error: "导出超过120秒，任务已停止",
        });
        finish();
      }
    }, 120000);
    timeout.unref();
    const finish = () => {
      clearTimeout(timeout);
      if (this.active === id) {
        this.active = undefined;
        this.worker = undefined;
      }
      void worker.terminate();
    };
    worker.on("message", (message) => {
      if (message.type === "log") { debugLog(message.event, { jobId: id, ...message.details }); return; }
      if (message.type !== "progress") debugLog("导出 " + message.type, { jobId: id, elapsedMs: Date.now() - started, ...message });
      if (job.state !== "running") return;
      if (message.type === "progress") {
        job.completed = message.completed;
        if (message.stage !== undefined) job.stage = message.stage;
      } else if (message.type === "done") {
        Object.assign(job, {
          state: "complete",
          completed: job.total,
          file: message.file,
          mimeType: message.mimeType,
        });
        finish();
      } else if (message.type === "error") {
        Object.assign(job, { state: "failed", error: message.error });
        finish();
      }
    });
    worker.on("error", (error) => {
      if (job.state === "running") {
        Object.assign(job, { state: "failed", error: error.message });
        finish();
      }
    });
    worker.on("exit", (code) => {
      clearTimeout(timeout);
      if (job.state === "running") {
        Object.assign(job, {
          state: "failed",
          error: `导出进程退出 (${code})`,
        });
        if (this.active === id) {
          this.active = undefined;
          this.worker = undefined;
        }
      }
    });
    return { ...job };
  }
  async reveal(id: string) {
    const job = this.jobs.get(id);
    if (job?.state !== "complete" || !job.file)
      throw Error("只能定位已完成的导出文件");
    return revealFile(job.file);
  }
  status(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw Error("导出任务不存在，可能服务已重启");
    return { ...job };
  }
  async cancel(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw Error("导出任务不存在");
    if (job.state === "running") {
      job.state = "cancelled";
      debugLog("导出已取消", { jobId: id });
      const worker = this.worker;
      this.worker = undefined;
      this.active = undefined;
      await worker?.terminate();
      try {
        for (const file of await readdir(this.output))
          if (file.includes(id)) await unlink(path.join(this.output, file));
      } catch {}
    }
    return { ...job };
  }
  async close() {
    if (this.active) await this.cancel(this.active);
  }
}
