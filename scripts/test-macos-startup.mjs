import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm, cp, mkdir, writeFile, realpath } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const data = await mkdtemp(path.join(os.tmpdir(), "animation-mac-"));
const manifest = JSON.parse(
  await (
    await import("node:fs/promises")
  ).readFile("artifacts/beta-macos/mcp.json", "utf8"),
);
const config = manifest.mcpServers["animation-builder"];
assert.equal(config.command, "sh");
// Verify the bootstrap selects the managed executable even with an external override.
const { execFileSync, spawnSync } = await import("node:child_process");
const fixture = await mkdtemp(path.join(os.tmpdir(), "animation managed node 空格 "));
try {
  await mkdir(path.join(fixture, "scripts"));
  await cp("scripts/launch-macos.sh", path.join(fixture, "scripts/launch-macos.sh"));
  await cp("run.mjs", path.join(fixture, "run.mjs"));
  await writeFile(path.join(fixture, "server.js"), "console.log(JSON.stringify({node:process.execPath}));");
  const env = { HOME: os.homedir(), PATH: "/usr/bin:/bin", ANIMATION_NODE_BINARY: "/missing/external-node" };
  const actual = JSON.parse(execFileSync("/bin/sh", [path.join(fixture, "scripts/launch-macos.sh")], { env, encoding: "utf8" }));
  const managed = path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node");
  assert.equal(await realpath(actual.node), await realpath(managed));
  const missing = spawnSync("/bin/sh", [path.join(fixture, "scripts/launch-macos.sh")], { env: { ...env, HOME: fixture }, encoding: "utf8" });
  assert.equal(missing.status, 127);
  assert.equal(missing.stdout, "");
  assert.match(missing.stderr, /Codex managed Node is missing/);
} finally { await rm(fixture, {recursive:true,force:true}); }
const client = new Client({ name: "mac-startup-test", version: "1" });
try {
  await client.connect(
    new StdioClientTransport({
      command: config.command,
      args: config.args.map((arg) =>
        arg.replace("${PLUGIN_ROOT}", path.resolve("artifacts/beta-macos")),
      ),
      cwd: "/tmp",
      env: {
        HOME: os.homedir(),
        PATH: "/usr/bin:/bin",
        ANIMATION_DATA_DIR: data,
      },
    }),
  );
  const tools = (await client.listTools()).tools;
  assert(tools.some((t) => t.name === "animation_open_editor"));
  assert(tools.some((t) => t.name === "animation_create"));
  const opened = await client.callTool({
    name: "animation_open_editor",
    arguments: { reset: true },
  });
  assert(!opened.isError, JSON.stringify(opened));
  const created = await client.callTool({
    name: "animation_create",
    arguments: {
      name: "macOS smoke",
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
  console.log(
    `PASS: minimal macOS PATH, unrelated cwd, ${tools.length} tools, editor, project creation, UI resource`,
  );
} finally {
  await client.close();
  await rm(data, { recursive: true, force: true });
}
