// Keep binary data, complete UI state and diagnostics out of the model transcript.
export function sanitizeModel(value: any): any {
  if (typeof value === "string")
    return /^data:.*;base64,/s.test(value) ? "[binary omitted]" : value;
  if (Array.isArray(value)) return value.map(sanitizeModel);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k]) => !["debugLogs", "image_url", "base64", "binary"].includes(k),
        )
        .map(([k, v]) => [k, sanitizeModel(v)]),
    );
  return value;
}
export function modelResult(op: string, args: any, result: any) {
  const { project, ...extra } = result;
  if (args?.detail === "full" && (op === "get" || op === "current"))
    return sanitizeModel(result);
  const summary = project
    ? {
        id: project.id,
        name: project.name,
        revision: project.revision,
        width: project.width,
        height: project.height,
        fps: project.fps,
        duration: project.duration,
        background: project.background,
        stage: project.stage,
        layerCount: project.layers.length,
        assetCount: project.assets.length,
        reference: project.reference,
      }
    : project === null
      ? null
      : undefined;
  const out: any = { ...extra };
  // Snapshot only needs PNG path and hash, not a duplicate timeline.
  if (op === "snapshot") delete out.layers;
  if (summary !== undefined) out.project = summary;
  if (project && ["get", "current", "create", "restore"].includes(op)) {
    out.layers = project.layers.map(
      ({
        id,
        name,
        assetId,
        x,
        y,
        width,
        height,
        z,
        semantic,
        groupId,
        visible,
        keyframes,
        effect,
        shapeMask,
        transformOrigin,pivotX,pivotY,
      }: any) => ({
        id,
        name,
        assetId,
        x,
        y,
        width,
        height,
        z,
        semantic,
        groupId,
        visible,
        keyframeCount: keyframes.length,
        effect,
        shapeMask,
      }),
    );
    out.groups = project.groups;
  }
  if (project && op === "add_layer") out.layer = project.layers.at(-1);
  if (project && ["update_layer", "keyframes", "sequence"].includes(op))
    out.layer = project.layers.find((l: any) => l.id === args.layerId);
  if (project && op === "split_atlas" && args.addLayers !== false) {
    const ids = new Set((result.assets ?? []).map((a: any) => a.id));
    out.layers = project.layers.filter((l: any) => ids.has(l.assetId));
  }
  return sanitizeModel(out);
}
