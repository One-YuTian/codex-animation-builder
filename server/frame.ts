import { maskContains } from "../src/masks";
import { sweepGeometry, sweepAlpha } from "../src/effects";
import {
  assetAt,
  poseAt,
  isLayerVisible,
  transformGeometry,
  type Project,
} from "../src/model";
import {
  convertImage,
  composeImages,
  pngSize,
  decodeImage,
  encodeRgba,
} from "./magick";
export async function renderFrame(p: Project, frame: number): Promise<Buffer> {
  const overlays: { input: Buffer; left: number; top: number }[] = [];
  for (const layer of [...p.layers].sort((a, b) => a.z - b.z)) {
    if (!isLayerVisible(p, layer)) continue;
    const pose = poseAt(layer, frame);
    if (pose.opacity <= 0) continue;
    const asset = p.assets.find((a) => a.id === assetAt(layer, frame, p));
    if (!asset) throw Error("图层资源不存在：" + layer.name);
    let w = Math.max(1, Math.round(layer.width * pose.scaleX)),
      h = Math.max(1, Math.round(layer.height * pose.scaleY));
    const factor = Math.min(
      1,
      (layer.transformOrigin === "visual-center"
        ? p.width
        : Math.min(p.width, asset.width)) / w,
      (layer.transformOrigin === "visual-center"
        ? p.height
        : Math.min(p.height, asset.height)) / h,
    );
    w = Math.max(1, Math.round(w * factor));
    h = Math.max(1, Math.round(h * factor));
    const args = ["-resize", `${w}x${h}!`, "-background", "none"];
    if (pose.rotation % 360) args.push("-rotate", String(pose.rotation));
    if (pose.opacity < 1)
      args.push(
        "-alpha",
        "on",
        "-channel",
        "A",
        "-evaluate",
        "multiply",
        String(pose.opacity),
        "+channel",
      );
    args.push("+repage");
    const transform = transformGeometry(layer, pose, w, h);
    const input = await convertImage(asset.path, args),
      info = pngSize(input);
    const addOverlay = async (input: Buffer, width: number, height: number) => {
      const left = Math.round(transform.centerX - width / 2),
        top = Math.round(transform.centerY - height / 2);
      if (layer.shapeMask) {
        const { data } = await decodeImage(input),
          m = layer.shapeMask,
          r = (pose.rotation * Math.PI) / 180,
          c = Math.cos(r),
          s = Math.sin(r);
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            if (!data[i + 3]) continue;
            let coverage = 0;
            for (const sy of [0.25, 0.75])
              for (const sx of [0.25, 0.75]) {
                let mx = left + x + sx,
                  my = top + y + sy;
                if (m.space === "layer") {
                  const dx = mx - transform.anchorX,
                    dy = my - transform.anchorY;
                  mx =
                    (dx * c + dy * s) / (w / layer.width) +
                    layer.width * transform.pivotX;
                  my =
                    (-dx * s + dy * c) / (h / layer.height) +
                    layer.height * transform.pivotY;
                }
                if (maskContains(m, mx, my)) coverage++;
              }
            data[i + 3] = Math.round((data[i + 3] * coverage) / 4);
          }
        input = await encodeRgba(data, width, height);
      }
      overlays.push({ input, left, top });
    };
    await addOverlay(input, info.width, info.height);
    const geometry = sweepGeometry(layer, frame, p);
    if (layer.effect && geometry) {
      const resized = await convertImage(asset.path, ["-resize", `${w}x${h}!`]);
      const { data } = await decodeImage(resized);
      const color = layer.effect.color
        .slice(1)
        .match(/../g)!
        .map((n) => parseInt(n, 16));
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const at = (y * w + x) * 4;
          const alpha = sweepAlpha(
            ((x + 0.5) * layer.width) / w - layer.width / 2,
            ((y + 0.5) * layer.height) / h - layer.height / 2,
            geometry,
          );
          data[at] = color[0];
          data[at + 1] = color[1];
          data[at + 2] = color[2];
          data[at + 3] = Math.round(
            data[at + 3] * alpha * layer.effect.opacity,
          );
        }
      const light = await convertImage(await encodeRgba(data, w, h), args);
      const size = pngSize(light);
      await addOverlay(light, size.width, size.height);
    }
  }
  return composeImages(
    p.width,
    p.height,
    p.scene?.visible === false ? "transparent" : p.background,
    overlays,
  );
}
