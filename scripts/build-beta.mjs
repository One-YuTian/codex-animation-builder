import { build } from "esbuild";
import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
// All platforms use the same Node.js entrypoint and manifest.
const args = process.argv.slice(2);
const platformArg = args.find((arg) => arg.startsWith("--platform="));
const platform = platformArg?.split("=")[1] ?? "darwin";
if (!["darwin", "linux", "win32"].includes(platform))
  throw Error("Unsupported platform: " + platform);
const out = path.resolve(
  args.find((arg) => !arg.startsWith("--")) ??
    (platform === "win32" ? "artifacts/beta-windows" : "artifacts/beta"),
);
await mkdir(out, { recursive: true });
// Remove obsolete platform launchers when rebuilding an existing output folder.
for (const file of ["scripts/launch.sh", "scripts/launch.ps1"]) {
  await rm(path.join(out, file), { force: true });
}
for (const entry of ["server", "export-worker"]) {
  await build({
    entryPoints: [
      entry === "server" ? "server/index.ts" : "server/export-worker.ts",
    ],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: path.join(out, entry + ".js"),
    banner: {
      js: "import { createRequire as bundleRequire } from 'node:module'; globalThis.require = bundleRequire(import.meta.url);",
    },
  });
}
for (const file of [
  "plugin.json",
  ".gitattributes",
  ".codex-plugin/plugin.json",
  "mcp.json",
  "mcp.windows.json",
  "README.md",
  "skills",
  "run.mjs",
]) {
  await mkdir(path.dirname(path.join(out, file)), { recursive: true });
  await cp(file, path.join(out, file), { recursive: true });
}
await cp("dist/ui", path.join(out, "ui"), { recursive: true });
await rm(path.join(out, "wasm-tools"), { recursive: true, force: true });
await cp("server/wasm-tools/dist", path.join(out, "wasm-tools"), {
  recursive: true,
});
const pkg = JSON.parse(await readFile("package.json", "utf8"));
await writeFile(
  path.join(out, "package.json"),
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      private: true,
      type: "module",
      engines: { node: ">=20.19" },
      scripts: { start: "node run.mjs" },
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  path.join(out, "build-manifest.json"),
  JSON.stringify(
    {
      version: pkg.version,
      platform: "any",
      runtime: "node>=20.19",
      bundledDependencies: true,
    },
    null,
    2,
  ) + "\n",
);
console.log(out);
