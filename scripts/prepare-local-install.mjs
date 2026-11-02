import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const sourceRoot = fileURLToPath(new URL("..", import.meta.url));
const marketplaceRoot = path.join(sourceRoot, "artifacts", "local-marketplace");
const pluginRoot = path.join(
  marketplaceRoot,
  "plugins",
  "codex-animation-builder",
);
await mkdir(path.join(pluginRoot, ".codex-plugin"), { recursive: true });
await mkdir(path.join(marketplaceRoot, ".agents", "plugins"), {
  recursive: true,
});
for (const file of ["plugin.json", ".codex-plugin/plugin.json"])
  await writeFile(
    path.join(pluginRoot, file),
    await readFile(path.join(sourceRoot, file)),
  );
await cp(path.join(sourceRoot, "skills"), path.join(pluginRoot, "skills"), {
  recursive: true,
});
const mcp = JSON.parse(
  await readFile(path.join(sourceRoot, "mcp.json"), "utf8"),
);
mcp.mcpServers["animation-builder"] = {
  type: "stdio",
  command: process.execPath,
  args: ["${PLUGIN_ROOT}/scripts/local-runtime.mjs"],
  cwd: "${PLUGIN_ROOT}",
};
await mkdir(path.join(pluginRoot, "scripts"), { recursive: true });
await writeFile(
  path.join(pluginRoot, "scripts", "runtime.json"),
  JSON.stringify({ sourceRoot }, null, 2),
);
await writeFile(
  path.join(pluginRoot, "scripts", "local-runtime.mjs"),
  `import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const {sourceRoot}=JSON.parse(await readFile(new URL('./runtime.json',import.meta.url),'utf8'));
process.chdir(sourceRoot);
process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(sourceRoot,'.browsers');
process.env.ANIMATION_DATA_DIR=path.join(sourceRoot,'.animation-data');
await import(pathToFileURL(path.join(sourceRoot,'dist','server.js')).href);
`,
);
await writeFile(
  path.join(pluginRoot, "mcp.json"),
  JSON.stringify(mcp, null, 2),
);
await writeFile(
  path.join(marketplaceRoot, ".agents", "plugins", "marketplace.json"),
  JSON.stringify(
    {
      name: "codex-animation-local",
      interface: { displayName: "Codex Animation Builder 本地开发" },
      plugins: [
        {
          name: "codex-animation-builder",
          source: {
            source: "local",
            path: "./plugins/codex-animation-builder",
          },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Productivity",
        },
      ],
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ marketplaceRoot, pluginRoot, runtime: sourceRoot }, null, 2),
);
