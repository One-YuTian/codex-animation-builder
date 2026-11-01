import { rgbLab, deltaE00, hexRGB, type RGB } from "./chroma";
export type MatteOptions = {
  backgroundColor?: string;
  mode?: "connected" | "all";
  metric?: "rgb" | "lab";
  innerThreshold?: number;
  outerThreshold?: number;
  despill?: number;
  smoothRadius?: number;
};
// Continuous matte; joint bilateral refinement uses source RGB as guidance.
export function chromaMatte(
  data: Buffer,
  w: number,
  h: number,
  areas: { x: number; y: number; width: number; height: number }[],
  tolerance: number,
  feather: number,
  options: MatteOptions = {},
) {
  const original = Buffer.from(data),
    n = w * h;
  for (const r of areas) {
    const colors: RGB[] = [];
    if (options.backgroundColor) colors.push(hexRGB(options.backgroundColor));
    else {
      // Ignore transparent padding: sample visible perimeter pixels, not alpha-zero RGB.
      const perimeter: number[] = [];
      for (let x = r.x; x < r.x + r.width; x++) {
        perimeter.push(r.y * w + x, (r.y + r.height - 1) * w + x);
      }
      for (let y = r.y + 1; y < r.y + r.height - 1; y++) {
        perimeter.push(y * w + r.x, y * w + r.x + r.width - 1);
      }
      const hist = new Map<string, { rgb: RGB; count: number }>();
      for (const p of perimeter) {
        const i = p * 4;
        if (original[i + 3] < 128) continue;
        const rgb: RGB = [original[i], original[i + 1], original[i + 2]],
          key = rgb.map((v) => v >> 4).join(",");
        const v = hist.get(key);
        if (v) v.count++;
        else hist.set(key, { rgb, count: 1 });
      }
      colors.push(
        ...[...hist.values()]
          .sort((a, b) => b.count - a.count)
          .slice(0, 1)
          .map((v) => v.rgb),
      );
      // A fully transparent perimeter already has a valid alpha; do not guess interior colors.
      if (!colors.length) continue;
    }
    const labs = colors.map(rgbLab),
      metric = options.metric ?? (options.backgroundColor ? "lab" : "rgb");
    const lo = options.innerThreshold ?? (metric === "lab" ? 4 : tolerance),
      hi =
        options.outerThreshold ??
        (metric === "lab" ? 18 : tolerance + Math.max(1, feather));
    if (hi <= lo) throw Error("outerThreshold 必须大于 innerThreshold");
    const matte = new Float32Array(n).fill(1),
      selected = new Uint8Array(n),
      which = new Uint8Array(n),
      queue = new Int32Array(r.width * r.height);
    for (let y = r.y; y < r.y + r.height; y++)
      for (let x = r.x; x < r.x + r.width; x++) {
        const p = y * w + x,
          i = p * 4,
          c: RGB = [original[i], original[i + 1], original[i + 2]];
        let best = Infinity,
          index = 0;
        const lab = metric === "lab" ? rgbLab(c) : undefined;
        colors.forEach((b, k) => {
          const d = lab
            ? deltaE00(lab, labs[k])
            : Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]);
          if (d < best) {
            best = d;
            index = k;
          }
        });
        const t = Math.max(0, Math.min(1, (best - lo) / (hi - lo)));
        matte[p] = t * t * (3 - 2 * t);
        which[p] = index;
      }
    const global =
      options.mode === "all" ||
      (options.mode === undefined && !!options.backgroundColor);
    if (global) {
      for (let y = r.y; y < r.y + r.height; y++)
        for (let x = r.x; x < r.x + r.width; x++) selected[y * w + x] = 1;
    } else {
      let start = 0,
        end = 0;
      const visit = (x: number, y: number) => {
        if (x < r.x || y < r.y || x >= r.x + r.width || y >= r.y + r.height)
          return;
        const p = y * w + x;
        if (selected[p] || (matte[p] >= 1 && original[p * 4 + 3] > 0)) return;
        selected[p] = 1;
        queue[end++] = p;
      };
      for (let x = r.x; x < r.x + r.width; x++) {
        visit(x, r.y);
        visit(x, r.y + r.height - 1);
      }
      for (let y = r.y; y < r.y + r.height; y++) {
        visit(r.x, y);
        visit(r.x + r.width - 1, y);
      }
      while (start < end) {
        const p = queue[start++],
          x = p % w,
          y = Math.floor(p / w);
        visit(x - 1, y);
        visit(x + 1, y);
        visit(x, y - 1);
        visit(x, y + 1);
      }
    }
    const radius = options.smoothRadius ?? 1,
      refined = Float32Array.from(matte);
    if (radius)
      for (let y = r.y; y < r.y + r.height; y++)
        for (let x = r.x; x < r.x + r.width; x++) {
          const p = y * w + x;
          if (!selected[p] || matte[p] <= 0 || matte[p] >= 1) continue;
          let sum = 0,
            weight = 0;
          for (let dy = -radius; dy <= radius; dy++)
            for (let dx = -radius; dx <= radius; dx++) {
              const xx = x + dx,
                yy = y + dy;
              if (
                xx < r.x ||
                yy < r.y ||
                xx >= r.x + r.width ||
                yy >= r.y + r.height
              )
                continue;
              const q = yy * w + xx;
              if (!selected[q]) continue;
              const d =
                (original[p * 4] - original[q * 4]) ** 2 +
                (original[p * 4 + 1] - original[q * 4 + 1]) ** 2 +
                (original[p * 4 + 2] - original[q * 4 + 2]) ** 2;
              const k = Math.exp(
                -(dx * dx + dy * dy) / Math.max(1, 2 * radius * radius) -
                  d / (2 * 32 ** 2),
              );
              sum += matte[q] * k;
              weight += k;
            }
          refined[p] = sum / Math.max(weight, 1e-8);
        }
    for (let y = r.y; y < r.y + r.height; y++)
      for (let x = r.x; x < r.x + r.width; x++) {
        const p = y * w + x,
          i = p * 4;
        if (!selected[p]) continue;
        const a = refined[p],
          b = colors[which[p]];
        data[i + 3] = Math.min(data[i + 3], Math.round(original[i + 3] * a));
        if (!data[i + 3]) {
          data[i] = data[i + 1] = data[i + 2] = 0;
          continue;
        }
        const strength = options.despill ?? 1;
        if (a < 1 && a > 0.04)
          for (let c = 0; c < 3; c++) {
            const unmix = Math.max(
              0,
              Math.min(255, (original[i + c] - (1 - a) * b[c]) / a),
            );
            data[i + c] = Math.round(
              original[i + c] * (1 - strength) + unmix * strength,
            );
          }
      }
  }
  return data;
}
