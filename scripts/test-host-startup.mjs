// Exercise Codex's plugin parser as well as the direct MCP startup test.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const fixture = path.resolve("artifacts/startup-marketplace");
await mkdir(path.join(fixture, ".agents/plugins"), { recursive: true });
const marketplace = path.join(fixture, ".agents/plugins/marketplace.json");
await cp(path.resolve("artifacts/beta-windows"), path.join(fixture, "plugin"), {
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
const child = spawn(
  process.env.CODEX_BINARY ?? "codex",
  ["app-server", "--stdio"],
  {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: {
      ...process.env,
      HOME: process.env.HOME ?? os.homedir(),
      CODEX_HOME: process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
    },
  },
);
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
  assert.equal(result.plugin.summary.localVersion, "0.7.8");
  console.log(
    "PASS: Windows beta is discovered by the Codex plugin parser, version 0.7.8",
  );
} finally {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  child.stdin.end();
  child.kill();
}
