import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { zipSync } from "fflate";
import path from "node:path";
const files = [
  "plugin.json",
  "run.mjs",
  ".gitattributes",
  "mcp.json",
  "mcp.windows.json",
  "mcp.macos.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "README.md",
  ".codex-plugin/plugin.json",
];
async function walk(dir) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = dir + "/" + ent.name;
    if (ent.isDirectory()) await walk(p);
    else files.push(p);
  }
}
await walk("skills");
await walk("dist");
await walk("scripts");
await walk("src");
await walk("server");
await walk("tests");
files.push("tsconfig.json", "vite.config.ts", "index.html");
const entries = {};
for (const file of files) {
  entries[file.replaceAll("\\", "/")] = new Uint8Array(await readFile(file));
}
const manifest = JSON.parse(Buffer.from(entries["plugin.json"]).toString());
if (manifest.name !== "codex-animation-builder")
  throw Error("Manifest mismatch");
await mkdir("artifacts", { recursive: true });
const file = path.resolve(
  `artifacts/codex-animation-builder-${manifest.version}.zip`,
);
await writeFile(file, zipSync(entries, { level: 6 }));
console.log(
  file +
    " (" +
    files.length +
    " files; dependencies and browser installed locally after extraction)",
);
