import { useEffect, useState } from "react";
import { Button, Dialog } from "@galacean/editor-ui";
import { RefreshCw, LoaderCircle } from "lucide-react";
import { call } from "../bridge";
type Summary = { id: string; name: string; width: number; height: number; fps?: number; duration?: number; layerCount?: number; updatedAt?: string };
export function HistoryProjects({open, onOpenChange, onOpen, currentId, disabled}: {open: boolean; onOpenChange: (open: boolean) => void; onOpen: (id: string) => Promise<void>; currentId?: string; disabled: boolean}) {
  const [projects, setProjects] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<string>();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    setLoading(true); setError("");
    void call("list").then(result => { if (!disposed) setProjects(result.projects ?? []); }).catch(e => { if (!disposed) setError(String(e)); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [open, refresh]);
  const filtered = projects.filter(p => p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) || p.id.includes(query.trim().toLowerCase()));
  return <Dialog open={open} onOpenChange={value => {if (!opening) onOpenChange(value);}} closable className="editor-dialog" css={{width: 540, minWidth: "min(540px,calc(100vw - 24px))", padding: 20, zIndex: 1000}}>
    <h2>历史项目</h2>
    <div className="history-search"><input aria-label="搜索历史项目" placeholder="搜索项目名称或 ID" value={query} onChange={e => setQuery(e.target.value)} /><Button variant="subtle" size="sm" aria-label="刷新历史项目" disabled={loading || !!opening} onClick={() => setRefresh(v => v + 1)}><RefreshCw size={15} /></Button></div>
    {error && <p className="history-error" role="alert">{error}</p>}
    <div className="history-list" aria-label="历史项目列表" aria-busy={loading}>
      {loading ? <p role="status">正在读取历史项目…</p> : filtered.length === 0 ? <p>{projects.length ? "没有匹配的项目" : "暂无历史项目"}</p> : filtered.map(project => <article className="history-item" key={project.id}>
        <div><strong>{project.name}</strong>{project.id === currentId && <span className="history-current">当前项目</span>}<small>{project.width} × {project.height}{project.fps ? ` · ${project.fps} FPS · ${project.duration}s` : ""}{project.layerCount !== undefined ? ` · ${project.layerCount} 个图层` : ""}</small><small>{project.updatedAt ? new Date(project.updatedAt).toLocaleString() + " · " : ""}{project.id.slice(0, 8)}</small></div>
        <Button variant="secondary" size="sm" aria-label={`打开项目 ${project.name} ${project.id.slice(0,8)}`} disabled={disabled || !!opening} onClick={async () => { setOpening(project.id); setError(""); try { await onOpen(project.id); onOpenChange(false); } catch (e) {setError(String(e));} finally {setOpening(undefined);} }}>{opening === project.id ? <LoaderCircle size={14} className="spinning" /> : "打开"}</Button>
      </article>)}
    </div>
  </Dialog>;
}
