import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
const sourceRoot = fileURLToPath(new URL("..", import.meta.url));
const processHost = spawn(
  "codex",
  ["app-server", process.argv.includes("--standalone") ? "--stdio" : "proxy"],
  { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
);
processHost.stderr.on("data", (d) => process.stderr.write(d));
const pending = new Map();
let seq = 0;
createInterface({ input: processHost.stdout }).on("line", (line) => {
  try {
    const r = JSON.parse(line);
    if (pending.has(r.id)) {
      const { resolve, reject, timer } = pending.get(r.id);
      clearTimeout(timer);
      pending.delete(r.id);
      r.error ? reject(Error(JSON.stringify(r.error))) : resolve(r.result);
    }
  } catch {}
});
function rpc(method, params) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error("Timed out: " + method));
    }, 25000);
    pending.set(id, { resolve, reject, timer });
    processHost.stdin.write(
      JSON.stringify({
        id,
        method,
        ...(params === undefined ? {} : { params }),
      }) + "\n",
    );
  });
}
try {
  await rpc("initialize", {
    clientInfo: { name: "animation-plugin-diagnostic", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  processHost.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
  const plugin = await rpc("plugin/read", {
    marketplacePath: path.join(
      sourceRoot,
      "artifacts",
      "local-marketplace",
      ".agents",
      "plugins",
      "marketplace.json",
    ),
    pluginName: "codex-animation-builder",
  });
  if (!plugin.plugin.mcpServers.includes("animation-builder"))
    throw Error("Codex did not load the animation MCP configuration");
  const inventory = await rpc("mcpServerStatus/list", {
    serverName: "animation-builder",
    detail: "toolsAndAuthOnly",
  });
  const server = inventory.data.find((s) => s.name === "animation-builder");
  if (
    !server ||
    server.toolsError ||
    !Object.values(server.tools).some((t) => t.name === "animation_open_editor")
  )
    throw Error(
      "Codex host did not discover animation_open_editor: " +
        JSON.stringify(server?.toolsError ?? inventory),
    );
  console.log(
    JSON.stringify(
      {
        version: plugin.plugin.summary.localVersion,
        enabled: plugin.plugin.summary.enabled,
        skills: plugin.plugin.skills.map((s) => s.name),
        mcpServers: plugin.plugin.mcpServers,
        server: server.name,
        pluginId: server.pluginId,
        tools: Object.values(server.tools).map((t) => t.name),
        toolsError: server.toolsError,
      },
      null,
      2,
    ),
  );
} finally {
  processHost.stdin.end();
  processHost.kill();
}
