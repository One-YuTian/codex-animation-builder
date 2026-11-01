import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: ["tests/core.test.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: "artifacts/tests/core.test.mjs",
});
await build({
  entryPoints: ["server/export-worker.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: "artifacts/tests/export-worker.js",
});
const result = spawnSync(
  process.execPath,
  ["--test", "artifacts/tests/core.test.mjs"],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
