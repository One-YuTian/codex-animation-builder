import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createGateway } from "../server/gateway";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { easingSchema } from "../src/model";
import { operations } from "../server/core";
import { Store, visualHash } from "../server/core";
import {
  keyImage,
  makeAsset,
  splitComponents,
  splitGrid,
} from "../server/images";
import {
  bounds,
  ease,
  frameCount,
  layerSchema,
  poseAt,
  validateProject,
} from "../src/model";
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "animation-test-"));
  const store = new Store(
    root,
    async () => ({
      file: path.join(root, "snapshot.png"),
      mimeType: "image/png",
    }),
    {
      start: () => ({ state: "running" }),
      status: () => ({}),
      cancel: async () => ({}),
    } as any,
  );
  const { project: p } = await store.execute("create", {
    width: 200,
    height: 160,
  });
  const source = path.join(root, "source.png");
  await sharp({
    create: { width: 20, height: 20, channels: 4, background: "#e74862" },
  })
    .png()
    .toFile(source);
  const { asset } = await store.execute("import_image", {
    projectId: p.id,
    path: source,
    name: "button",
  });
  const { project } = await store.execute("add_layer", {
    projectId: p.id,
    layer: {
      name: "button",
      assetId: asset.id,
      x: 30,
      y: 40,
      width: 20,
      height: 20,
    },
  });
  return { store, p: project };
}
test("limits and exact frame duration", async () => {
  const { store, p } = await fixture();
  await assert.rejects(() =>
    store.execute("settings", { projectId: p.id, fps: 25 }),
  );
  await assert.rejects(() =>
    store.execute("settings", { projectId: p.id, duration: 3.1 }),
  );
  await assert.rejects(() =>
    store.execute("settings", { projectId: p.id, duration: 0.1 }),
  );
  const r = await store.execute("settings", {
    projectId: p.id,
    duration: 1 / 24,
  });
  assert.equal(frameCount(r.project), 1);
});
test("visual review gates and stale snapshots; pass persists through later keyframes", async () => {
  const { store, p } = await fixture(),
    layerId = p.layers[0].id;
  await assert.rejects(() =>
    store.execute("keyframes", { projectId: p.id, layerId, keyframes: [] }),
  );
  const s = await store.execute("snapshot", { projectId: p.id });
  await store.execute("update_layer", {
    projectId: p.id,
    layerId,
    patch: { x: 31 },
  });
  await assert.rejects(() =>
    store.execute("review", {
      projectId: p.id,
      score: 0.9,
      notes: "stale",
      snapshotHash: s.snapshotHash,
    }),
  );
  const shot = await store.execute("snapshot", { projectId: p.id });
  await store.execute("review", {
    projectId: p.id,
    score: 0.85,
    notes: "button matches",
    snapshotHash: shot.snapshotHash,
  });
  await store.execute("keyframes", {
    projectId: p.id,
    layerId,
    keyframes: [
      { frame: 0, x: 31 },
      { frame: 71, x: 130, easing: [0.42, 0, 0.58, 1] },
    ],
  });
  const r = await store.execute("export", { projectId: p.id, format: "gif" });
  assert.equal(r.job.state, "running");
});
test("review fails permanently after three low scores", async () => {
  const { store, p } = await fixture();
  for (let i = 0; i < 3; i++) {
    const shot = await store.execute("snapshot", { projectId: p.id });
    await store.execute("review", {
      projectId: p.id,
      snapshotHash: shot.snapshotHash,
      score: 0.7,
      notes: "shape differs",
    });
  }
  assert.equal((await store.get(p.id)).stage, "failed");
  await assert.rejects(() =>
    store.execute("export", { projectId: p.id, format: "gif" }),
  );
  await assert.rejects(() =>
    store.execute("review", {
      projectId: p.id,
      snapshotHash: visualHash(p),
      score: 1,
      notes: "override",
    }),
  );
  await assert.rejects(() =>
    store.execute("update_layer", {
      projectId: p.id,
      layerId: p.layers[0].id,
      patch: { x: 35 },
    }),
  );
});
test("atomic rejection of bounds and Bezier overshoot at every frame", async () => {
  const { store, p } = await fixture();
  await assert.rejects(() =>
    store.execute("update_layer", {
      projectId: p.id,
      layerId: p.layers[0].id,
      patch: { x: 199 },
    }),
  );
  assert.equal((await store.get(p.id)).layers[0].x, 30);
  const q = structuredClone(p);
  q.layers[0].keyframes = [{ frame: 71, x: 179, easing: [0.2, 4, 0.8, 4] }];
  assert.throws(() => validateProject(q), /超出/);
});
test("rotation center, partial keys and easing", () => {
  const l = layerSchema.parse({
    id: "test",
    name: "test",
    assetId: "a",
    x: 20,
    y: 20,
    width: 30,
    height: 10,
    keyframes: [
      { frame: 10, x: 40 },
      { frame: 20, opacity: 0 },
    ],
  });
  assert.equal(poseAt(l, 5).x, 30);
  assert.equal(poseAt(l, 15).x, 40);
  assert.equal(poseAt(l, 10).opacity, 0.5);
  assert.deepEqual(bounds(l, { ...poseAt(l, 0), rotation: 90 }), {
    x: 30,
    y: 10,
    width: 10.000000000000002,
    height: 30,
  });
  assert.ok(Math.abs(ease(0.5, [0.42, 0, 0.58, 1]) - 0.5) < 1e-5);
});
test("four corner flood fill and atlas coordinates", async () => {
  const image = await sharp({
    create: { width: 100, height: 80, channels: 4, background: "#00ff00" },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="100" height="80"><rect x="10" y="12" width="20" height="15" fill="#f00"/><rect x="60" y="45" width="12" height="20" fill="#00f"/></svg>',
        ),
      },
    ])
    .png()
    .toBuffer();
  const original = await makeAsset(
      image,
      "atlas",
      await mkdtemp(path.join(os.tmpdir(), "atlas-")),
    ),
    keyed = await keyImage(original, 20, 0);
  const raw = await sharp(keyed.path).ensureAlpha().raw().toBuffer();
  assert.equal(raw[3], 0);
  assert.equal(raw[(12 * 100 + 10) * 4 + 3], 255);
  const parts = await splitComponents(keyed, 5, 0);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[0].sourceBounds, {
    x: 10,
    y: 12,
    width: 20,
    height: 15,
  });
  assert.deepEqual(parts[1].sourceBounds, {
    x: 60,
    y: 45,
    width: 12,
    height: 20,
  });
  const grid = await splitGrid(original, 2, 2, 4);
  assert.deepEqual(
    grid.map((a) => [a.width, a.height]),
    [
      [50, 40],
      [50, 40],
      [50, 40],
      [50, 40],
    ],
  );
  await assert.rejects(() => splitGrid(original, 3, 2, 6));
});
test("per-region sampling does not key other cells or touch an enclosed matching foreground", async () => {
  const image = await sharp({
    create: { width: 20, height: 10, channels: 4, background: "#00ff00" },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="20" height="10"><rect x="10" width="10" height="10" fill="#ff00ff"/><rect x="2" y="2" width="6" height="6" fill="#ff0000"/><rect x="4" y="4" width="2" height="2" fill="#00ff00"/></svg>',
        ),
      },
    ])
    .png()
    .toBuffer();
  const asset = await makeAsset(
    image,
    "regions",
    await mkdtemp(path.join(os.tmpdir(), "regions-")),
  );
  const keyed = await keyImage(asset, 10, 0, [
    { x: 0, y: 0, width: 10, height: 10 },
    { x: 10, y: 0, width: 10, height: 10 },
  ]);
  const raw = await sharp(keyed.path).ensureAlpha().raw().toBuffer();
  assert.equal(raw[(4 * 20 + 4) * 4 + 3], 255);
  assert.equal(raw[(1 * 20 + 11) * 4 + 3], 0);
});
test("grid frame order and sequence time distribution", async () => {
  const { assetAt } = await import("../src/model");
  const l = layerSchema.parse({
    id: "l",
    name: "seq",
    assetId: "base",
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    sequence: ["a", "b", "c"],
    sequenceStart: 2,
    sequenceEnd: 7,
  });
  const { p } = await fixture();
  assert.equal(assetAt(l, 0, p), "base");
  assert.equal(assetAt(l, 2, p), "a");
  assert.equal(assetAt(l, 4, p), "b");
  assert.equal(assetAt(l, 7, p), "c");
  assert.equal(assetAt(l, 8, p), "c");
});
test("project restore validates data, preserves layers and resets external review claims", async () => {
  const { store, p } = await fixture();
  const { project } = await store.execute("restore", {
    project: { ...p, reviews: [{ score: 1 }], stage: "export" },
  });
  assert.notEqual(project.id, p.id);
  assert.deepEqual(project.layers, p.layers);
  assert.deepEqual(project.reviews, []);
  assert.equal(project.stage, "compose");
  const invalid = structuredClone(p);
  invalid.assets[0].width = 99;
  await assert.rejects(
    () => store.execute("restore", { project: invalid }),
    /尺寸/,
  );
});
test("image API and project persistence contain paths only; transparent canvas is default", async () => {
  const { store, p } = await fixture();
  assert.equal(p.background, "transparent");
  assert.ok(path.isAbsolute(p.assets[0].path));
  assert.ok(!("data" in p.assets[0]));
  const saved = await readFile(path.join(store.root, p.id + ".json"), "utf8");
  assert.ok(!saved.includes("data:image/"));
  assert.ok(!saved.includes("base64"));
  await assert.rejects(() =>
    store.execute("import_image", {
      projectId: p.id,
      data: "removed",
      name: "invalid",
    }),
  );
  const shot = await store.execute("snapshot", { projectId: p.id });
  assert.ok(path.isAbsolute(shot.file));
  assert.equal(shot.data, undefined);
});
test("binary upload/file gateway authenticates and confines paths; no binary is encoded in JSON", async () => {
  const { store, p } = await fixture();
  const html = path.join(store.root, "index.html");
  await writeFile(html, "<html><head></head></html>");
  const gateway = await createGateway(store.root, html, async (op, args) =>
    store.execute(op as any, args),
  );
  try {
    const bytes = await readFile(p.assets[0].path),
      url = gateway.runtime.origin;
    assert.equal(
      (
        await fetch(
          url + "/api/file?path=" + encodeURIComponent(p.assets[0].path),
        )
      ).status,
      403,
    );
    const file = await fetch(gateway.fileUrl(p.assets[0].path));
    assert.equal(file.status, 200);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
    const escaped = await fetch(gateway.fileUrl(html));
    assert.equal(escaped.status, 400);
    const upload = await fetch(url + "/api/upload?name=image.png", {
      method: "POST",
      headers: {
        "X-Animation-Token": gateway.runtime.token,
        "Content-Type": "application/octet-stream",
      },
      body: bytes,
    });
    const result = await upload.json();
    assert.ok(path.isAbsolute(result.path));
    assert.deepEqual(await readFile(result.path), bytes);
    assert.equal(result.data, undefined);
    assert.equal(
      (await fetch(url + "/")).headers.get("access-control-allow-origin"),
      null,
    );
  } finally {
    await new Promise<void>((resolve) => gateway.web.close(() => resolve()));
  }
});
test("legacy embedded images migrate on disk without leaking into public results", async () => {
  const { store, p } = await fixture();
  const legacy: any = structuredClone(p);
  legacy.assets[0].data =
    "data:image/png;base64," +
    (await readFile(legacy.assets[0].path)).toString("base64");
  delete legacy.assets[0].path;
  await writeFile(
    path.join(store.root, p.id + ".json"),
    JSON.stringify(legacy),
  );
  const reopened = new Store(store.root, store.render);
  const result = await reopened.execute("get", { projectId: p.id });
  assert.ok(path.isAbsolute(result.project.assets[0].path));
  assert.ok(!JSON.stringify(result).includes("base64"));
  assert.equal(result.project.stage, "compose");
});

test("independent MCP connections observe current disk state", async () => {
  const { store, p } = await fixture();
  const other = new Store(store.root, store.render);
  await other.execute("get", { projectId: p.id });
  await store.execute("update_layer", {
    projectId: p.id,
    layerId: p.layers[0].id,
    patch: { x: 55 },
  });
  assert.equal((await other.execute("current", {})).project.layers[0].x, 55);
});
test("CPU snapshot ignores unused missing assets and preserves transparency and placement", async () => {
  const { p } = await fixture();
  const { renderFrame } = await import("../server/frame");
  p.assets.push({
    ...p.assets[0],
    id: "unused",
    path: "Z:/missing-reference.png",
  });
  const raw = await sharp(await renderFrame(p, 0))
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert.equal(raw[3], 0);
  const offset = (45 * p.width + 35) * 4;
  assert.deepEqual([...raw.subarray(offset, offset + 4)], [231, 72, 98, 255]);
  p.layers[0].opacity = 0.5;
  const faded = await sharp(await renderFrame(p, 0))
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert.ok(faded[offset + 3] >= 126 && faded[offset + 3] <= 128);
});

test("manual export worker renders a tiny two-frame fixture and supports cancellation", async () => {
  const { ExportJobs } = await import("../server/jobs");
  const { store, p } = await fixture();
  p.width = 32;
  p.height = 32;
  p.fps = 2;
  p.duration = 1;
  p.layers[0].x = 0;
  p.layers[0].y = 0;
  p.layers[0].keyframes = [
    { frame: 0, x: 0 },
    { frame: 1, x: 10 },
  ];
  const jobs = new ExportJobs(path.join(store.root, "exports"));
  try {
    const job = jobs.start(p, "gif", 0);
    assert.equal(job.state, "running");
    await assert.rejects(async () => jobs.start(p, "gif", 0), /已有/);
    let status = job;
    const deadline = Date.now() + 10000;
    while (status.state === "running" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      status = jobs.status(job.id);
    }
    assert.equal(status.state, "complete", status.error);
    const meta = await sharp(status.file!, { animated: true }).metadata();
    assert.equal(meta.pages, 2);
    assert.equal(meta.width, 32);
    assert.equal(
      meta.delay!.reduce((a, b) => a + b, 0),
      1000,
    );
    const pixel = await sharp(status.file!, { page: 0 })
      .ensureAlpha()
      .raw()
      .toBuffer();
    assert.equal(pixel[3], 255);
    assert.ok(pixel[0] > 200 && pixel[1] < 100);
    const cancel = jobs.start(p, "png-sequence", 0);
    assert.equal((await jobs.cancel(cancel.id)).state, "cancelled");
    assert.throws(
      () => jobs.start({ ...p, width: 4096, height: 4096, fps: 24 }, "gif", 0),
      /6400/,
    );
  } finally {
    await jobs.close();
  }
});

test("app-only image chunks are confined, bounded, versioned and reconstruct exact bytes", async () => {
  const { readAssetChunk } = await import("../server/asset-reader");
  const { store, p } = await fixture();
  const source = p.assets[0].path;
  let offset = 0,
    version: string | undefined;
  const parts: Buffer[] = [];
  do {
    const chunk = await readAssetChunk(store.root, source, offset, version);
    assert.ok(chunk.bytes.length <= 49152);
    assert.equal(chunk.offset, offset);
    parts.push(Buffer.from(chunk.bytes));
    offset = chunk.next;
    version = chunk.version;
    if (offset === chunk.total) break;
  } while (true);
  assert.deepEqual(Buffer.concat(parts), await readFile(source));
  await assert.rejects(
    () => readAssetChunk(store.root, path.join(store.root, p.id + ".json"), 0),
    /assets/,
  );
  await assert.rejects(() => readAssetChunk(store.root, source, -1), /偏移/);
  await assert.rejects(
    () => readAssetChunk(store.root, source, 0, "stale"),
    /改变/,
  );
  const large = path.join(store.root, "assets", "large.png");
  const bytes = Buffer.alloc(120001, 73);
  await writeFile(large, bytes);
  const a = await readAssetChunk(store.root, large, 0),
    b = await readAssetChunk(store.root, large, a.next, a.version),
    c = await readAssetChunk(store.root, large, b.next, b.version);
  assert.equal(c.next, bytes.length);
  assert.deepEqual(
    Buffer.concat([
      Buffer.from(a.bytes),
      Buffer.from(b.bytes),
      Buffer.from(c.bytes),
    ]),
    bytes,
  );
});

test("readAssetChunk reads from exports directory", async () => {
  const { readAssetChunk } = await import("../server/asset-reader");
  const { store } = await fixture();
  const exportDir = path.join(store.root, "exports");
  await mkdir(exportDir, { recursive: true });
  const exportedFile = path.join(exportDir, "test-exported.gif");
  const sampleData = Buffer.from("GIF89a-test-binary-data");
  await writeFile(exportedFile, sampleData);
  const chunk = await readAssetChunk(store.root, exportedFile, 0);
  assert.equal(chunk.total, sampleData.length);
  assert.deepEqual(Buffer.from(chunk.bytes), sampleData);
});

test("duration change keeps FPS unchanged within [0.5s, 3s] and max 24 FPS", async () => {
  const { calculateFpsForDuration } = await import("../src/model");
  let res = calculateFpsForDuration(3.0, 24);
  assert.equal(res.fps, 24);
  assert.equal(res.duration, 3.0);

  res = calculateFpsForDuration(1.0, 24);
  assert.equal(res.fps, 24);
  assert.equal(res.duration, 1.0);

  res = calculateFpsForDuration(2.0, 24);
  assert.equal(res.fps, 24);
  assert.equal(res.duration, 2.0);

  res = calculateFpsForDuration(3.0, 12);
  assert.equal(res.fps, 12);
  assert.equal(res.duration, 3.0);

  res = calculateFpsForDuration(0.5, 24);
  assert.equal(res.fps, 24);
  assert.equal(res.duration, 0.5);

  res = calculateFpsForDuration(0.2, 24);
  assert.equal(res.duration, 0.5);
  assert.equal(res.fps, 24);

  res = calculateFpsForDuration(5.0, 24);
  assert.equal(res.duration, 3.0);
  assert.equal(res.fps, 24);
});

test("export custom frames cannot exceed preview frames and renders specified count", async () => {
  const { store, p } = await fixture();
  const shot = await store.execute("snapshot", { projectId: p.id });
  await store.execute("review", {
    projectId: p.id,
    snapshotHash: shot.snapshotHash,
    score: 0.9,
    notes: "ok",
  });
  const updated = (
    await store.execute("settings", {
      projectId: p.id,
      fps: 10,
      duration: 1,
    })
  ).project;
  await assert.rejects(
    () =>
      store.execute("export", {
        projectId: p.id,
        format: "gif",
        frames: 15,
      }),
    /不能超过预览状态下的帧数/,
  );
  const { ExportJobs } = await import("../server/jobs");
  const jobs = new ExportJobs(path.join(store.root, "exports"));
  try {
    const job = jobs.start(updated, "gif", 0, 5);
    let status = job;
    const deadline = Date.now() + 10000;
    while (status.state === "running" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      status = jobs.status(job.id);
    }
    assert.equal(status.state, "complete");
    assert.equal(status.total, 5);
    const meta = await sharp(status.file!, { animated: true }).metadata();
    assert.ok(meta.pages!>=1 && meta.pages!<=5);
    assert.equal(meta.delay!.reduce((a,b)=>a+b,0),1000,"merged static frames must preserve full duration");
  } finally {
    await jobs.close();
  }
});

test("ffmpeg.wasm and gifsicle.wasm synthesize and compress GIF correctly", async () => {
  const { framesToGif, compressGif, processFramesToOptimizedGif } =
    await import("../server/wasm-gif");
  const f1 = await sharp({
    create: { width: 32, height: 32, channels: 4, background: "#ff0000" },
  })
    .png()
    .toBuffer();
  const f2 = await sharp({
    create: { width: 32, height: 32, channels: 4, background: "#0000ff" },
  })
    .png()
    .toBuffer();

  const events: Array<{ event: string; details: any }> = [];
  const onLog = (event: string, details: unknown) =>
    events.push({ event, details });
  const rawGif = await framesToGif([f1, f2], { fps: 10, onLog });
  assert.ok(rawGif.length > 0);
  const metaRaw = await sharp(Buffer.from(rawGif), {
    animated: true,
  }).metadata();
  assert.equal(metaRaw.pages, 2);
  assert.equal(metaRaw.width, 32);

  const compressed = await compressGif(rawGif, {
    onLog,
    lossy: 30,
    optimizeLevel: "-O3",
  });
  assert.ok(compressed.length > 0);
  assert.ok(compressed.length <= rawGif.length);
  const compressedMeta = await sharp(Buffer.from(compressed), {
    animated: true,
  }).metadata();
  assert.equal(compressedMeta.pages, 2);
  assert.deepEqual(compressedMeta.delay, metaRaw.delay);
  for (const engine of ["ffmpeg", "gifsicle"]) {
    assert.ok(
      events.some(
        (e) => e.event === "WASM 命令" && e.details.engine === engine,
      ),
    );
    assert.ok(
      events.some(
        (e) =>
          e.event === "WASM 调用完成" &&
          e.details.engine === engine &&
          e.details.bytes > 0,
      ),
    );
  }
  assert.ok(!events.some((e) => e.event === "WASM 调用失败"));

  const pipelineGif = await processFramesToOptimizedGif([f1, f2], {
    fps: 10,
    lossy: 30,
    optimizeLevel: "-O3",
  });
  assert.ok(pipelineGif.length > 0);
  const metaPipeline = await sharp(Buffer.from(pipelineGif), {
    animated: true,
  }).metadata();
  assert.equal(metaPipeline.pages, 2);
  assert.equal(metaPipeline.width, 32);
});

test("reset operation clears active project without deleting project on disk", async () => {
  const { store, p } = await fixture();
  assert.equal(await store.active(), p.id);
  const activeProj = await store.execute("current", {});
  assert.equal(activeProj.project?.id, p.id);

  const resetRes = await store.execute("reset", {});
  assert.equal(resetRes.project, null);
  assert.equal(await store.active(), undefined);

  const currentAfterReset = await store.execute("current", {});
  assert.equal(currentAfterReset.project, null);

  // Previous project still preserved and retrievable
  const oldProj = await store.get(p.id);
  assert.equal(oldProj.id, p.id);
});

test("new projects create categorized subdirectories for inputs, outputs, temp, assets", async () => {
  const { store, p } = await fixture();
  const dirs = store.getProjectDirs(p.id);
  const { stat } = await import("node:fs/promises");
  assert.ok((await stat(dirs.root)).isDirectory());
  assert.ok((await stat(dirs.inputs)).isDirectory());
  assert.ok((await stat(dirs.outputs)).isDirectory());
  assert.ok((await stat(dirs.temp)).isDirectory());
  assert.ok((await stat(dirs.assets)).isDirectory());
  assert.ok((await stat(dirs.projectFile)).isFile());

  // Test import_image writes to inputs/
  const sample = await sharp({
    create: { width: 40, height: 40, channels: 4, background: "#00ff00" },
  })
    .png()
    .toBuffer();
  const rawFile = path.join(dirs.temp, "test-import.png");
  await (await import("node:fs/promises")).writeFile(rawFile, sample);
  const imported = await store.execute("import_image", {
    projectId: p.id,
    path: rawFile,
    name: "imported-test",
  });
  assert.ok(
    imported.asset.path.includes(path.join("projects", p.id, "inputs")),
  );

  // Test key_image writes to assets/
  const keyed = await store.execute("key_image", {
    projectId: p.id,
    assetId: imported.asset.id,
  });
  assert.ok(keyed.asset.path.includes(path.join("projects", p.id, "assets")));
});

test("layer dimensions exceeding original asset size are automatically scaled down", async () => {
  const { store, p } = await fixture();
  const dirs = store.getProjectDirs(p.id);
  // Create an asset of 50x50
  const sample = await sharp({
    create: { width: 50, height: 50, channels: 4, background: "#ff00ff" },
  })
    .png()
    .toBuffer();
  const rawFile = path.join(dirs.temp, "small-asset.png");
  await (await import("node:fs/promises")).writeFile(rawFile, sample);
  const imported = await store.execute("import_image", {
    projectId: p.id,
    path: rawFile,
    name: "small-asset",
  });

  // Attempt to add layer with width 200, height 100 (exceeds 50x50)
  const res = await store.execute("add_layer", {
    projectId: p.id,
    layer: {
      name: "oversized-layer",
      assetId: imported.asset.id,
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      z: 1,
      visible: true,
      locked: false,
      keyframes: [],
    },
  });

  const addedLayer = res.project.layers.find(
    (l: any) => l.name === "oversized-layer",
  );
  assert.ok(addedLayer);
  // Should be scaled down to fit within 50x50 with preserved aspect ratio (2:1 -> 50x25)
  assert.equal(addedLayer.width, 50);
  assert.equal(addedLayer.height, 25);
});

test("duration retiming collapses frame collisions and reduces redundant baked keys", async () => {
  const { store, p } = await fixture();
  const l = p.layers[0];
  l.keyframes = Array.from({ length: 72 }, (_, frame) => ({
    frame,
    x: 30 + frame,
    easing: "linear" as const,
  }));
  await store.save(p);
  const result = await store.execute("settings", {
    projectId: p.id,
    duration: 0.5,
  });
  assert.equal(result.project.layers[0].keyframes.length, 2);
  assert.deepEqual(
    result.project.layers[0].keyframes.map((k: any) => k.frame),
    [0, 11],
  );
  const q = await store.get(p.id);
  q.layers[0].keyframes = [
    { frame: 0, opacity: 1, easing: "linear" },
    { frame: 1, x: 32, easing: "linear" },
    { frame: 2, rotation: 1, easing: "linear" },
    { frame: 11, x: 60, easing: "easeInOut" },
  ];
  await store.save(q);
  const compressed = await store.execute("settings", {
    projectId: p.id,
    fps: 4,
    duration: 0.5,
  });
  const keys = compressed.project.layers[0].keyframes;
  assert.equal(new Set(keys.map((k: any) => k.frame)).size, keys.length);
  assert.ok(keys.length <= 2);
  assert.equal(keys[0].x, 32);
  assert.equal(keys[0].rotation, 1);
  assert.equal(keys[0].opacity, 1);
});

test("independent export FPS and duration resample full motion without changing preview", async () => {
  const { ExportJobs } = await import("../server/jobs");
  const { unzipSync } = await import("fflate");
  const { store, p } = await fixture();
  p.width = 32;
  p.height = 32;
  p.fps = 2;
  p.duration = 1;
  p.layers[0].x = 0;
  p.layers[0].y = 0;
  p.layers[0].keyframes = [
    { frame: 0, x: 0, easing: "linear" },
    { frame: 1, x: 10, easing: "linear" },
  ];
  const before = structuredClone(p);
  const jobs = new ExportJobs(path.join(store.root, "exports"));
  try {
    const overshoot = structuredClone(p);
    overshoot.layers[0].keyframes[1].easing = [0.2, 4, 0.8, 4];
    assert.throws(
      () =>
        jobs.start(
          overshoot,
          "png-sequence",
          0,
          undefined,
          undefined,
          undefined,
          { fps: 12, duration: 1 },
        ),
      /导出.*超出/,
    );
    const job = jobs.start(
      p,
      "png-sequence",
      0,
      undefined,
      undefined,
      undefined,
      { fps: 6, duration: 2 },
    );
    assert.equal(job.total, 12);
    let status = job;
    const deadline = Date.now() + 10000;
    while (status.state === "running" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      status = jobs.status(job.id);
    }
    assert.equal(status.state, "complete", status.error);
    const zip = unzipSync(await readFile(status.file!));
    const manifest = JSON.parse(Buffer.from(zip["manifest.json"]).toString());
    assert.equal(manifest.fps, 6);
    assert.equal(manifest.duration, 2);
    assert.equal(manifest.frames, 12);
    const first = await sharp(zip["frame-000.png"])
        .ensureAlpha()
        .raw()
        .toBuffer(),
      last = await sharp(zip["frame-011.png"]).ensureAlpha().raw().toBuffer();
    assert.equal(first[3], 255);
    assert.equal(last[3], 0);
    assert.deepEqual(p, before);
    await assert.rejects(() => jobs.reveal("unknown"), /已完成/);
  } finally {
    await jobs.close();
  }
});

test("reveal resolves completed export paths for the Codex host without launching processes", async () => {
  const { revealFile } = await import("../server/reveal");
  const { store } = await fixture();
  const file = path.join(store.root, "a file & name.json");
  await writeFile(file, "{}");
  assert.deepEqual(await revealFile(file), { file, directory: store.root });
  await assert.rejects(() => revealFile(path.join(store.root, "missing.json")));
});

test("nested semantic groups preserve coordinates, inherit visibility and reject cycles atomically", async () => {
  const { store, p } = await fixture();
  const id = p.layers[0].id;
  const parent = (
    await store.execute("group_create", { projectId: p.id, name: "装饰" })
  ).group;
  const child = (
    await store.execute("group_create", {
      projectId: p.id,
      name: "金币",
      parentId: parent.id,
      layerIds: [id],
    })
  ).group;
  await assert.rejects(
    () =>
      store.execute("group_update", {
        projectId: p.id,
        groupId: parent.id,
        patch: { parentId: child.id },
      }),
    /循环/,
  );
  assert.equal((await store.get(p.id)).groups![0].parentId, undefined);
  const hidden = (
    await store.execute("group_update", {
      projectId: p.id,
      groupId: parent.id,
      patch: { visible: false },
    })
  ).project;
  const { isLayerVisible } = await import("../src/model");
  assert.equal(isLayerVisible(hidden, hidden.layers[0]), false);
  const { renderFrame } = await import("../server/frame");
  const raw = await sharp(await renderFrame(hidden, 0))
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert.equal(raw[(45 * p.width + 35) * 4 + 3], 0);
  await store.execute("group_remove", { projectId: p.id, groupId: parent.id });
  let next = await store.get(p.id);
  assert.equal(next.groups![0].parentId, undefined);
  assert.equal(next.layers[0].x, 30);
  await store.execute("group_remove", { projectId: p.id, groupId: child.id });
  next = await store.get(p.id);
  assert.equal(next.layers[0].groupId, undefined);
  const scene = (
    await store.execute("scene_update", { projectId: p.id, visible: false })
  ).project;
  assert.equal(isLayerVisible(scene, scene.layers[0]), false);
});
test("transparent references preserve canvas alpha and explicit background choices", async () => {
  const { store, p } = await fixture();
  const file = path.join(store.root, "transparent.png");
  await sharp({
    create: {
      width: 20,
      height: 20,
      channels: 4,
      background: { r: 20, g: 40, b: 60, alpha: 0 },
    },
  })
    .png()
    .toFile(file);
  const reference = await store.execute("import_image", {
    projectId: p.id,
    path: file,
    name: "透明参考",
    reference: true,
  });
  assert.equal(reference.asset.transparent, true);
  assert.equal(reference.project.background, "transparent");
  await store.execute("settings", { projectId: p.id, background: "#123456" });
  const explicit = await store.execute("import_image", {
    projectId: p.id,
    path: file,
    name: "透明参考2",
    reference: true,
  });
  assert.equal(explicit.project.background, "#123456");
});
test("MCP alone resizes generated atlases and creates aspect-preserving transparent padding", async () => {
  const { store, p } = await fixture();
  const generated = path.join(store.root, "generated-atlas.png");
  await sharp({
    create: { width: 400, height: 320, channels: 4, background: "#e74862" },
  })
    .png()
    .toFile(generated);
  const imported = await store.execute("import_image", {
    projectId: p.id,
    path: generated,
    name: "生成图集",
    fit: "canvas",
  });
  assert.deepEqual(
    [imported.nativeAsset.width, imported.nativeAsset.height],
    [400, 320],
  );
  assert.equal((await sharp(imported.nativeAsset.path).metadata()).width, 400);
  assert.deepEqual(
    [imported.asset.width, imported.asset.height],
    [p.width, p.height],
  );
  const resized = await store.execute("resize_image", {
    projectId: p.id,
    assetId: p.assets[0].id,
    width: 40,
    height: 80,
    fit: "contain",
  });
  assert.deepEqual([resized.asset.width, resized.asset.height], [40, 80]);
  const { data, info } = await sharp(resized.asset.path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.height, 80);
  assert.equal(data[3], 0);
  assert.equal(data[(40 * 40 + 20) * 4 + 3], 255);
  assert.equal((await store.get(p.id)).assets[0].width, 20);
});
test("magick.wasm preserves raw RGBA, handles concurrent operations and recovers after invalid input", async () => {
  const { encodeRgba, decodeImage, convertImage } =
    await import("../server/magick");
  const rgba = Buffer.from([
    255, 0, 0, 128, 0, 255, 0, 0, 0, 0, 255, 255, 25, 50, 75, 255,
  ]);
  const png = await encodeRgba(rgba, 2, 2);
  const decoded = await decodeImage(png);
  assert.deepEqual(decoded.data, rgba);
  await assert.rejects(() => convertImage(Buffer.from("invalid")));
  const outputs = await Promise.all(
    [1, 2, 3].map((n) => convertImage(png, ["-resize", `${n}x${n}!`])),
  );
  for (let n = 0; n < outputs.length; n++)
    assert.equal((await sharp(outputs[n]).metadata()).width, n + 1);
});

test("ImageMagick GIF fallback preserves frame count, transparency and exact timing", async () => {
  const { encodeGif, gifPages } = await import("../server/magick");
  const a = await sharp({
    create: {
      width: 8,
      height: 8,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
  const b = await sharp({
    create: { width: 8, height: 8, channels: 4, background: "red" },
  })
    .png()
    .toBuffer();
  const gif = await encodeGif([a, b], 2);
  const meta = await sharp(gif, { animated: true }).metadata();
  assert.equal(gifPages(gif), 2);
  assert.equal(meta.pages, 2);
  assert.equal(
    meta.delay!.reduce((a, b) => a + b, 0),
    1000,
  );
  assert.ok(meta.hasAlpha);
});
test("WASM frame composition keeps center rotation and opacity aligned with Pixi", async () => {
  const { p } = await fixture();
  const layer = p.layers[0];
  layer.height = 10;
  layer.rotation = 90;
  layer.opacity = 0.5;
  const { renderFrame } = await import("../server/frame");
  const raw = await sharp(await renderFrame(p, 0))
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert.ok(
    raw[(36 * p.width + 36) * 4 + 3] >= 126 &&
      raw[(36 * p.width + 36) * 4 + 3] <= 128,
  );
  assert.equal(raw[(41 * p.width + 31) * 4 + 3], 0);
});

test("generated imports accept smaller and differing-ratio content and preserve native resources", async () => {
  const { store, p } = await fixture();
  const source = async (name: string, width: number, height: number) => {
    const file = path.join(store.root, name + ".png");
    await sharp({
      create: { width, height, channels: 4, background: "#11aacc" },
    })
      .png()
      .toFile(file);
    return file;
  };
  await store.execute("import_image", {
    projectId: p.id,
    path: await source("reference", 400, 320),
    name: "原始参考",
    reference: true,
  });
  for (const [name, width, height] of [
    ["small", 40, 30],
    ["short", 600, 300],
    ["narrow", 300, 600],
  ] as const) {
    const r = await store.execute("import_image", {
      projectId: p.id,
      path: await source(name, width, height),
      name,
      fit: "canvas",
    });
    assert.deepEqual(
      [r.nativeAsset.width, r.nativeAsset.height],
      [width, height],
    );
    assert.deepEqual([r.asset.width, r.asset.height], [200, 160]);
  }
  const differing = await store.execute("import_image", {
    projectId: p.id,
    path: await source("different-ratio", 800, 800),
    name: "比例不同仍允许导入",
    fit: "canvas",
  });
  assert.deepEqual(
    [differing.nativeAsset.width, differing.nativeAsset.height],
    [800, 800],
  );
  assert.deepEqual([differing.asset.width, differing.asset.height], [200, 160]);
  const accepted = await store.execute("import_image", {
    projectId: p.id,
    path: await source("valid", 800, 640),
    name: "独立高分辨率图层",
    fit: "canvas",
  });
  assert.deepEqual(
    [accepted.nativeAsset.width, accepted.nativeAsset.height],
    [800, 640],
  );
  assert.deepEqual([accepted.asset.width, accepted.asset.height], [200, 160]);
  assert.ok(
    accepted.project.assets.some((a: any) => a.id === accepted.nativeAsset.id),
  );
  const resized = await store.execute("resize_image", {
    projectId: p.id,
    assetId: accepted.asset.id,
    width: 200,
    height: 200,
    fit: "fill",
  });
  assert.deepEqual([resized.asset.width, resized.asset.height], [200, 200]);
});

test("sweep MCP settings persist, invalidate review, retime, hide and remove atomically", async () => {
  const { store, p } = await fixture();
  const initial = await store.get(p.id);
  const layerId = initial.layers[0].id;
  const before = visualHash(initial);
  const updated = await store.execute("update_layer", {
    projectId: p.id,
    layerId,
    patch: { effect: { type: "sweep", startFrame: 0, endFrame: 71 } },
  });
  assert.equal(updated.project.layers[0].effect.color, "#ffffff");
  assert.notEqual(visualHash(updated.project), before);
  assert.equal((await store.get(p.id)).layers[0].effect?.endFrame, 71);
  const revision = updated.project.revision;
  await assert.rejects(
    store.execute("update_layer", {
      projectId: p.id,
      layerId,
      patch: { effect: { type: "sweep", startFrame: 71, endFrame: 2 } },
    }),
  );
  assert.equal((await store.get(p.id)).revision, revision);
  const retimed = await store.execute("settings", {
    projectId: p.id,
    duration: 1,
  });
  assert.equal(retimed.project.layers[0].effect.endFrame, 23);
  await store.execute("update_layer", {
    projectId: p.id,
    layerId,
    patch: { visible: false },
  });
  const { renderFrame } = await import("../server/frame");
  const hidden = await sharp(await renderFrame(await store.get(p.id), 12))
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert.ok(hidden.every((n, i) => i % 4 !== 3 || n === 0));
  await store.execute("update_layer", {
    projectId: p.id,
    layerId,
    patch: { effect: null },
  });
  assert.equal((await store.get(p.id)).layers[0].effect, null);
});

test("GIF Loss accepts zero and bounds, rejects negative, fractional and oversized values", async () => {
  const { operations } = await import("../server/core");
  const { p } = await fixture();
  for (const lossy of [0, 30, 73, 200])
    assert.equal(
      operations.export.parse({ projectId: p.id, lossy }).lossy,
      lossy,
    );
  for (const lossy of [-1, 0.5, 201, Infinity])
    assert.throws(() => operations.export.parse({ projectId: p.id, lossy }));
});

test("history lists projects once with metadata and activates saved content after reset", async () => {
  const { store, p } = await fixture();
  const saved = await store.get(p.id);
  const second = (
    await store.execute("create", {
      name: "Other history",
      width: 32,
      height: 32,
    })
  ).project;
  await store.execute("reset", {});
  const listed = await store.execute("list", {});
  assert.equal(listed.projects.length, 2);
  assert.equal(new Set(listed.projects.map((p: any) => p.id)).size, 2);
  const summary = listed.projects.find((x: any) => x.id === p.id);
  assert.equal(summary.layerCount, 1);
  assert.equal(summary.fps, saved.fps);
  assert.ok(Number.isFinite(Date.parse(summary.updatedAt)));
  assert.ok(listed.projects[0].updatedAt >= listed.projects[1].updatedAt);
  const opened = await store.execute("get", {
    projectId: p.id,
    activate: true,
  });
  assert.deepEqual(opened.project, saved);
  assert.equal((await store.execute("current", {})).project.id, p.id);
  assert.equal((await store.get(second.id)).name, "Other history");
});

test("explicitly opened history bypasses review across connections; new and restored projects still require review", async () => {
  const { store, p } = await fixture();
  await assert.rejects(
    store.execute("export", { projectId: p.id, format: "gif" }),
    /80%/,
  );
  await store.execute("get", { projectId: p.id });
  await assert.rejects(
    store.execute("export", { projectId: p.id, format: "gif" }),
    /80%/,
  );
  const before = await store.get(p.id);
  await store.execute("get", { projectId: p.id, activate: true });
  assert.deepEqual(
    await store.get(p.id),
    before,
    "opening history must not fabricate review scores or change project contents",
  );
  const other = new Store(store.root, store.render, store.jobs);
  assert.equal(
    (await other.execute("export", { projectId: p.id, format: "gif" })).job
      .state,
    "running",
  );
  await other.execute("keyframes", {
    projectId: p.id,
    layerId: p.layers[0].id,
    keyframes: [
      { frame: 0, x: 30 },
      { frame: 71, x: 40 },
    ],
  });
  await other.execute("settings", { projectId: p.id, duration: 1 });
  assert.equal(
    (await other.execute("export", { projectId: p.id, format: "png" })).job
      .state,
    "running",
  );
  await assert.rejects(
    other.execute("export", { projectId: p.id, format: "gif", fps: 25 }),
  );
  const fresh = (await other.execute("create", { width: 32, height: 32 }))
    .project;
  await assert.rejects(
    other.execute("export", { projectId: fresh.id, format: "gif" }),
    /80%/,
  );
  const restored = (await other.execute("restore", { project: before }))
    .project;
  await assert.rejects(
    other.execute("export", { projectId: restored.id, format: "gif" }),
    /80%/,
  );
});

test("historical failed reviews do not block manual reopening, editing or export", async () => {
  const { store, p } = await fixture();
  const failed = await store.get(p.id);
  failed.stage = "failed";
  await store.save(failed);
  await assert.rejects(
    store.execute("export", { projectId: p.id, format: "gif" }),
    /失败/,
  );
  await store.execute("get", { projectId: p.id, activate: true });
  assert.equal(
    (await store.execute("export", { projectId: p.id, format: "gif" })).job
      .state,
    "running",
  );
  await store.execute("update_layer", {
    projectId: p.id,
    layerId: p.layers[0].id,
    patch: { x: 31 },
  });
  assert.equal((await store.get(p.id)).layers[0].x, 31);
});

test("animated media options accept WebP/WebM and validate WebP compression levels", async () => {
  const { operations } = await import("../server/core");
  const { p } = await fixture();
  for (const format of ["webp", "webm"])
    assert.equal(
      operations.export.parse({ projectId: p.id, format }).format,
      format,
    );
  for (const compressionLevel of [0, 4, 6])
    assert.equal(
      operations.export.parse({
        projectId: p.id,
        format: "webp",
        compressionLevel,
      }).compressionLevel,
      compressionLevel,
    );
  for (const compressionLevel of [-1, 7, 1.5])
    assert.throws(() =>
      operations.export.parse({
        projectId: p.id,
        format: "webp",
        compressionLevel,
      }),
    );
});

// 0.6: perceptual preprocessing, soft matte and compact transport regressions.
test("CIEDE2000 matches published reference pair and neutral RGB conversion", async () => {
  const { deltaE00, rgbLab } = await import("../server/chroma");
  assert.ok(
    Math.abs(deltaE00([50, 2.6772, -79.7751], [50, 0, -82.7485]) - 2.0425) <
      0.0001,
  );
  assert.ok(Math.abs(rgbLab([255, 255, 255])[0] - 100) < 0.001);
});
test("explicit chroma removes enclosed counters, preserves existing alpha and despills fractional edges", async () => {
  const { chromaMatte } = await import("../server/matte");
  const data = Buffer.alloc(9 * 9 * 4);
  for (let i = 0; i < 81; i++) data.set([191, 86, 165, 255], i * 4);
  for (let y = 2; y < 7; y++)
    for (let x = 2; x < 7; x++) data.set([10, 30, 230, 255], (y * 9 + x) * 4);
  data.set([191, 86, 165, 255], (4 * 9 + 4) * 4);
  data.set([100, 58, 198, 128], (4 * 9 + 2) * 4);
  const result = chromaMatte(
    Buffer.from(data),
    9,
    9,
    [{ x: 0, y: 0, width: 9, height: 9 }],
    36,
    12,
    {
      backgroundColor: "#BF56A5",
      metric: "rgb",
      innerThreshold: 5,
      outerThreshold: 160,
      smoothRadius: 0,
    },
  );
  assert.equal(result[(4 * 9 + 4) * 4 + 3], 0);
  assert.equal(result[(3 * 9 + 3) * 4 + 3], 255);
  const edge = (4 * 9 + 2) * 4;
  assert.ok(result[edge + 3] > 0 && result[edge + 3] < 128);
  assert.ok(result[edge] < data[edge]);
  const connected = chromaMatte(
    Buffer.from(data),
    9,
    9,
    [{ x: 0, y: 0, width: 9, height: 9 }],
    36,
    12,
    { backgroundColor: "#BF56A5", mode: "connected", smoothRadius: 0 },
  );
  assert.equal(connected[(4 * 9 + 4) * 4 + 3], 255);
});
test("preprocess returns padded source coordinates, cropped reference and explicit background preference", async () => {
  const { store, p } = await fixture();
  const asset = p.assets[0];
  const r = await store.execute("prepare_regions", {
    projectId: p.id,
    assetId: asset.id,
    padding: 2,
    backgroundColor: "#BF56A5",
    regions: [{ name: "button", x: 3, y: 4, width: 10, height: 8 }],
  });
  assert.deepEqual(r.regions[0].sourceBounds, {
    x: 1,
    y: 2,
    width: 14,
    height: 12,
  });
  assert.equal(r.regions[0].background.color, "#BF56A5");
  assert.equal(r.regions[0].background.userOverride, true);
  assert.equal(r.regions[0].reference.width, 14);
  assert.equal((await store.get(p.id)).revision, p.revision);
});
test("batch edits commit once, rollback on invalid trajectories and ignore invisible pose in review hash", async () => {
  const { store, p } = await fixture();
  const invisible = layerSchema.parse({
    ...p.layers[0],
    id: "invisible",
    opacity: 0,
  });
  const same = structuredClone(p);
  same.layers.push(invisible);
  assert.equal(visualHash(same), visualHash(p));
  invisible.x += 12;
  assert.equal(visualHash(same), visualHash(p));
  invisible.opacity = 1;
  assert.notEqual(visualHash(same), visualHash(p));
  const r = await store.execute("batch_layers", {
    projectId: p.id,
    expectedRevision: p.revision,
    add: [{ ...p.layers[0], name: "coin", opacity: 0 }],
    update: [{ layerId: p.layers[0].id, patch: { name: "renamed" } }],
  });
  assert.equal(r.project.revision, p.revision + 1);
  assert.equal(r.createdLayerIds.length, 1);
  const before = await store.get(p.id);
  await assert.rejects(() =>
    store.execute("batch_layers", {
      projectId: p.id,
      update: [{ layerId: p.layers[0].id, patch: { x: 9999 } }],
    }),
  );
  assert.deepEqual(await store.get(p.id), before);
  await assert.rejects(() =>
    store.execute("batch_layers", {
      projectId: p.id,
      expectedRevision: p.revision,
    }),
  );
});
test("model responses omit logs, binary and complete timeline by default", async () => {
  const { modelResult } = await import("../server/responses");
  const { p } = await fixture();
  const r = modelResult(
    "update_layer",
    { layerId: p.layers[0].id },
    {
      project: p,
      debugLogs: [{ big: "x".repeat(20000) }],
      image_url: "data:image/png;base64,ABC",
    },
  );
  assert.equal(r.debugLogs, undefined);
  assert.equal(r.image_url, undefined);
  assert.equal(r.project.assets, undefined);
  assert.equal(r.project.layers, undefined);
  assert.equal(r.layer.id, p.layers[0].id);
  const full = modelResult(
    "get",
    { detail: "full" },
    { project: p, debugLogs: [] },
  );
  assert.equal(full.project.layers.length, 1);
  assert.equal(full.debugLogs, undefined);
});
test("process_layer keys native pixels, removes counter and returns original region placement", async () => {
  const { store, p } = await fixture();
  const source = path.join(store.root, "generated.png");
  await sharp({
    create: { width: 200, height: 160, channels: 4, background: "#BF56A5" },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="200" height="160"><path d="M58 68H82V92H58Z M66 76V84H74V76Z" fill="blue" fill-rule="evenodd"/></svg>',
        ),
      },
    ])
    .png()
    .toFile(source);
  const { asset: reference } = await store.execute("import_image", {
    projectId: p.id,
    path: source,
    name: "reference",
    reference: true,
  });
  const prepared = await store.execute("prepare_regions", {
    projectId: p.id,
    assetId: reference.id,
    backgroundColor: "#BF56A5",
    regions: [{ name: "amount", x: 50, y: 60, width: 40, height: 40 }],
  });
  const r = await store.execute("process_layer", {
    preparationId: prepared.regions[0].preparationId,
    projectId: p.id,
    path: source,
    name: "amount",
    backgroundColor: "#BF56A5",
    smoothRadius: 0,
  });
  assert.equal(r.nativeAsset.width, 200);
  assert.deepEqual(r.placement, { x: 58, y: 68, width: 24, height: 24 });
  const pixels = await sharp(r.asset.path).ensureAlpha().raw().toBuffer();
  assert.equal(pixels[(12 * 24 + 12) * 4 + 3], 0);
  assert.equal(r.pendingLayer.x, 58);
});

test("successful review rounds do not exhaust later legitimate edits", async () => {
  const { store, p } = await fixture();
  for (let i = 0; i < 5; i++) {
    await store.execute("update_layer", {
      projectId: p.id,
      layerId: p.layers[0].id,
      patch: { x: 30 + i },
    });
    const shot = await store.execute("snapshot", { projectId: p.id });
    const r = await store.execute("review", {
      projectId: p.id,
      score: 0.9,
      notes: "checked actual composition",
      snapshotHash: shot.snapshotHash,
    });
    assert.equal(r.project.stage, "animate");
  }
});
test("automatic chroma candidate stays in moderate gamut and reports perceptual separation", async () => {
  const { suggestBackground } = await import("../server/chroma");
  const { p } = await fixture();
  const r = await suggestBackground(p.assets[0].path);
  const rgb = [1, 3, 5].map((i) => parseInt(r.color.slice(i, i + 2), 16)),
    v = Math.max(...rgb),
    sat = (v - Math.min(...rgb)) / v;
  assert.ok(v <= 204 && v >= 114);
  assert.ok(sat === 0 || (sat >= 0.29 && sat <= 0.71));
  assert.ok(r.minDeltaE > 0);
  assert.equal(r.alternatives?.length, 3);
});

test("full-canvas preparation stages all layers then commits them together with visual origins", async () => {
  const { store, p } = await fixture();
  const file = path.join(store.root, "full-reference.png");
  await sharp({
    create: { width: 200, height: 160, channels: 4, background: "#BF56A5" },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="200" height="160"><rect x="50" y="60" width="30" height="25" fill="blue"/></svg>',
        ),
      },
    ])
    .png()
    .toFile(file);
  const { asset } = await store.execute("import_image", {
    projectId: p.id,
    path: file,
    name: "ref",
    reference: true,
  });
  const prepared = await store.execute("prepare_regions", {
    projectId: p.id,
    assetId: asset.id,
    backgroundColor: "#BF56A5",
    regions: [
      { name: "first", x: 50, y: 60, width: 30, height: 25 },
      { name: "second", x: 50, y: 60, width: 30, height: 25 },
    ],
  });
  const plan = prepared.regions[0];
  assert.equal(plan.generation.transparentBackground, false);
  assert.equal(
    plan.suggestedNativeSize.width / plan.suggestedNativeSize.height,
    200 / 160,
  );
  assert.deepEqual(plan.generationCanvas, { width: 200, height: 160 });
  const args = {
    projectId: p.id,
    path: file,
    name: "first",
    preparationId: plan.preparationId,
  };
  await assert.rejects(
    () =>
      store.execute("process_layer", { ...args, backgroundColor: "#00FF00" }),
    /MCP/,
  );
  const badRatio = path.join(store.root, "bad-ratio.png");
  await sharp(file).resize(200, 200).toFile(badRatio);
  const adapted = await store.execute("process_layer", {
    ...args,
    path: badRatio,
  });
  assert.equal(adapted.geometryAdjusted, true);
  assert.ok(adapted.pendingLayer);
  assert.equal(adapted.nativeAsset.width, 200);
  const transparent = path.join(store.root, "transparent.png");
  await sharp({
    create: {
      width: 200,
      height: 160,
      channels: 4,
      background: { r: 0, g: 0, b: 255, alpha: 0 },
    },
  })
    .png()
    .toFile(transparent);
  await assert.rejects(
    () => store.execute("process_layer", { ...args, path: transparent }),
    /纯色不透明/,
  );
  const wrongBg = path.join(store.root, "wrong-bg.png");
  await sharp({
    create: { width: 200, height: 160, channels: 4, background: "#00FF00" },
  })
    .png()
    .toFile(wrongBg);
  await assert.rejects(
    () => store.execute("process_layer", { ...args, path: wrongBg }),
    /边缘/,
  );
  const before = (await store.get(p.id)).layers.length;
  const first = await store.execute("process_layer", args);
  const other = new Store(store.root, store.render, store.jobs);
  assert.equal(
    (await other.execute("current", {})).project.layers.length,
    before,
  );
  const second = await store.execute("process_layer", {
    ...args,
    name: "second",
    preparationId: prepared.regions[1].preparationId,
  });
  assert.equal(
    (await other.execute("current", {})).project.layers.length,
    before,
  );
  const committed = await store.execute("batch_layers", {
    projectId: p.id,
    add: [first.pendingLayer, second.pendingLayer],
  });
  assert.equal(
    (await other.execute("current", {})).project.layers.length,
    before + 2,
  );
  assert.equal(committed.createdLayerIds.length, 2);
  assert.equal(committed.project.frame, 0);
  assert.equal(committed.project.playing, false);
  for (const l of committed.project.layers.slice(-2))
    assert.equal(l.transformOrigin, "visual-center");
});

test("alpha-weighted visual center excludes transparent padding and stays fixed under scale/rotation", async () => {
  const { makeAsset } = await import("../server/images");
  const { transformGeometry } = await import("../src/model");
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-pivot-"));
  const data = Buffer.alloc(40 * 20 * 4);
  for (let y = 2; y < 18; y++)
    for (let x = 2; x < 12; x++) data.set([20, 50, 230, 255], (y * 40 + x) * 4);
  const asset = await makeAsset(
    await sharp(data, { raw: { width: 40, height: 20, channels: 4 } })
      .png()
      .toBuffer(),
    "asymmetric",
    root,
  );
  assert.ok(Math.abs(asset.visualCenter!.x - 0.175) < 1e-7);
  assert.ok(Math.abs(asset.visualCenter!.y - 0.5) < 1e-7);
  const l = layerSchema.parse({
    id: "visual",
    name: "visual",
    assetId: asset.id,
    x: 50,
    y: 60,
    width: 40,
    height: 20,
    transformOrigin: "visual-center",
    pivotX: asset.visualCenter!.x,
    pivotY: 0.5,
  });
  const start = transformGeometry(l, poseAt(l, 0));
  for (const scale of [0.6, 1, 1.8])
    for (const rotation of [0, 45, 90, 180]) {
      const pose = { ...poseAt(l, 0), scaleX: scale, scaleY: scale, rotation },
        g = transformGeometry(l, pose),
        b = bounds(l, pose);
      assert.equal(g.anchorX, start.anchorX);
      assert.equal(g.anchorY, start.anchorY);
      assert.ok(Math.abs(b.x + b.width / 2 - g.centerX) < 1e-7);
      assert.ok(Math.abs(b.y + b.height / 2 - g.centerY) < 1e-7);
    }
});
test("rendered visual mass remains centered when scaling and rotating a padded asset", async () => {
  const { renderFrame } = await import("../server/frame");
  const { store, p } = await fixture();
  const file = path.join(store.root, "padded.png");
  await sharp({
    create: {
      width: 40,
      height: 20,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="40" height="20"><rect x="2" y="2" width="10" height="16" fill="blue"/></svg>',
        ),
      },
    ])
    .png()
    .toFile(file);
  const { asset } = await store.execute("import_image", {
    projectId: p.id,
    path: file,
    name: "padded",
  });
  const added = await store.execute("add_layer", {
    projectId: p.id,
    layer: {
      name: "padded",
      assetId: asset.id,
      x: 80,
      y: 60,
      width: 40,
      height: 20,
    },
  });
  const l = added.project.layers.at(-1);
  assert.equal(l.transformOrigin, "visual-center");
  assert.ok(Math.abs(l.pivotX - 0.175) < 1e-7);
  const project = structuredClone(added.project);
  project.layers = [l];
  for (const [scale, rotation] of [
    [1, 0],
    [1.5, 0],
    [1.5, 90],
    [0.75, 180],
  ]) {
    l.scaleX = l.scaleY = scale;
    l.rotation = rotation;
    project.layers = [l];
    const raw = await sharp(await renderFrame(project, 0))
      .ensureAlpha()
      .raw()
      .toBuffer();
    let m = 0,
      xs = 0,
      ys = 0;
    for (let y = 0; y < project.height; y++)
      for (let x = 0; x < project.width; x++) {
        const a = raw[(y * project.width + x) * 4 + 3];
        m += a;
        xs += (x + 0.5) * a;
        ys += (y + 0.5) * a;
      }
    assert.ok(
      Math.abs(xs / m - 87) < 1.2,
      `x pivot drift at scale ${scale}, rotation ${rotation}: ${xs / m}`,
    );
    assert.ok(Math.abs(ys / m - 70) < 1.2, `y pivot drift: ${ys / m}`);
  }
});

test("one separated atlas becomes independent staged layers with original targets and z order", async () => {
  const { store, p } = await fixture(),
    source = path.join(store.root, "atlas-small-wide.png");
  const prepared = await store.execute("prepare_regions", {
    projectId: p.id,
    assetId: p.assets[0].id,
    combine: true,
    backgroundColor: "#BF56A5",
    padding: 0,
    regions: [
      { name: "left", x: 0, y: 0, width: 8, height: 8 },
      { name: "right", x: 10, y: 10, width: 8, height: 8 },
    ],
  });
  assert.ok(prepared.atlas.preparationId);
  assert.equal(prepared.atlas.regions.length, 2);
  assert.equal(prepared.atlas.background.color, "#BF56A5");
  await sharp({
    create: { width: 100, height: 50, channels: 4, background: "#BF56A5" },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="100" height="50"><rect x="10" y="10" width="20" height="20" fill="blue"/><rect x="70" y="10" width="20" height="20" fill="red"/></svg>',
        ),
      },
    ])
    .png()
    .toFile(source);
  const args = {
    projectId: p.id,
    path: source,
    name: "atlas",
    preparationId: prepared.atlas.preparationId,
    parts: [
      {
        name: "left",
        box: { x: 8, y: 8, width: 24, height: 24 },
        target: { x: 20, y: 40, width: 24, height: 24 },
        z: 1,
      },
      {
        name: "right",
        box: { x: 68, y: 8, width: 24, height: 24 },
        target: { x: 140, y: 40, width: 24, height: 24 },
        z: 7,
      },
    ],
  };
  const r = await store.execute("process_layer", args);
  assert.equal(r.pendingLayers.length, 2);
  assert.equal(r.assets.length, 2);
  assert.equal((await store.get(p.id)).layers.length, p.layers.length);
  assert.deepEqual(
    r.pendingLayers.map((l: any) => [l.name, l.x, l.y, l.width, l.height, l.z]),
    [
      ["left", 22, 42, 20, 20, 1],
      ["right", 142, 42, 20, 20, 7],
    ],
  );
  for (const l of r.pendingLayers)
    assert.equal(l.transformOrigin, "visual-center");
  assert.notEqual(r.assets[0].id, r.assets[1].id);
  const raw = await sharp(r.assets[0].path).ensureAlpha().raw().toBuffer();
  assert.equal(raw[2], 255);
  assert.equal(raw[0], 0);
  const added = await store.execute("batch_layers", {
    projectId: p.id,
    add: r.pendingLayers,
  });
  assert.equal(added.createdLayerIds.length, 2);
  const before = await store.get(p.id);
  await assert.rejects(
    () =>
      store.execute("process_layer", {
        ...args,
        parts: [args.parts[0], { ...args.parts[1], box: args.parts[0].box }],
      }),
    /重叠/,
  );
  assert.deepEqual(await store.get(p.id), before);
});

test("shape masks persist, change review hash, clear and reject invalid or locked targets atomically", async () => {
  const { store, p } = await fixture(),
    layerId = p.layers[0].id,
    before = visualHash(p);
  const mask = {
    space: "canvas",
    shape: {
      type: "polygon",
      points: [
        { x: 20, y: 30 },
        { x: 60, y: 30 },
        { x: 55, y: 70 },
        { x: 35, y: 55 },
        { x: 20, y: 70 },
      ],
    },
  };
  const r = await store.execute("set_mask", {
    projectId: p.id,
    layerIds: [layerId],
    mask,
  });
  assert.notEqual(visualHash(r.project), before);
  assert.equal(r.project.layers[0].shapeMask.shape.points.length, 5);
  assert.equal((await store.get(p.id)).layers[0].shapeMask?.space, "canvas");
  const saved = await store.get(p.id);
  await assert.rejects(() =>
    store.execute("set_mask", {
      projectId: p.id,
      layerIds: [layerId, "11111111-1111-4111-8111-111111111111"],
      mask: null,
    }),
  );
  assert.deepEqual(await store.get(p.id), saved);
  await assert.rejects(() =>
    store.execute("set_mask", {
      projectId: p.id,
      layerIds: [layerId],
      mask: {
        shape: {
          type: "polygon",
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
            { x: 2, y: 2 },
          ],
        },
      },
    }),
  );
  const cleared = await store.execute("set_mask", {
    projectId: p.id,
    layerIds: [layerId],
    mask: null,
  });
  assert.equal(cleared.project.layers[0].shapeMask, null);
});
test("CPU masks support primitives, irregular polygon, inverse, local transforms and sweep clipping", async () => {
  const { renderFrame } = await import("../server/frame"),
    { maskContains, shapeMaskSchema } = await import("../src/masks");
  const cases = [
    { type: "rect", x: 5, y: 5, width: 20, height: 20 },
    { type: "roundedRect", x: 5, y: 5, width: 20, height: 20, radius: 5 },
    { type: "circle", x: 15, y: 15, radius: 10 },
    { type: "ellipse", x: 15, y: 15, radiusX: 10, radiusY: 7 },
    {
      type: "polygon",
      points: [
        { x: 5, y: 5 },
        { x: 25, y: 5 },
        { x: 20, y: 25 },
        { x: 15, y: 18 },
        { x: 5, y: 25 },
      ],
    },
  ];
  for (const shape of cases) {
    const m = shapeMaskSchema.parse({ shape });
    assert.equal(maskContains(m, 15, 12), true);
    assert.equal(maskContains(m, 0, 0), false);
  }
  const { p } = await fixture();
  p.layers[0].shapeMask = shapeMaskSchema.parse({
    shape: { type: "rect", x: 30, y: 40, width: 10, height: 20 },
  });
  p.layers[0].effect = {
    type: "sweep",
    color: "#ffffff",
    width: 0.8,
    angle: 0,
    opacity: 1,
    startFrame: 0,
    endFrame: 71,
    direction: "forward",
  };
  let raw = await sharp(await renderFrame(p, 35))
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert.equal(raw[(45 * 200 + 45) * 4 + 3], 0);
  assert.equal(raw[(45 * 200 + 35) * 4 + 3], 255);
  p.layers[0].shapeMask.inverse = true;
  raw = await sharp(await renderFrame(p, 35))
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert.equal(raw[(45 * 200 + 35) * 4 + 3], 0);
  assert.equal(raw[(45 * 200 + 45) * 4 + 3], 255);
  p.layers[0].shapeMask = shapeMaskSchema.parse({
    space: "layer",
    shape: { type: "rect", x: 0, y: 0, width: 10, height: 20 },
  });
  p.layers[0].rotation = 180;
  raw = await sharp(await renderFrame(p, 35))
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert.equal(raw[(45 * 200 + 35) * 4 + 3], 0);
  assert.equal(raw[(45 * 200 + 45) * 4 + 3], 255);
});

test("GIF selection retains original for inflated, invalid, equal or altered-timing output", async () => {
  const { selectSmallerGif, gifInfo } = await import("../server/gif-selection");
  const png = await sharp({
    create: { width: 16, height: 16, channels: 4, background: "red" },
  })
    .png()
    .toBuffer();
  const raw = await (
    await import("../server/magick")
  ).encodeGif([png, png], 10);
  const padded = Buffer.concat([
    raw.subarray(0, -1),
    Buffer.from([0x21, 0xfe, 200]),
    Buffer.alloc(200, 65),
    Buffer.from([0, 0x3b]),
  ]);
  assert.equal(selectSmallerGif(raw, padded).source, "original");
  assert.deepEqual(selectSmallerGif(raw, padded).bytes, raw);
  assert.equal(selectSmallerGif(raw, raw).source, "original");
  assert.equal(
    selectSmallerGif(raw, new Uint8Array([1, 2, 3])).source,
    "original",
  );
  const altered = await (
    await import("../server/magick")
  ).encodeGif([png, png], 5);
  assert.equal(selectSmallerGif(raw, altered).reason, "播放元数据变化");
  assert.equal(gifInfo(raw).duration, 20);
  const chosen = selectSmallerGif(padded, raw);
  assert.equal(chosen.source, "optimized");
  assert.equal(chosen.bytes.length, raw.length);
});
test("gifsicle duplicate frame merge does not force O1 and optimization errors preserve original GIF", async () => {
  const { compressGif } = await import("../server/wasm-gif"),
    { gifInfo } = await import("../server/gif-selection"),
    { encodeGif } = await import("../server/magick");
  const a = await sharp({
      create: { width: 24, height: 24, channels: 4, background: "red" },
    })
      .png()
      .toBuffer(),
    b = await sharp({
      create: { width: 24, height: 24, channels: 4, background: "blue" },
    })
      .png()
      .toBuffer();
  const original = await encodeGif([a, a, a, b, b, b], 12),
    events: any[] = [];
  const selected = await compressGif(original, {
    lossy: 30,
    expectedPages: 999,
    onLog: (event, details) => events.push({ event, details }),
  });
  assert.ok(selected.length <= original.length);
  const input = gifInfo(original),
    out = gifInfo(selected);
  assert.equal(out.duration, input.duration);
  assert.equal(out.loop, input.loop);
  assert.equal(out.width, input.width);
  assert.ok(
    !events.some(
      (e) => e.event === "WASM 命令" && e.details.args.includes("-O1"),
    ),
    "expectedPages alone must never force O1",
  );
  assert.ok(events.some((e) => e.event === "GIF 优化选择"));
  const fallback = await compressGif(original, {
    distDir: path.join(os.tmpdir(), "nonexistent-gifsicle-unit-fixture"),
    onLog: () => {},
  });
  assert.deepEqual(Buffer.from(fallback), Buffer.from(original));
});


test("MCP animation schemas use homogeneous array items for host discovery", () => {
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const value = node as Record<string, unknown>;
    assert.equal(Array.isArray(value.items), false, "tuple items are unsupported by model tool conversion");
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  };
  for (const schema of Object.values(operations)) visit(toJsonSchemaCompat(schema));
  assert.deepEqual(easingSchema.parse([0.25, -0.5, 0.75, 1.5]), [0.25, -0.5, 0.75, 1.5]);
  for (const invalid of [[0, 1, 1], [0, 1, 1, 1, 1], [-0.1, 0, 1, 1], [0, 0, 1.1, 1]]) {
    assert.equal(easingSchema.safeParse(invalid).success, false);
  }
});
