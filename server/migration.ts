import { makeAsset } from "./images";
// Compatibility is confined to disk migration. Public tools accept file paths only.
export async function migrateEmbeddedAsset(legacy: any, dir: string) {
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(legacy.data))
    throw Error("旧项目图片格式无效");
  const result = await makeAsset(
    Buffer.from(legacy.data.split(",")[1], "base64"),
    legacy.name,
    dir,
  );
  return { ...result, id: legacy.id, sourceBounds: legacy.sourceBounds };
}
