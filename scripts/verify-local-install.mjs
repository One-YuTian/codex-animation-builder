import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const installedRoot = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
if (!installedRoot) throw Error("Provide installed plugin root");
const config = JSON.parse(
  await readFile(path.join(installedRoot, "mcp.json"), "utf8"),
).mcpServers["animation-builder"];
const expand = (value) =>
  typeof value === "string"
    ? value.replaceAll("${PLUGIN_ROOT}", installedRoot)
    : value;
config.args = config.args.map(expand);
config.cwd = expand(config.cwd);
const client = new Client({
  name: "verify-installed-animation",
  version: "1.0.0",
});
const transport = new StdioClientTransport({
  command: config.command,
  args: config.args,
  cwd: config.cwd,
  env: { ...process.env, ...config.env },
  stderr: "pipe",
});
transport.stderr?.on("data", (d) => process.stderr.write(d));
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const open = tools.find((t) => t.name === "animation_open_editor");
  if (!open || ![31,34,35].includes(tools.length)) throw Error("Unexpected tools");
  const result = await client.callTool({
    name: "animation_list",
    arguments: {},
  });
  if (result.isError) throw Error(JSON.stringify(result.content));
  const ui = await client.readResource({
    uri: "ui://codex-animation-builder/preview-v5",
  });
  if (!ui.contents[0].text.includes("Codex Animation Builder"))
    throw Error("UI missing");
  const skills = await readdir(path.join(installedRoot, "skills"));
  console.log(
    JSON.stringify(
      {
        server: "connected",
        tools: tools.length,
        skills,
        entrypoints: open._meta["openai/ui"].entrypoints,
        displayModes: ui.contents[0]._meta["openai/ui"].availableDisplayModes,
        harmlessCall: "animation_list passed",
        installedRoot,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
