// Perceptual chroma selection. ImageMagick owns decoding, quantization and crops.
import { convertImage, decodeImage } from "./magick";
export type RGB = [number, number, number];
export type Lab = [number, number, number];
export function rgbLab(rgb: RGB): Lab {
  const [r, g, b] = rgb.map((v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const f = (v: number) =>
    v > 216 / 24389 ? Math.cbrt(v) : ((24389 / 27) * v + 16) / 116;
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047),
    y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b),
    z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function deltaE00(a: Lab, b: Lab): number {
  const rad = Math.PI / 180,
    deg = 180 / Math.PI,
    p7 = 25 ** 7;
  const c1 = Math.hypot(a[1], a[2]),
    c2 = Math.hypot(b[1], b[2]),
    c = (c1 + c2) / 2,
    g = 0.5 * (1 - Math.sqrt(c ** 7 / (c ** 7 + p7)));
  const a1 = (1 + g) * a[1],
    a2 = (1 + g) * b[1],
    cp1 = Math.hypot(a1, a[2]),
    cp2 = Math.hypot(a2, b[2]);
  const hue = (x: number, y: number) => (Math.atan2(y, x) * deg + 360) % 360;
  const h1 = cp1 ? hue(a1, a[2]) : 0,
    h2 = cp2 ? hue(a2, b[2]) : 0;
  let dh = h2 - h1;
  if (!cp1 || !cp2) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dl = b[0] - a[0],
    dc = cp2 - cp1,
    dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dh * rad) / 2),
    lm = (a[0] + b[0]) / 2,
    cm = (cp1 + cp2) / 2;
  const hm =
    !cp1 || !cp2
      ? h1 + h2
      : Math.abs(h1 - h2) <= 180
        ? (h1 + h2) / 2
        : (h1 + h2 + (h1 + h2 < 360 ? 360 : -360)) / 2;
  const t =
    1 -
    0.17 * Math.cos((hm - 30) * rad) +
    0.24 * Math.cos(2 * hm * rad) +
    0.32 * Math.cos((3 * hm + 6) * rad) -
    0.2 * Math.cos((4 * hm - 63) * rad);
  const sl = 1 + (0.015 * (lm - 50) ** 2) / Math.sqrt(20 + (lm - 50) ** 2),
    sc = 1 + 0.045 * cm,
    sh = 1 + 0.015 * cm * t;
  const rt =
    -2 *
    Math.sqrt(cm ** 7 / (cm ** 7 + p7)) *
    Math.sin(60 * Math.exp(-(((hm - 275) / 25) ** 2)) * rad);
  return Math.sqrt(
    (dl / sl) ** 2 +
      (dc / sc) ** 2 +
      (dH / sh) ** 2 +
      rt * (dc / sc) * (dH / sh),
  );
}
export const hexRGB = (s: string): RGB => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];
export const rgbHex = (c: RGB) =>
  "#" +
  c
    .map((v) => Math.round(v).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
function hsv(h: number, s: number, v: number): RGB {
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c;
  const parts =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return parts.map((a) => Math.round((a + m) * 255)) as RGB;
}
export async function suggestBackground(source: string, override?: string) {
  const thumb = await convertImage(source, [
    "-resize",
    "128x128>",
    "+dither",
    "-colors",
    "64",
  ]);
  const { data } = await decodeImage(thumb),
    unique = new Map<string, RGB>();
  for (let i = 0; i < data.length; i += 4)
    if (data[i + 3] >= 128) {
      const c: RGB = [data[i], data[i + 1], data[i + 2]];
      unique.set(c.join(","), c);
    }
  const palette = [...unique.values()].map(rgbLab);
  if (!palette.length)
    return {
      color: override ?? "#808080",
      minDeltaE: 0,
      paletteSize: 0,
      method: "empty-foreground",
      userOverride: !!override, alternatives: [],
      warning: "区域没有可见像素",
    };
  const candidates: RGB[] = [];
  for (let h = 0; h < 360; h += 15)
    for (const s of [0.3, 0.5, 0.7])
      for (const v of [0.45, 0.65, 0.8]) candidates.push(hsv(h, s, v));
  candidates.push([127, 127, 127]);
  const ranked = (override ? [hexRGB(override)] : candidates)
    .map((rgb) => ({
      color: rgbHex(rgb),
      minDeltaE: Math.min(...palette.map((c) => deltaE00(rgbLab(rgb), c))),
    }))
    .sort((a, b) => b.minDeltaE - a.minDeltaE);
  return {
    ...ranked[0],
    paletteSize: palette.length,
    method: "ImageMagick-quantize-CIEDE2000-maxmin",
    userOverride: !!override,
    alternatives: override ? [] : ranked.slice(1, 4),
    ...(ranked[0].minDeltaE < 12
      ? {
          warning:
            "前景颜色覆盖较广，色键分离可能损伤相近颜色；优先原生透明生成或人工检查",
        }
      : {}),
  };
}
