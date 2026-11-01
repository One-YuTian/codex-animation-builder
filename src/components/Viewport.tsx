import { useEffect, useRef, useState } from "react";
import { SceneRenderer } from "../renderer";
import type { Project } from "../model";
type Props = {
  project: Project;
  frame: number;
  refreshKey: number;
  onError: (message: string) => void;
};
export function Viewport({ project: p, frame, refreshKey, onError }: Props) {
  const area = useRef<HTMLDivElement>(null),
    host = useRef<HTMLDivElement>(null),
    scene = useRef<SceneRenderer>(),
    latest = useRef(p),
    errorRef = useRef(onError),
    [readyId, setReadyId] = useState<string>(),
    [width, setWidth] = useState(1),
    [renderState, setRenderState] = useState("loading");
  latest.current = p;
  errorRef.current = onError;
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setWidth(
        Math.max(
          1,
          Math.min(
            el.clientWidth - 48,
            ((el.clientHeight - 48) * p.width) / p.height,
          ),
        ),
      ),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [p.width, p.height]);
  useEffect(() => {
    if (!host.current) return;
    let cancelled = false,
      initialized = false;
    const renderer = new SceneRenderer((message) => errorRef.current(message));
    scene.current = renderer;
    void renderer
      .init(host.current, latest.current.width, latest.current.height)
      .then(() => {
        initialized = true;
        if (cancelled) {
          renderer.destroy();
          return;
        }
        setReadyId(p.id);
      })
      .catch((e) => {
        if (!cancelled) errorRef.current(String(e));
      });
    return () => {
      cancelled = true;
      setReadyId(undefined);
      if (initialized) renderer.destroy();
    };
  }, [p.id]);
  useEffect(() => {
    if (readyId !== p.id) return;
    const renderer = scene.current;
    let cancelled = false;
    setRenderState("loading");
    void renderer
      ?.load(p)
      .then((ok) => {
        if (cancelled) return;
        renderer.draw(frame);
        setRenderState(ok ? "ready" : "error");
      })
      .catch((e) => {
        if (!cancelled) {
          setRenderState("error");
          errorRef.current(String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [p, readyId, refreshKey]);
  useEffect(() => {
    if (readyId === p.id) scene.current?.draw(frame);
  }, [frame, readyId, p.id]);
  return (
    <div className="canvas-area" ref={area}>
      <div
        className="artboard checker"
        style={{ width, aspectRatio: `${p.width}/${p.height}` }}
      >
        <div
          className="canvas-host"
          data-render-state={renderState}
          ref={host}
        />
        {renderState === "loading" && (
          <span className="canvas-loading" role="status">
            加载图片…
          </span>
        )}
      </div>
    </div>
  );
}
