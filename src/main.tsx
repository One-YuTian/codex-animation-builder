import "./platform";
import { ExportPreview } from "./components/ExportPreview";
import { HistoryProjects } from "./components/HistoryProjects";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Button,
  Dialog,
  Select,
  SelectItem,
  InputNumber,
} from "@galacean/editor-ui";
import {
  History,
  Terminal,
  ChevronRight,
  ListTree,
  Play,
  Pause,
  Download,
  RefreshCw,
  Maximize,
  LoaderCircle,
  X,
  Plus,
  FolderOpen,
} from "lucide-react";
import { call, connect, context, saveExport, revealExport } from "./bridge";
import { initializeTheme } from "./theme";
import { frameCount, calculateFpsForDuration, type Project } from "./model";
import { Viewport } from "./components/Viewport";
import { Hierarchy } from "./components/Hierarchy";
import { MotionTimeline } from "./components/MotionTimeline";
import "./style.css";
initializeTheme();
createRoot(document.getElementById("root")!).render(<Preview />);
type Job = {
  id: string;
  state: "running" | "complete" | "failed" | "cancelled";
  completed: number;
  total: number;
  stage?: string;
  file?: string;
  mimeType?: string;
  error?: string;
};
function Preview() {
  const logViewport = useRef<HTMLDivElement>(null);
  const followLog = useRef(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const syncEpoch = useRef(0);
  const [logOpen, setLogOpen] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [logService, setLogService] = useState("正在连接日志服务…");
  useEffect(() => {
    if (logOpen && followLog.current && logViewport.current) logViewport.current.scrollTop = logViewport.current.scrollHeight;
  }, [logs, logOpen]);
  const [p, setP] = useState<Project>(),
    [selected, setSelected] = useState<string>(),
    [frame, setFrame] = useState(0),
    [error, setError] = useState(""),
    [refreshKey, setRefreshKey] = useState(0),
    [exportOpen, setExportOpen] = useState(false),
    [format, setFormat] = useState("gif"),
    [exportFps, setExportFps] = useState(24),
    [lossy, setLossy] = useState(30),
    [compressionLevel, setCompressionLevel] = useState(4),
    [exportDuration, setExportDuration] = useState(3),
    [job, setJob] = useState<Job>(),
    [starting, setStarting] = useState(false);
  useEffect(() => {
    if (p) {
      setExportFps(p.fps);
      setExportDuration(p.duration);
    }
  }, [p?.id]);
  const latest = useRef(p),
    selectedRef = useRef(selected),
    alive = useRef(true),
    downloaded = useRef<string>();
  latest.current = p;
  selectedRef.current = selected;
  const accept = useCallback((r: any) => {
    if (Array.isArray(r?.debugLogs)) {
      setLogs(r.debugLogs);
      setLogService(`服务 ${r.runtimeVersion ?? "旧版"} · UI 0.7.2`);
    } else if (r && "project" in r) {
      setLogService("当前连接为旧服务，未提供日志。请完全退出并重启 Codex。");
    }
    if (!r || !("project" in r)) return;
    if (!r.project) {
      latest.current = undefined;
      setP(undefined);
      return;
    }
    const next = r.project as Project,
      current = latest.current;
    if (current?.id === next.id && current.revision >= next.revision) return;
    latest.current = next;
    setP(next);
    setFrame(next.frame);
    if (next.id !== current?.id) {
      setSelected(undefined);
      setError("");
    }
    void context(next, selectedRef.current);
  }, []);
  const sync = useCallback(async () => {
    const epoch = syncEpoch.current;
    try {
      const result = await call("current");
      if (alive.current && epoch === syncEpoch.current) accept(result);
    } catch (e) {
      if (alive.current) setError(String(e));
    }
  }, [accept]);
  useEffect(() => {
    alive.current = true;
    let connected = false,
      pending = false;
    void connect(accept)
      .then(() => {
        connected = true;
        return sync();
      })
      .catch((e) => setError(String(e)));
    const timer = setInterval(() => {
      if (connected && !pending) {
        pending = true;
        void sync().finally(() => {
          pending = false;
        });
      }
    }, 1000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [accept, sync]);
  useEffect(() => {
    if (!p?.playing) return;
    const start = performance.now(),
      initial = p.frame;
    let handle = 0;
    function tick(time: number) {
      const project = latest.current;
      if (!project?.playing) return;
      setFrame(
        (initial + Math.floor(((time - start) * project.fps) / 1000)) %
          frameCount(project),
      );
      handle = requestAnimationFrame(tick);
    }
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [p?.playing, p?.fps, p?.duration, p?.frame]);
  const playback = async (args: Record<string, unknown>) => {
    if (!p) return;
    try {
      accept(await call("playback", { projectId: p.id, ...args }));
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    if (!job || job.state !== "running") return;
    let disposed = false;
    const update = async () => {
      try {
        const result = await call("export_status", { jobId: job.id });
        if (disposed) return;
        accept(result);
        setJob(result.job);
        if (
          result.job.state === "complete" &&
          result.job.file &&
          downloaded.current !== job.id
        ) {
          downloaded.current = job.id;
          await saveExport(result.job.file, result.job.mimeType);
        }
        if (result.job.state === "failed")
          setError(result.job.error ?? "导出失败");
      } catch (e) {
        if (!disposed) setError(String(e));
      }
    };
    const timer = setInterval(() => void update(), 600);
    void update();
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [job?.id, job?.state]);
  const running = job?.state === "running";
  const handleDurationChange = useCallback(
    async (desiredDuration: number) => {
      if (!p) return;
      const { duration, fps } = calculateFpsForDuration(desiredDuration, p.fps);
      try {
        const result = await call("settings", {
          projectId: p.id,
          duration,
          fps,
        });
        accept(result);
      } catch (e) {
        setError(String(e));
      }
    },
    [p, accept],
  );
  const toggleVisibility = async (
    kind: "layer" | "group" | "scene",
    id: string,
    visible: boolean,
  ) => {
    if (!p) return;
    try {
      accept(
        await call(
          kind === "layer"
            ? "update_layer"
            : kind === "group"
              ? "group_update"
              : "scene_update",
          {
            projectId: p.id,
            ...(kind === "layer"
              ? { layerId: id, patch: { visible } }
              : kind === "group"
                ? { groupId: id, patch: { visible } }
                : { visible }),
          },
        ),
      );
    } catch (e) {
      setError(String(e));
    }
  };
  const reveal = async () => {
    if (!job) return;
    try {
      await revealExport(job.id);
    } catch (e) {
      setError(String(e));
    }
  };
  const cancel = async () => {
    if (!job) return;
    try {
      const r = await call("cancel_export", { jobId: job.id });
      setJob(r.job);
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <div className="preview-shell">
      <header className="preview-header">
        <nav className="breadcrumbs" aria-label="面包屑">
          <ListTree size={15} />
          <span>动画</span>
          <ChevronRight size={13} />
          <strong>{p?.name ?? "等待 MCP 项目"}</strong>
        </nav>
        <div className="header-buttons">
          <Button variant="subtle" size="sm" title="展开 Log 调试输出" aria-label="展开 Log 调试输出" aria-expanded={logOpen} onClick={() => { followLog.current = true; setLogOpen(v => !v); }}><Terminal size={16} /></Button>
          {job?.state === "complete" && job.file && (
            <Button
              variant="subtle"
              size="sm"
              title="打开导出目录"
              aria-label="打开导出目录"
              onClick={() => void reveal()}
            >
              <FolderOpen size={16} />
            </Button>
          )}
          <Button variant="subtle" size="sm" title="打开历史项目" aria-label="打开历史项目" disabled={running || starting} onClick={() => setHistoryOpen(true)}><History size={16} /><span>历史项目</span></Button>
          <span className="composition-info">
            {p ? `${p.width} × ${p.height} · ${p.fps} FPS` : ""}
          </span>
          <Button
            variant="subtle"
            size="sm"
            title={p?.playing ? "暂停" : "播放"}
            disabled={!p}
            onClick={() => void playback({ frame, playing: !p?.playing })}
          >
            {p?.playing ? <Pause size={16} /> : <Play size={16} />}
          </Button>
          <Button
            variant="subtle"
            size="sm"
            title="适应画布"
            disabled={!p}
            onClick={() => setRefreshKey((n) => n + 1)}
          >
            <Maximize size={16} />
          </Button>
          <Button
            variant="subtle"
            size="sm"
            title="新建/重置画板"
            onClick={async () => {
              try {
                await call("reset", {});
                setP(undefined);
                setSelected(undefined);
                setFrame(0);
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            <Plus size={15} />
            <span>新建画板</span>
          </Button>
          <Button
            variant="subtle"
            size="sm"
            title="重新加载预览"
            onClick={() => {
              setError("");
              setRefreshKey((n) => n + 1);
              void sync();
            }}
          >
            <RefreshCw size={15} />
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!p}
            onClick={() => {
              setExportOpen(true);
            }}
          >
            {running ? (
              <LoaderCircle size={14} className="spinning" />
            ) : (
              <Download size={14} />
            )}
            <span>
              {running
                ? `导出 ${Math.round((job.completed / job.total) * 100)}%`
                : "导出"}
            </span>
          </Button>
          {running && (
            <Button
              variant="subtle"
              size="sm"
              title="取消导出"
              onClick={() => void cancel()}
            >
              <X size={15} />
            </Button>
          )}
        </div>
      </header>
      <main className="preview-main">
        <Hierarchy
          onToggle={toggleVisibility}
          project={p}
          selected={selected}
          onSelect={(id) => {
            setSelected(id);
            if (p) void context(p, id);
          }}
        />
        <section className="preview-stage">
          {p ? (
            <Viewport
              project={p}
              frame={frame}
              refreshKey={refreshKey}
              onError={setError}
            />
          ) : (
            <div className="preview-empty">
              <span>等待 MCP 载入画面</span>
              <Button variant="secondary" size="sm" onClick={() => setHistoryOpen(true)}>打开历史项目</Button>
              <small>项目创建、素材、图层与动画均由 MCP 管理。</small>
            </div>
          )}
          {error && (
            <div className="preview-error" role="alert">
              <span>{error}</span>
              <Button
                title="关闭提示"
                variant="subtle"
                size="xs"
                onClick={() => setError("")}
              >
                <X size={13} />
              </Button>
            </div>
          )}
        </section>
      </main>
      {logOpen && <aside className="debug-panel" aria-label="Log 调试输出">
        <header><strong>Log 调试输出</strong><span>{logService} · 最近 60 条</span><Button variant="subtle" size="sm" aria-label="关闭 Log" onClick={() => setLogOpen(false)}><X size={16} /></Button></header>
        <div className="debug-entries" ref={logViewport} onScroll={e => { const el = e.currentTarget; followLog.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32; }}>{logs.length === 0 ? <p>等待工具调用…</p> : logs.map((entry, i) => <article key={i}><div><time>{new Date(entry.time).toLocaleString()}</time> <strong>{entry.event}</strong></div><pre>{JSON.stringify(entry.details, (key, value) => /^(bytes|pngBytes|beforeBytes|afterBytes|totalBytes)$/.test(key) && typeof value === "number" ? `${value.toLocaleString()} B (${(value / 1024).toFixed(2)} KiB)` : value, 2)}</pre></article>)}</div>
      </aside>}
      <MotionTimeline
        onToggle={(id, visible) => void toggleVisibility("layer", id, visible)}
        project={p}
        frame={frame}
        selected={selected}
        onSelect={setSelected}
        onSeek={(f) => void playback({ frame: f, playing: false })}
        onScrub={setFrame}
        onDurationChange={handleDurationChange}
      />
      <HistoryProjects open={historyOpen} onOpenChange={setHistoryOpen} currentId={p?.id} disabled={!!running || starting} onOpen={async id => {
        syncEpoch.current++;
        try {
          const result = await call("get", {projectId: id, activate: true});
          if (!result?.project) throw Error("项目未能加载，请刷新列表后重试");
          accept(result); setSelected(undefined); setError(""); setRefreshKey(v => v + 1); setJob(undefined); setExportOpen(false); downloaded.current = undefined;
        } finally { syncEpoch.current++; }
      }} />
      <Dialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        closable
        className="editor-dialog"
        css={{
          width: 520,
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          minWidth: "min(360px,calc(100vw - 24px))",
          padding: 20,
          zIndex: 1000,
        }}
      >
        <h2>手动导出</h2>
        <p className="export-description">
          预览：{p?.name} · {p?.duration}s · {p?.fps} FPS
        </p>
        <Select
          value={format}
          onValueChange={setFormat}
          disabled={running || starting}
          triggerCss={{ width: "100%" }}
        >
          {[
            { value: "gif", label: "GIF 动图" },
            { value: "webp", label: "WebP 动图" },
            { value: "webm", label: "WebM 透明视频" },
            { value: "png", label: "PNG 当前帧" },
            { value: "png-sequence", label: "PNG 序列 ZIP" },
            { value: "project", label: "项目 JSON" },
          ].map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </Select>
        {(["gif", "webp", "webm", "png-sequence"].includes(format)) && (
          <div className="export-timing">
            <label>
              导出 FPS
              <InputNumber
                aria-label="导出 FPS"
                value={exportFps}
                min={1}
                max={24}
                step={1}
                size="sm"
                disabled={running || starting}
                onValueChange={(v) => {
                  const fps = Math.max(1, Math.min(24, Math.round(v)));
                  setExportFps(fps);
                  setExportDuration(
                    (d) => Math.max(1, Math.round(d * fps)) / fps,
                  );
                }}
              />
            </label>
            <label>
              导出时长（秒）
              <InputNumber
                aria-label="导出时长"
                value={exportDuration}
                min={1 / exportFps}
                max={3}
                step={1 / exportFps}
                size="sm"
                disabled={running || starting}
                onValueChange={(v) =>
                  setExportDuration(
                    Math.max(
                      1,
                      Math.min(3 * exportFps, Math.round(v * exportFps)),
                    ) / exportFps,
                  )
                }
              />
            </label>
            <p className="export-description">
              {Math.round(exportFps * exportDuration)} 帧 ·{" "}
              {exportDuration.toFixed(3)}{" "}
              秒。完整动画按此时长播放，不改变预览设置。
            </p>
          </div>
        )}
        {format === "gif" && (
          <div className="export-timing">
            <label>GIF Loss
              <InputNumber aria-label="GIF Loss" value={lossy} min={0} max={200} step={1} size="sm" disabled={running || starting}
                onValueChange={v => { if (Number.isFinite(v)) setLossy(Math.max(0, Math.min(200, Math.round(v)))); }} />
            </label>
            <p className="export-description">0–200，默认30。0关闭有损压缩，保留无损优化；数值越大，通常文件越小，细节损失越多。</p>
          </div>
        )}
        {format === "webp" && <div className="export-timing"><label>WebP 压缩等级<InputNumber aria-label="WebP 压缩等级" value={compressionLevel} min={0} max={6} step={1} size="sm" disabled={running || starting} onValueChange={v => {if(Number.isFinite(v))setCompressionLevel(Math.max(0,Math.min(6,Math.round(v))));}} /></label><p className="export-description">0–6，默认4；更高等级花费更多编码时间，通常文件更小。</p></div>}
        {job?.state === "complete" && job.file && job.mimeType && /^(image\/|video\/)/.test(job.mimeType) && <ExportPreview key={job.id} file={job.file} mimeType={job.mimeType} />}
        {job && (
          <p className="export-progress" role="status">
            {job.state === "running"
              ? job.stage || `正在导出 ${job.completed} / ${job.total} 帧`
              : job.state === "complete"
                ? "导出完成"
                : job.state === "cancelled"
                  ? "已取消"
                  : (job.error ?? "导出失败")}
          </p>
        )}
        <div className="export-actions">
          {job?.state === "complete" && job.file && (
            <Button
              variant="subtle"
              size="sm"
              title="打开导出目录"
              aria-label="打开导出目录"
              onClick={() => void reveal()}
            >
              <FolderOpen size={16} />
            </Button>
          )}

          {running ? (
            <Button variant="secondary" size="sm" onClick={() => void cancel()}>
              取消导出
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              disabled={!p || starting}
              onClick={async () => {
                if (!p) return;
                setStarting(true);
                setError("");
                try {
                  const animated =
                    ["gif", "webp", "webm", "png-sequence"].includes(format);
                  const result = await call("export", {
                    projectId: p.id,
                    format,
                    frame,
                    ...(format === "gif" ? { lossy } : {}),
                    ...(format === "webp" ? { compressionLevel } : {}),
                    ...(animated
                      ? { fps: exportFps, duration: exportDuration }
                      : {}),
                  });
                  accept(result);
                  setJob(result.job);
                } catch (e) {
                  setError(String(e));
                } finally {
                  setStarting(false);
                }
              }}
            >
              {starting ? "启动中" : "开始导出"}
            </Button>
          )}
        </div>
      </Dialog>
    </div>
  );
}
