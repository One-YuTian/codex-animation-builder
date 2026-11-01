import { memo, useState, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  Box,
  Eye,
  EyeOff,
  Lock,
  Folder,
  FolderOpen,
  Layers,
} from "lucide-react";
import { isLayerVisible, type Project } from "../model";
type Kind = "layer" | "group" | "scene";
export const Hierarchy = memo(function Hierarchy({
  project: p,
  selected,
  onSelect,
  onToggle,
}: {
  project?: Project;
  selected?: string;
  onSelect: (id: string) => void;
  onToggle: (kind: Kind, id: string, visible: boolean) => void;
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  useEffect(() => setClosed(new Set()), [p?.id]);
  const fold = (id: string) =>
    setClosed((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const eye = (kind: Kind, id: string, name: string, visible: boolean) => (
    <button
      className="tree-eye"
      title={`${visible ? "隐藏" : "显示"}${name}`}
      aria-label={`${visible ? "隐藏" : "显示"}${name}`}
      onClick={() => onToggle(kind, id, !visible)}
    >
      {visible ? <Eye size={13} /> : <EyeOff size={13} />}
    </button>
  );
  function children(parentId?: string, depth = 1): React.ReactNode {
    if (!p) return null;
    const groups = (p.groups ?? []).filter((g) => g.parentId === parentId);
    const layers = p.layers
      .filter((l) => l.groupId === parentId)
      .sort((a, b) => b.z - a.z);
    return (
      <>
        {groups.map((g) => (
          <div role="treeitem" aria-expanded={!closed.has(g.id)} key={g.id}>
            <div className="tree-row" style={{ paddingLeft: depth * 12 }}>
              <button
                className="tree-label"
                title={g.name}
                onClick={() => fold(g.id)}
              >
                {closed.has(g.id) ? (
                  <ChevronRight size={12} />
                ) : (
                  <ChevronDown size={12} />
                )}
                {closed.has(g.id) ? (
                  <Folder size={14} />
                ) : (
                  <FolderOpen size={14} />
                )}
                <span>{g.name}</span>
              </button>
              {eye("group", g.id, g.name, g.visible)}
            </div>
            {!closed.has(g.id) && (
              <div role="group">{children(g.id, depth + 1)}</div>
            )}
          </div>
        ))}
        {layers.map((l) => (
          <div
            role="treeitem"
            aria-selected={selected === l.id}
            key={l.id}
            className={"tree-row " + (selected === l.id ? "selected" : "")}
            style={{
              paddingLeft: depth * 12,
              opacity: isLayerVisible(p, l) ? 1 : 0.6,
            }}
          >
            <button
              className="tree-label"
              title={l.name}
              onClick={() => onSelect(l.id)}
            >
              <Box size={13} />
              <span>{l.name}</span>
              {l.locked && <Lock size={11} />}
            </button>
            {eye("layer", l.id, l.name, l.visible)}
          </div>
        ))}
      </>
    );
  }
  const name = p?.scene?.name ?? "Scene";
  return (
    <aside className="hierarchy-panel">
      <div className="panel-caption">
        <Layers size={14} />
        层级<span>{p?.layers.length ?? 0}</span>
      </div>
      <div className="hierarchy-nodes" role="tree" aria-label="场景层级">
        <div role="treeitem" aria-expanded={!closed.has("scene")}>
          <div className="tree-row scene-root">
            <button
              className="tree-label"
              onClick={() => fold("scene")}
              aria-label={`${closed.has("scene") ? "展开" : "折叠"}${name}`}
            >
              {closed.has("scene") ? (
                <ChevronRight size={13} />
              ) : (
                <ChevronDown size={13} />
              )}
              <Box size={14} />
              <span>{name}</span>
            </button>
            {p && eye("scene", "scene", name, p.scene?.visible !== false)}
          </div>
          {!closed.has("scene") && <div role="group">{children()}</div>}
        </div>
      </div>
    </aside>
  );
});
