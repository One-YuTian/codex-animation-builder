// Exercise Codex's plugin parser as well as the direct MCP startup test.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, writeFile, cp, mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const fixture = path.resolve("artifacts/startup-marketplace");
await mkdir(path.join(fixture, ".agents/plugins"), { recursive: true });
const marketplace = path.join(fixture, ".agents/plugins/marketplace.json");
await cp(path.resolve(process.env.ANIMATION_TEST_PACKAGE ?? "artifacts/beta"), path.join(fixture, "plugin"), {
  recursive: true,
});
await writeFile(
  marketplace,
  JSON.stringify({
    name: "animation-startup-test",
    plugins: [
      {
        name: "codex-animation-builder",
        source: { source: "local", path: "./plugin" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity",
      },
    ],
  }),
);
// Install into an isolated Codex profile so the real host exercises the shipped
// plugin without changing the user's installed plugins or configuration.
const profile = await mkdtemp(path.resolve("artifacts/codex-startup-profile-"));
await writeFile(path.join(profile, "config.toml"), "");
const binary =
  process.env.CODEX_BINARY ??
  (process.platform === "win32"
    ? execFileSync("where.exe", ["codex"], { encoding: "utf8" })
        .trim()
        .split(/\r?\n/)[0]
    : "codex");
const hostEnv = {
  ...process.env,
  HOME: process.env.HOME ?? os.homedir(),
  CODEX_HOME: profile,
};
// Model a host with its bundled Node exposed as `node`, without any shell.
delete hostEnv.Path;
hostEnv.PATH = process.env.ANIMATION_TEST_MINIMAL_PATH ? "/usr/bin:/bin" : path.dirname(process.execPath);
delete hostEnv.ANIMATION_NODE_BINARY;
const child = spawn(binary, ["app-server", "--stdio"], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
  env: hostEnv,
});
const pending = new Map();
let id = 0;
let errors = "";
child.stderr.on("data", (chunk) => (errors += chunk));
child.on("error", (error) => {
  for (const entry of pending.values()) entry.reject(error);
});
createInterface({ input: child.stdout }).on("line", (line) => {
  try {
    const message = JSON.parse(line);
    const entry = pending.get(message.id);
    if (entry) {
      clearTimeout(entry.timer);
      pending.delete(message.id);
      message.error
        ? entry.reject(Error(JSON.stringify(message.error)))
        : entry.resolve(message.result);
    }
  } catch {}
});
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(Error("Timed out: " + method + "\n" + errors));
    }, 30000);
    pending.set(requestId, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id: requestId, method, params }) + "\n");
  });
}
try {
  await rpc("initialize", {
    clientInfo: { name: "animation-startup-test", version: "1" },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
  const result = await rpc("plugin/read", {
    marketplacePath: marketplace,
    pluginName: "codex-animation-builder",
  });
  assert(
    result.plugin.mcpServers.includes("animation-builder"),
    JSON.stringify(result.plugin.mcpServers),
  );
  assert.equal(result.plugin.summary.localVersion, "0.7.11");
  console.log(
    "PASS: selected beta package is discovered by Codex, version 0.7.11",
  );
  await rpc("plugin/install", {
    marketplacePath: marketplace,
    pluginName: "codex-animation-builder",
  });
  const inventory = await rpc("mcpServerStatus/list", {
    serverName: "animation-builder",
    detail: "toolsAndAuthOnly",
  });
  const server = inventory.data.find((entry) =>
    Object.values(entry.tools ?? {}).some(
      (tool) => tool.name === "animation_open_editor",
    ),
  );
  assert(server && !server.toolsError, JSON.stringify(inventory));
  assert.equal(Object.keys(server.tools).length, 35);
  console.log(
    "PASS: isolated Codex installation starts selected plugin and discovers all 35 MCP tools",
  );
} finally {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  child.stdin.end();
  child.kill();
}
