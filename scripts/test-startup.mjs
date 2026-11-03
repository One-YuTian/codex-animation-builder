import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readFile,
  mkdtemp,
  mkdir,
  writeFile,
  cp,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";

const read = async (file) => JSON.parse(await readFile(file, "utf8"));
test("all platforms install the same root Node manifest", async () => {
  const source = await read("mcp.json");
  for (const file of [
    "mcp.windows.json",
    "artifacts/beta/mcp.json",
    "artifacts/beta-windows/mcp.json",
  ])
    assert.deepEqual(await read(file), source);
  const config = source.mcpServers["animation-builder"];
  assert.equal(config.command, "node");
  assert.deepEqual(config.args, ["${PLUGIN_ROOT}/run.mjs"]);
  assert.equal(
    (await read("artifacts/beta/build-manifest.json")).platform,
    "any",
  );
});

test(
  "root package starts MCP and renders the editor without a shell",
  { timeout: 60000 },
  async () => {
    await mkdir("artifacts", { recursive: true });
    const data = await mkdtemp(path.resolve("artifacts/Windows startup 数据 "));
    const root = path.resolve("artifacts/beta");
    const config = (await read(path.join(root, "mcp.json"))).mcpServers[
      "animation-builder"
    ];
    const env = { ...process.env, ANIMATION_DATA_DIR: data };
    delete env.Path;
    delete env.ANIMATION_NODE_BINARY;
    env.PATH = path.dirname(process.execPath);
    const client = new Client({
      name: "windows-startup-regression",
      version: "1",
    });
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args.map((arg) => arg.replaceAll("${PLUGIN_ROOT}", root)),
      cwd: path.dirname(root),
      env,
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk) => (stderr += chunk));
    let browser;
    try {
      await client.connect(transport);
      const tools = (await client.listTools()).tools;
      assert.equal(tools.length, 35);
      for (const name of [
        "animation_open_editor",
        "animation_batch_layers",
        "animation_keyframes",
      ])
        assert(tools.some((tool) => tool.name === name));
      const opened = await client.callTool({
        name: "animation_open_editor",
        arguments: { reset: true },
      });
      assert(!opened.isError, JSON.stringify(opened));
      const created = await client.callTool({
        name: "animation_create",
        arguments: {
          name: "Windows startup smoke",
          width: 64,
          height: 64,
          fps: 12,
          duration: 1,
        },
      });
      assert(!created.isError, JSON.stringify(created));
      const resource = await client.readResource({
        uri: "ui://codex-animation-builder/preview-v5",
      });
      assert(resource.contents[0].text.includes("<html"));
      const origin = opened._meta.runtime.origin;
      const response = await fetch(origin);
      assert.equal(response.status, 200);
      const errors = [];
      browser = await chromium.launch({
        headless: true,
        ...(process.env.ANIMATION_TEST_BROWSER
          ? { executablePath: process.env.ANIMATION_TEST_BROWSER }
          : {}),
      });
      const page = await browser.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(origin);
      await page.getByRole("button", { name: "导出", exact: true }).waitFor();
      await page.screenshot({ path: path.join(data, "editor.png") });
      assert.deepEqual(errors, []);
      console.log(
        "PASS: root package MCP, 35 tools, editor resource and browser UI; " +
          path.join(data, "editor.png"),
      );
    } catch (error) {
      throw new Error(error.message + "\nServer stderr: " + stderr, {
        cause: error,
      });
    } finally {
      await browser?.close();
      await client.close();
    }
  },
);

test("JavaScript launcher selects Codex runtime, honors overrides and propagates exit codes", async () => {
  const fixture = await mkdtemp(path.resolve("artifacts/Node entry 空格 "));
  await cp("run.mjs", path.join(fixture, "run.mjs"));
  await writeFile(
    path.join(fixture, "server.js"),
    "console.log(JSON.stringify({node:process.execPath,data:process.env.ANIMATION_DATA_DIR}));process.exit(Number(process.argv[2]??0));",
  );
  await writeFile(path.join(fixture, "package.json"), '{"type":"module"}');
  const env = { ...process.env };
  delete env.ANIMATION_NODE_BINARY;
  const bundled = path.join(
    os.homedir(),
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin",
    process.platform === "win32" ? "node.exe" : "node",
  );
  const launch = () =>
    JSON.parse(
      execFileSync(process.execPath, [path.join(fixture, "run.mjs")], {
        env,
        encoding: "utf8",
      }),
    );
  const expected = env.CODEX_MCP_NODE_PATH || bundled;
  assert.equal(
    (await realpath(launch().node)).toLowerCase(),
    (await realpath(expected)).toLowerCase(),
  );
  env.ANIMATION_NODE_BINARY = process.execPath;
  assert.equal(await realpath(launch().node), await realpath(process.execPath));
  env.ANIMATION_NODE_BINARY = path.join(fixture, "missing-node");
  assert.equal(
    (await realpath(launch().node)).toLowerCase(),
    (await realpath(expected)).toLowerCase(),
  );
  assert.throws(
    () =>
      execFileSync(process.execPath, [path.join(fixture, "run.mjs"), "23"], {
        env,
      }),
    (error) => error.status === 23,
  );
});
