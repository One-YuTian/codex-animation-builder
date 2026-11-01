import { useState, useEffect } from "react";
import { Slider } from "@galacean/editor-ui";
import { Eye, EyeOff, Lock, Unlock, Diamond } from "lucide-react";
import { frameCount, type Project } from "../model";

type Props = {
  project?: Project;
  frame: number;
  selected?: string;
  onSelect: (id: string) => void;
  onSeek: (frame: number) => void;
  onScrub: (frame: number) => void;
  onDurationChange?: (duration: number) => void;
  onToggle?: (layerId: string, visible: boolean) => void;
};

export function MotionTimeline({
  project: p,
  frame,
  selected,
  onSelect,
  onSeek,
  onScrub,
  onDurationChange,
  onToggle,
}: Props) {
  const frames = p ? frameCount(p) : 72;
  const [durationInput, setDurationInput] = useState(
    p ? String(p.duration) : "3.0",
  );

  useEffect(() => {
    if (p) setDurationInput(String(p.duration));
  }, [p?.duration]);

  const commitDuration = (val: number) => {
    const clamped = Math.min(3.0, Math.max(0.5, Math.round(val * 100) / 100));
    setDurationInput(String(clamped));
    onDurationChange?.(clamped);
  };

  return (
    <section className="timeline">
      <div className="timeline-heading">
        <strong>时间轴</strong>
        <code>{p ? (frame / p.fps).toFixed(2) : "0.00"}s</code>
        {onDurationChange && p ? (
          <div className="timeline-duration-editor">
            <label>时长</label>
            <div className="timeline-duration-stepper">
              <button
                type="button"
                className="timeline-duration-btn"
                title="减少时长 (最低 0.5s)"
                disabled={p.duration <= 0.5}
                onClick={() => commitDuration(p.duration - 0.25)}
              >
                -
              </button>
              <input
                type="text"
                inputMode="decimal"
                className="timeline-duration-input"
                title="动画时长：0.5s - 3s"
                value={durationInput}
                onChange={(e) => setDurationInput(e.target.value)}
                onBlur={() => {
                  const num = parseFloat(durationInput);
                  if (isNaN(num)) setDurationInput(String(p.duration));
                  else commitDuration(num);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const num = parseFloat(durationInput);
                    if (isNaN(num)) setDurationInput(String(p.duration));
                    else commitDuration(num);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
              <button
                type="button"
                className="timeline-duration-btn"
                title="增加时长 (最高 3s)"
                disabled={p.duration >= 3.0}
                onClick={() => commitDuration(p.duration + 0.25)}
              >
                +
              </button>
            </div>
            <span className="timeline-fps-badge">{p.fps} FPS</span>
            <span className="timeline-frames-count">{frames} 帧</span>
          </div>
        ) : (
          <span>
            {p?.duration ?? 3}s · {p?.fps ?? 24} FPS
          </span>
        )}
      </div>
      <div className="tracks">
        <div className="track ruler-row">
          <span className="track-label">
            元素名称
            <span className="track-flags">
              <Lock size={12} />
              <Eye size={12} />
            </span>
          </span>
          <div className="ruler">
            <div className="ruler-labels">
              {Array.from({ length: 7 }, (_, i) => (
                <span key={i}>
                  {((i * (p?.duration ?? 3)) / 6).toFixed(1)}s
                </span>
              ))}
            </div>
            <Slider
              aria-label="当前帧"
              min={0}
              max={Math.max(1, frames - 1)}
              step={1}
              value={[frame]}
              compact
              disabled={!p || frames === 1}
              onValueChange={(v) => onScrub(v[0])}
              onValueCommit={(v) => onSeek(v[0])}
            />
          </div>
        </div>
        {p &&
          [...p.layers]
            .sort((a, b) => b.z - a.z)
            .map((l, index) => (
              <div
                key={l.id}
                className={"track " + (selected === l.id ? "selected" : "")}
                onClick={() => onSelect(l.id)}
              >
                <div className="track-label">
                  <i className={`layer-color color-${index % 4}`} />
                  <span>{l.name}</span>
                  <span className="track-flags">
                    {l.locked ? <Lock size={12} /> : <Unlock size={12} />}
                    <button
                      className="tree-eye"
                      aria-label={`${l.visible ? "隐藏" : "显示"}时间轴图层${l.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggle?.(l.id, !l.visible);
                      }}
                    >
                      {l.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                  </span>
                </div>
                <div
                  className="track-lane"
                  onDoubleClick={(e) => {
                    const b = e.currentTarget.getBoundingClientRect();
                    onSeek(
                      Math.max(
                        0,
                        Math.min(
                          frames - 1,
                          Math.round(
                            ((e.clientX - b.left) / b.width) * (frames - 1),
                          ),
                        ),
                      ),
                    );
                  }}
                >
                  <div
                    className={`duration-bar color-${index % 4}`}
                    style={{ opacity: l.visible ? 1 : 0.35 }}
                  >
                    {l.sequence.length
                      ? `${l.sequence.length} 帧序列`
                      : l.keyframes.length
                        ? "关键帧动画"
                        : "静态"}
                  </div>
                  {l.keyframes.map((k) => (
                    <button
                      key={k.frame}
                      title={`预览第 ${k.frame} 帧`}
                      className="key"
                      style={{
                        left: `${(k.frame / (frames - 1 || 1)) * 100}%`,
                      }}
                      onClick={() => onSeek(k.frame)}
                    >
                      <Diamond size={10} fill="currentColor" />
                    </button>
                  ))}
                  <div
                    className="playhead"
                    style={{ left: `${(frame / (frames - 1 || 1)) * 100}%` }}
                  />
                </div>
              </div>
            ))}
      </div>
    </section>
  );
}
