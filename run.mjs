// One JavaScript entrypoint for Windows, macOS and Linux. The host launches
// `node`; prefer Codex's managed Node for the actual server process.
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const entrypoint = fileURLToPath(import.meta.url);
const root = path.dirname(entrypoint);
const nodeName = process.platform === "win32" ? "node.exe" : "node";
const home = os.homedir();
const candidates = [
  process.env.ANIMATION_NODE_BINARY,
  process.env.CODEX_MCP_NODE_PATH,
  path.join(
    home,
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin",
    nodeName,
  ),
  process.execPath,
].filter(Boolean);
let selected;
for (const candidate of candidates) {
  if (!path.isAbsolute(candidate) || !existsSync(candidate)) continue;
  const result = spawnSync(candidate, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const version = /^v(\d+)\.(\d+)\./.exec(result.stdout ?? "");
  if (
    result.status === 0 &&
    version &&
    (+version[1] > 20 || (+version[1] === 20 && +version[2] >= 19))
  ) {
    selected = await realpath(candidate);
    break;
  }
}
if (!selected) {
  console.error(
    "Animation Builder requires Node.js >=20.19; no compatible Codex or host runtime was found.",
  );
  process.exit(127);
}
const current = await realpath(process.execPath);
const samePath = (a, b) =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
if (!samePath(selected, current)) {
  const child = spawn(selected, [entrypoint, ...process.argv.slice(2)], {
    stdio: "inherit",
    windowsHide: true,
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill(signal));
  child.once("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} else {
  // Keep data out of Codex's versioned installation directory.
  process.env.ANIMATION_DATA_DIR ??= path.join(
    process.env.LOCALAPPDATA ?? path.join(home, ".local", "share"),
    "codex-animation-builder",
    ".animation-data",
  );
  await import(
    existsSync(path.join(root, "server.js"))
      ? "./server.js"
      : "./dist/server.js"
  );
}
