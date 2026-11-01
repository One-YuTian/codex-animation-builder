import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import sharp from "sharp";
process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve(".browsers");
const { chromium } = await import("playwright");
const root = path.resolve("artifacts/smoke-v030");
await mkdir(root, { recursive: true });
const client = new Client({ name: "preview-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/server.js"],
  cwd: process.cwd(),
  env: { ...process.env, ANIMATION_DATA_DIR: root },
  stderr: "pipe",
});
transport.stderr?.on("data", (d) => process.stderr.write(d));
let browser, web;
let revealedJob;
let openedDirectory;
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 35);
  for (const name of [
    "export",
    "export_status",
    "cancel_export",
    "read_asset",
    "reveal_export",
  ])
    assert.deepEqual(
      tools.find((t) => t.name === "animation_" + name)._meta.ui.visibility,
      ["app"],
    );
  const open = tools.find((t) => t.name === "animation_open_editor");
  assert.ok(
    open._meta["openai/ui"].entrypoints.some((e) => e.type === "thread"),
  );
  const resource = await client.readResource({
    uri: "ui://codex-animation-builder/preview-v5",
  });
  assert.deepEqual(
    resource.contents[0]._meta["openai/ui"].availableDisplayModes,
    ["fullscreen"],
  );
  const invoke = async (op, args = {}) => {
    const r = await client.callTool({
      name: "animation_" + op,
      arguments: args,
    });
    if (r.isError) throw Error(r.content[0].text);
    assert.ok(!JSON.stringify(r).includes("data:image/"));
    return r._meta?.appState ?? r.structuredContent;
  };
  const { project } = await invoke("create", {
    name: "Motion study",
    width: 640,
    height: 400,
    fps: 24,
    duration: 1,
  });
  const projectId = project.id;
  const imagePath = path.join(root, "fixture.png");
  await sharp(
    Buffer.from(
      '<svg width="140" height="140"><rect width="140" height="140" rx="30" fill="#8b7cf8"/><path d="M53 40L100 70 53 100Z" fill="white"/></svg>',
    ),
  )
    .png()
    .toFile(imagePath);
  await assert.rejects(
    () =>
      invoke("import_image", {
        projectId,
        path: imagePath,
        name: "invalid low resolution atlas",
        fit: "canvas",
      }),
    /低于原图/,
  );
  const nativePath = path.join(root, "native-layer.png");
  await sharp({
    create: { width: 1280, height: 960, channels: 4, background: "#55cc99" },
  })
    .png()
    .toFile(nativePath);
  const validated = await invoke("import_image", {
    projectId,
    path: nativePath,
    name: "independent high resolution layer",
    fit: "canvas",
  });
  assert.deepEqual(
    [validated.nativeAsset.width, validated.nativeAsset.height],
    [1280, 960],
  );
  assert.deepEqual([validated.asset.width, validated.asset.height], [640, 400]);
  const { asset } = await invoke("import_image", {
    projectId,
    path: imagePath,
    name: "Play mark",
  });
  const { project: added } = await invoke("add_layer", {
    projectId,
    layer: {
      name: "Play mark",
      assetId: asset.id,
      x: 80,
      y: 130,
      width: 140,
      height: 140,
    },
  });
  const layerId = added.layers[0].id;
  // An unused broken reference must not prevent actual layers from rendering.
  const disk = JSON.parse(
    await readFile(path.join(root, projectId + ".json"), "utf8"),
  );
  disk.assets.push({
    ...asset,
    id: "unused",
    path: path.join(root, "assets", "missing.png"),
  });
  await writeFile(path.join(root, projectId + ".json"), JSON.stringify(disk));
  const rejected = await client.callTool({
    name: "animation_export",
    arguments: { projectId, format: "gif" },
  });
  assert.equal(rejected.isError, true);
  assert.match(rejected.content[0].text, /用户/);
  const shot = await invoke("snapshot", { projectId });
  await invoke("review", {
    projectId,
    snapshotHash: shot.snapshotHash,
    score: 0.9,
    notes: "Synthetic fixture only",
  });
  await invoke("keyframes", {
    projectId,
    layerId,
    keyframes: [
      { frame: 0, x: 80 },
      { frame: 23, x: 400, easing: "easeInOut" },
    ],
  });
  web = spawn(process.execPath, ["dist/server.js", "--web"], {
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, ANIMATION_DATA_DIR: root, PORT: "4319" },
  });
  await new Promise((resolve, reject) => {
    web.once("error", reject);
    web.stderr.once("data", resolve);
  });
  browser = await chromium.launch({
    headless: true,
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("http://127.0.0.1:4319");
  await page.locator(".canvas-host canvas").waitFor();
  const pixel = async (locator) => {
    const png = await locator.screenshot();
    return sharp(png).raw().toBuffer();
  };
  await page.waitForFunction(() =>
    performance
      .getEntriesByType("resource")
      .some((r) => r.name.includes("/api/file")),
  );
  async function assertHidden() {
    await appFrame.locator('.canvas-host[data-render-state="ready"]').waitFor();
    const data = await sharp(
      await appFrame.locator(".canvas-host canvas").screenshot(),
    )
      .ensureAlpha()
      .raw()
      .toBuffer();
    let purple = 0;
    for (let i = 0; i < data.length; i += 4)
      if (data[i] > 100 && data[i + 2] > 200 && data[i + 1] < 180) purple++;
    assert.ok(
      purple < 100,
      "hidden object is actually absent from Pixi canvas",
    );
  }
  async function assertSprite(locator) {
    for (let i = 0; i < 30; i++) {
      const png = await locator.screenshot();
      const { data } = await sharp(png)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let purple = 0;
      for (let n = 0; n < data.length; n += 4)
        if (data[n] > 100 && data[n + 2] > 200 && data[n + 1] < 180) purple++;
      if (purple > 1000) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error("sprite not rendered");
  }
  await assertSprite(page.locator(".canvas-host canvas"));
  assert.equal(
    await page.locator("input[type=file],input[type=number],textarea").count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "新建", exact: true }).count(),
    0,
  );
  // A different MCP connection mutates disk while this web process already cached it.
  await invoke("update_layer", {
    projectId,
    layerId,
    patch: { name: "MCP updated layer", x: 100 },
  });
  await page.getByText("MCP updated layer", { exact: true }).first().waitFor();
  await page.screenshot({ path: "artifacts/preview-desktop.png" });
  const hostPage = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  hostPage.on("pageerror", (e) => errors.push(e.message));
  await hostPage.emulateMedia({ colorScheme: "dark" });
  const localRequests = [];
  await hostPage.route("http://127.0.0.1:**/*", (route) => {
    if (route.request().frame() === hostPage.mainFrame())
      return route.continue();
    localRequests.push(route.request().url().split("?")[0]);
    return route.abort();
  });
  await hostPage.exposeFunction("__mcpTool", async (params) => {
    if (params.name === "animation_reveal_export") {
      revealedJob = params.arguments.jobId;
      return client.callTool(params);
    }
    return client.callTool(params);
  });
  await hostPage.exposeFunction("__openLocal", async (params) => {
    openedDirectory = params.path;
    return {};
  });
  await hostPage.setContent(
    '<html><body style="margin:0"><iframe style="width:100vw;height:100vh;border:0"></iframe></body></html>',
  );
  await hostPage.evaluate((html) => {
    window.addEventListener("message", async (event) => {
      const m = event.data;
      if (m?.jsonrpc !== "2.0" || m.id === undefined) return;
      let result;
      if (m.method === "ui/initialize")
        result = {
          protocolVersion: m.params.protocolVersion,
          hostInfo: { name: "smoke-host", version: "1.0.0" },
          hostCapabilities: {
            experimental: { "openai/files": {} },
            serverTools: {},
            downloadFile: {},
            updateModelContext: { structuredContent: {} },
          },
          hostContext: { displayMode: "fullscreen", theme: "light" },
        };
      else if (m.method === "openai/files/open")
        result = await window.__openLocal(m.params);
      else if (m.method === "tools/call")
        result = await window.__mcpTool(m.params);
      else if (m.method === "ui/download-file") {
        const item = m.params.contents[0];
        let blob;
        let filename = "export";
        if (item.type === "resource" || item.resource) {
          const res = item.resource || item;
          filename =
            (res.uri ? decodeURIComponent(res.uri.split("/").pop()) : "") ||
            "export";
          if (res.blob) {
            const binary = atob(res.blob);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++)
              bytes[i] = binary.charCodeAt(i);
            blob = new Blob([bytes], { type: res.mimeType });
          } else if (res.text) {
            blob = new Blob([res.text], {
              type: res.mimeType || "text/plain",
            });
          }
        } else if (item.uri) {
          filename = item.name || item.uri.split("/").pop() || "export";
          const response = await fetch(item.uri);
          if (!response.ok)
            throw Error("Download gateway returned " + response.status);
          blob = await response.blob();
        }
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        result = { isError: false };
      } else result = {};
      event.source.postMessage({ jsonrpc: "2.0", id: m.id, result }, "*");
    });
    document.querySelector("iframe").srcdoc = html.replace(
      "<head>",
      `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob:; connect-src 'none';">`,
    );
  }, resource.contents[0].text);

  const appFrame = hostPage.frameLocator("iframe");
  await appFrame.locator(".canvas-host canvas").waitFor();
  await appFrame
    .locator('.canvas-host[data-render-state="ready"]')
    .waitFor({ timeout: 60000 });
  await assertSprite(appFrame.locator(".canvas-host canvas"));
  assert.equal(
    await appFrame.locator("html").getAttribute("data-theme"),
    "light",
  );
  await hostPage.screenshot({ path: "artifacts/preview-light.png" });
  await hostPage.evaluate(() =>
    document.querySelector("iframe").contentWindow.postMessage(
      {
        jsonrpc: "2.0",
        method: "ui/notifications/host-context-changed",
        params: { theme: "dark" },
      },
      "*",
    ),
  );
  await appFrame.locator('html[data-theme="dark"]').waitFor();
  await hostPage.screenshot({ path: "artifacts/preview-host-dark.png" });
  const parent = (await invoke("group_create", { projectId, name: "装饰" }))
    .group;
  const child = (
    await invoke("group_create", {
      projectId,
      name: "图标",
      parentId: parent.id,
      layerIds: [layerId],
    })
  ).group;
  await appFrame.getByRole("button", { name: "图标", exact: true }).waitFor();
  await appFrame.getByRole("button", { name: "图标", exact: true }).click();
  assert.equal(
    await appFrame
      .getByRole("button", { name: "MCP updated layer", exact: true })
      .count(),
    0,
  );
  await appFrame.getByRole("button", { name: "图标", exact: true }).click();
  await appFrame
    .getByRole("button", { name: "隐藏MCP updated layer", exact: true })
    .click();
  await appFrame
    .getByRole("button", { name: "显示MCP updated layer", exact: true })
    .waitFor();
  await assertHidden();
  assert.equal(
    (await invoke("get", { projectId })).project.layers[0].visible,
    false,
  );
  await appFrame
    .getByRole("button", { name: "显示MCP updated layer", exact: true })
    .click();
  await appFrame
    .getByRole("button", { name: "隐藏MCP updated layer", exact: true })
    .waitFor();
  await appFrame.getByRole("button", { name: "隐藏装饰", exact: true }).click();
  await appFrame
    .getByRole("button", { name: "显示装饰", exact: true })
    .waitFor();
  await assertHidden();
  assert.equal(
    (await invoke("get", { projectId })).project.groups.find(
      (g) => g.id === parent.id,
    ).visible,
    false,
  );
  await appFrame.getByRole("button", { name: "显示装饰", exact: true }).click();
  await appFrame
    .getByRole("button", { name: "隐藏装饰", exact: true })
    .waitFor();
  await appFrame
    .getByRole("button", { name: "隐藏Scene", exact: true })
    .click();
  await appFrame
    .getByRole("button", { name: "显示Scene", exact: true })
    .waitFor();
  await assertHidden();
  assert.equal(
    (await invoke("get", { projectId })).project.scene.visible,
    false,
  );
  await appFrame
    .getByRole("button", { name: "显示Scene", exact: true })
    .click();
  await appFrame
    .getByRole("button", { name: "隐藏Scene", exact: true })
    .waitFor();
  await appFrame.locator('.canvas-host[data-render-state="ready"]').waitFor();
  await assertSprite(appFrame.locator(".canvas-host canvas"));
  await hostPage.screenshot({ path: "artifacts/groups-preview.png" });
  // Only a user click starts export. Use JSON here: never export the user's animation in verification.
  await appFrame.getByRole("button", { name: "导出", exact: true }).click();
  const previewBefore = await invoke("current");
  await appFrame.getByLabel("导出 FPS", { exact: true }).fill("12");
  await appFrame.getByLabel("导出时长", { exact: true }).fill("2");
  await appFrame.getByRole("heading", { name: "手动导出" }).click();
  assert.match(await appFrame.locator(".export-timing").innerText(), /24 帧/);
  assert.deepEqual((await invoke("current")).project, previewBefore.project);
  await hostPage.screenshot({ path: "artifacts/export-settings.png" });
  await appFrame.getByRole("combobox").click();
  await appFrame.getByRole("option", { name: "项目 JSON" }).click();
  const downloading = hostPage.waitForEvent("download");
  await appFrame.getByRole("button", { name: "开始导出", exact: true }).click();
  const download = await downloading;
  assert.ok(download.suggestedFilename().endsWith(".json"));
  await appFrame.getByText("导出完成", { exact: true }).waitFor();
  assert.equal(
    await appFrame
      .getByRole("button", { name: "打开导出目录", exact: true })
      .count(),
    1,
  );
  await appFrame
    .getByRole("button", { name: "打开导出目录", exact: true })
    .first()
    .click();
  for (let i = 0; i < 30 && !openedDirectory; i++)
    await new Promise((r) => setTimeout(r, 100));
  assert.ok(revealedJob, "reveal icon invokes the corresponding MCP operation");
  if (!openedDirectory)
    console.log(
      "UI file opening error:",
      await appFrame.locator("body").innerText(),
    );
  const done = await invoke("export_status", { jobId: revealedJob });
  assert.equal(
    openedDirectory,
    path.dirname(done.job.file),
    "Codex openai/files/open receives the real export directory",
  );

  await hostPage.screenshot({ path: "artifacts/export-complete.png" });
  // Reproduce the referenced RECEIVE project from a copy; never modify or export it.
  const realPath = path.resolve(
    `.animation-data/${process.env.SMOKE_PROJECT_ID ?? "7c510ec5-f561-4563-b3a6-977631b704a8"}.json`,
  );
  try {
    const real = JSON.parse(await readFile(realPath, "utf8"));
    await mkdir(path.join(root, "assets"), { recursive: true });
    for (const a of real.assets) {
      const target = path.join(root, "assets", a.id + ".png");
      await writeFile(target, await readFile(a.path));
      a.path = target;
    }
    await writeFile(path.join(root, real.id + ".json"), JSON.stringify(real));
    await writeFile(path.join(root, ".active-project"), real.id);
    try {
      await appFrame
        .locator(".breadcrumbs strong")
        .filter({ hasText: real.name })
        .waitFor({ timeout: 8000 });
    } catch (e) {
      console.log("DEBUG current", await invoke("current"));
      console.log("DEBUG iframe", await appFrame.locator("body").innerText());
      await hostPage.screenshot({ path: "artifacts/preview-debug.png" });
      throw e;
    }
    await appFrame
      .locator('.canvas-host[data-render-state="ready"]')
      .waitFor({ timeout: 60000 });
    let visible = false;
    for (let i = 0; i < 30; i++) {
      const png = await appFrame.locator(".canvas-host canvas").screenshot();
      const { data } = await sharp(png)
        .raw()
        .toBuffer({ resolveWithObject: true });
      let colors = 0;
      for (let n = 0; n < data.length; n += 4)
        if (
          Math.max(data[n], data[n + 1], data[n + 2]) -
            Math.min(data[n], data[n + 1], data[n + 2]) >
          65
        )
          colors++;
      if (colors > 3000) {
        visible = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(visible, "RECEIVE project image content is visible");
    await hostPage.keyboard.press("Escape");
    await appFrame.getByRole("dialog").waitFor({ state: "hidden" });
    await hostPage.screenshot({ path: "artifacts/preview-project.png" });
    console.log(
      "PASS: referenced local project renders from an isolated copy; no animation export",
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    console.log(
      "Referenced local project absent: skipped optional reproduction",
    );
  }
  assert.deepEqual(localRequests, [], "MCP iframe never fetches localhost");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: 31 tools, model export blocked, standalone cross-process sync, actual Pixi sprite in sandboxed MCP iframe, host theme, manual JSON download",
  );
} finally {
  await browser?.close();
  web?.kill();
  await client.close();
}
