import { z } from "zod";
const n = z.number().finite().min(-16384).max(16384),
  size = z.number().positive().max(16384);
export const shapeMaskSchema = z
  .object({
    space: z.enum(["canvas", "layer"]).default("canvas"),
    inverse: z.boolean().default(false),
    shape: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("rect"),
        x: n,
        y: n,
        width: size,
        height: size,
      }),
      z.object({
        type: z.literal("roundedRect"),
        x: n,
        y: n,
        width: size,
        height: size,
        radius: z.number().min(0).max(8192),
      }),
      z.object({ type: z.literal("circle"), x: n, y: n, radius: size }),
      z.object({
        type: z.literal("ellipse"),
        x: n,
        y: n,
        radiusX: size,
        radiusY: size,
      }),
      z.object({
        type: z.literal("polygon"),
        points: z
          .array(z.object({ x: n, y: n }))
          .min(3)
          .max(256),
      }),
    ]),
  })
  .superRefine((m, ctx) => {
    if (m.shape.type === "polygon") {
      const p = m.shape.points;
      let a = 0;
      for (let i = 0; i < p.length; i++) {
        const b = p[(i + 1) % p.length];
        a += p[i].x * b.y - b.x * p[i].y;
      }
      if (Math.abs(a) < 0.001)
        ctx.addIssue({ code: "custom", message: "多边形至少需要三个不共线点" });
    }
  });
export type ShapeMask = z.infer<typeof shapeMaskSchema>;
export function drawMask(g: any, m: ShapeMask) {
  const s = m.shape;
  g.clear();
  switch (s.type) {
    case "rect":
      g.rect(s.x, s.y, s.width, s.height);
      break;
    case "roundedRect":
      g.roundRect(
        s.x,
        s.y,
        s.width,
        s.height,
        Math.min(s.radius, s.width / 2, s.height / 2),
      );
      break;
    case "circle":
      g.circle(s.x, s.y, s.radius);
      break;
    case "ellipse":
      g.ellipse(s.x, s.y, s.radiusX, s.radiusY);
      break;
    case "polygon":
      g.poly(
        s.points.flatMap((p) => [p.x, p.y]),
        true,
      );
  }
  g.fill(0xffffff);
}
export function maskContains(m: ShapeMask, x: number, y: number) {
  const s = m.shape;
  let inside = false;
  switch (s.type) {
    case "rect":
      inside =
        x >= s.x && y >= s.y && x <= s.x + s.width && y <= s.y + s.height;
      break;
    case "circle":
      inside = (x - s.x) ** 2 + (y - s.y) ** 2 <= s.radius ** 2;
      break;
    case "ellipse":
      inside = ((x - s.x) / s.radiusX) ** 2 + ((y - s.y) / s.radiusY) ** 2 <= 1;
      break;
    case "roundedRect": {
      const r = Math.min(s.radius, s.width / 2, s.height / 2),
        cx = Math.max(s.x + r, Math.min(s.x + s.width - r, x)),
        cy = Math.max(s.y + r, Math.min(s.y + s.height - r, y));
      inside =
        x >= s.x &&
        x <= s.x + s.width &&
        y >= s.y &&
        y <= s.y + s.height &&
        (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      break;
    }
    case "polygon": {
      const p = s.points;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++)
        if (
          p[i].y > y !== p[j].y > y &&
          x < ((p[j].x - p[i].x) * (y - p[i].y)) / (p[j].y - p[i].y) + p[i].x
        )
          inside = !inside;
      break;
    }
  }
  return m.inverse ? !inside : inside;
}
