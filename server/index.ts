import { modelResult } from "./responses";
import { debugLog, readDebugLogs } from "./debug-log";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { operations, descriptions, Store, type Operation } from "./core";
import { renderProject, closeRenderer } from "./export";
import { ExportJobs } from "./jobs";
import { z } from "zod";
import { readAssetChunk } from "./asset-reader";
import { createGateway } from "./gateway";
const root = path.resolve(
  process.env.ANIMATION_DATA_DIR ?? path.join(process.cwd(), ".animation-data"),
);
const htmlPath = fileURLToPath(new URL("./ui/index.html", import.meta.url));
const jobs = new ExportJobs(path.join(root, "exports"));
const output = path.join(root, "exports"),
  store = new Store(
    root,
    (p, f, n) => renderProject(p, f, n, htmlPath, output, gateway.runtime),
    jobs,
  );
let queue: Promise<unknown> = Promise.resolve();
async function execute(op: Operation, args: unknown) {
  const started = Date.now();
  const quiet = ["current", "export_status"].includes(op);
  if (!quiet) debugLog("animation_" + op + " 开始", { args });
  try {
    const result = await executeOperation(op, args);
    if (!quiet)
      debugLog("animation_" + op + " 完成", {
        elapsedMs: Date.now() - started,
        projectId: result.project?.id,
        revision: result.project?.revision,
        assetId: result.asset?.id,
      });
    return ["current", "export_status", "export", "cancel_export"].includes(op)
      ? { ...result, debugLogs: readDebugLogs(), runtimeVersion: "0.7.2" }
      : result;
  } catch (error) {
    debugLog("animation_" + op + " 失败", {
      elapsedMs: Date.now() - started,
      error: String(error),
    });
    throw error;
  }
}
function executeOperation(op: Operation, args: unknown) {
  if (
    op === "export" &&
    (!args ||
      typeof args !== "object" ||
      (args as any).manualToken !== gateway.runtime.manualToken)
  )
    return Promise.reject(Error("AI工作流不执行导出，请用户在面板中点击导出"));
  if (op === "current" || op === "export_status" || op === "cancel_export")
    return store.execute(op, args);
  const next = queue.then(() => store.execute(op, args));
  queue = next.catch(() => {});
  return next;
}
const gateway = await createGateway(
  root,
  htmlPath,
  async (op, args) => {
    if (!Object.prototype.hasOwnProperty.call(operations, op))
      throw Error("未知操作");
    return execute(op as Operation, args);
  },
  process.argv.includes("--web") ? Number(process.env.PORT ?? 4318) : 0,
);
const server = new McpServer({
  name: "codex-animation-builder",
  version: "0.7.2",
});
const uri = "ui://codex-animation-builder/preview-v5";
registerAppResource(server, "Animation Editor", uri, {}, async () => ({
  contents: [
    {
      uri,
      mimeType: RESOURCE_MIME_TYPE,
      text: (await readFile(htmlPath, "utf8")).replace(
        "<head>",
        `<head><script>window.__RUNTIME__=${JSON.stringify(gateway.runtime)}</script>`,
      ),
      _meta: {
        ui: {
          csp: {
            connectDomains: [],
            resourceDomains: ["blob:"],
          },
        },
        "openai/ui": {
          preferredDisplayMode: "fullscreen",
          availableDisplayModes: ["fullscreen"],
        },
      },
    },
  ],
}));
registerAppTool(
  server,
  "animation_open_editor",
  {
    title: "Codex Animation Builder",
    description:
      "打开常驻动画编辑器；每次新会话或新动画任务默认重置画板，仅在用户明确要求编辑旧内容时传入projectId。",
    inputSchema: {
      reset: z
        .boolean()
        .optional()
        .describe("是否重置编辑器清空画板（新会话或新任务默认为true）"),
      projectId: z
        .string()
        .optional()
        .describe(
          "指定打开的历史项目ID（仅在用户明确要求继续编辑旧内容时传入）",
        ),
    },
    _meta: {
      ui: { resourceUri: uri },
      "openai/ui": { entrypoints: [{ type: "global" }, { type: "thread" }] },
    },
  },
  async (args: { reset?: boolean; projectId?: string }) => {
    debugLog("animation_open_editor", { args });
    if (args?.projectId) {
      await execute("get", { projectId: args.projectId, activate: true });
    } else if (args?.reset !== false) {
      await execute("reset", {});
    }
    return {
      content: [{ type: "text", text: "动画编辑器已打开。" }],
      structuredContent: modelResult(
        "current",
        {},
        await execute("current", {}),
      ),
      _meta: {
        runtime: gateway.runtime,
        appState: await execute("current", {}),
      },
    };
  },
);
// Browser sandbox network access is not required for local images.
server.registerTool(
  "animation_read_asset",
  {
    description: "仅供预览面板按绝对路径读取本地图片分块，不使用base64",
    inputSchema: {
      path: z.string(),
      offset: z.number().int().nonnegative().default(0),
      version: z.string().optional(),
      sessionToken: z.string(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    _meta: { ui: { visibility: ["app"] } },
  },
  async (args) => {
    try {
      if (args.sessionToken !== gateway.runtime.token)
        throw Error("预览会话已失效，请重新打开面板");
      const binary = await readAssetChunk(
        root,
        args.path,
        args.offset,
        args.version,
      );
      if (args.offset === 0)
        debugLog("animation_read_asset", {
          path: args.path,
          totalBytes: binary.total,
        });
      return { content: [], _meta: { binary } };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  },
);
for (const [op, schema] of Object.entries(operations)) {
  server.registerTool(
    `animation_${op}`,
    {
      description: descriptions[op as Operation],
      inputSchema: schema.shape,
      annotations: {
        readOnlyHint: [
          "get",
          "list",
          "current",
          "snapshot",
          "prepare_regions",
          "export_status",
        ].includes(op),
        destructiveHint: op === "remove_layer",
      },
      _meta: {
        ui: {
          visibility: [
            "export",
            "export_status",
            "cancel_export",
            "reveal_export",
          ].includes(op)
            ? ["app"]
            : ["model", "app"],
        },
      },
    },
    async (args: Record<string, unknown>): Promise<CallToolResult> => {
      try {
        const result = await execute(op as Operation, args);
        return {
          content: [{ type: "text", text: `animation_${op} 完成` }],
          structuredContent: modelResult(op, args, result),
          _meta: { runtime: gateway.runtime, appState: result },
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            },
          ],
        };
      }
    },
  );
}
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  gateway.web.close();
  void jobs
    .close()
    .then(() => closeRenderer())
    .then(() => process.exit())
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
if (process.argv.includes("--web"))
  console.error("Animation Editor: " + gateway.runtime.origin);
else {
  // A shell launcher may survive a disconnected client unless Node also
  // releases its HTTP listener and workers when the stdio input closes.
  process.stdin.once("end", shutdown);
  await server.connect(new StdioServerTransport());
}
