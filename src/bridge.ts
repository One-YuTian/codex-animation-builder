import { z } from "zod";
import { App, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import type { Project } from "./model";
import { fileUrl, downloadFile, setHostFileReader } from "./files";
import { applyHostTheme } from "./theme";
declare global {
  interface Window {
    __RUNTIME__?: { origin: string; token: string; manualToken: string };
  }
}
let app: App | undefined;
export async function connect(onResult: (r: any) => void) {
  if (window.parent === window) return;
  app = new App(
    { name: "Codex Animation Builder", version: "0.7.2" },
    { availableDisplayModes: ["fullscreen"] },
    { autoResize: false },
  );
  app.ontoolresult = (r) => {
    if (r._meta?.runtime) window.__RUNTIME__ = r._meta.runtime as any;
    onResult(r._meta?.appState ?? r.structuredContent);
  };
  app.onhostcontextchanged = (ctx) => {
    applyHostTheme(ctx.theme);
    if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  };
  await app.connect();
  setHostFileReader(async (path, signal) => {
    const parts: Uint8Array[] = [];
    let offset = 0,
      version: string | undefined,
      total: number | undefined;
    do {
      signal.throwIfAborted();
      const result = await app!.callServerTool({
        name: "animation_read_asset",
        arguments: {
          path,
          offset,
          version,
          sessionToken: window.__RUNTIME__?.token,
        },
      });
      signal.throwIfAborted();
      if (result.isError)
        throw Error(
          (result.content?.[0] as any)?.text ??
            "MCP图片读取失败，请更新插件并重新打开面板",
        );
      const chunk = result._meta?.binary as
        | {
            bytes: number[];
            total: number;
            offset: number;
            next: number;
            version: string;
          }
        | undefined;
      if (
        !chunk ||
        !Array.isArray(chunk.bytes) ||
        chunk.offset !== offset ||
        chunk.next !== offset + chunk.bytes.length ||
        chunk.next > chunk.total ||
        chunk.total > 64 * 1024 * 1024 ||
        (total !== undefined && total !== chunk.total) ||
        (version !== undefined && version !== chunk.version)
      )
        throw Error("MCP图片分块响应无效");
      if (chunk.next === offset && offset < chunk.total)
        throw Error("MCP图片读取未取得进展");
      parts.push(Uint8Array.from(chunk.bytes));
      offset = chunk.next;
      total = chunk.total;
      version = chunk.version;
    } while (offset < total!);
    return new Blob(parts as BlobPart[], { type: "image/png" });
  });
  const ctx = app.getHostContext();
  applyHostTheme(ctx?.theme);
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
}
export async function call(op: string, args: unknown = {}): Promise<any> {
  if (op === "export")
    args = { ...(args as any), manualToken: window.__RUNTIME__?.manualToken };
  if (app) {
    const result = await app.callServerTool({
      name: "animation_" + op,
      arguments: args as Record<string, unknown>,
    });
    if (result.isError)
      throw Error((result.content?.[0] as any)?.text ?? "MCP 操作失败");
    if (result._meta?.runtime) window.__RUNTIME__ = result._meta.runtime as any;
    return result._meta?.appState ?? result.structuredContent;
  }
  const response = await fetch(
    (window.__RUNTIME__?.origin ?? "") + "/api/action",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Animation-Token": window.__RUNTIME__?.token ?? "",
      },
      body: JSON.stringify({ op, args }),
    },
  );
  const result = await response.json();
  if (!response.ok || result.error) throw Error(result.error ?? "请求失败");
  return result;
}
export async function context(p: Project, selected?: string) {
  try {
    await app?.updateModelContext({
      structuredContent: {
        projectId: p.id,
        revision: p.revision,
        stage: p.stage,
        frame: p.frame,
        selectedLayer: selected,
        scene: p.scene,
        groups: p.groups,
        layers: p.layers.map(
          ({ id, name, x, y, width, height, z, groupId, visible }) => ({
            id,
            name,
            x,
            y,
            width,
            height,
            z,
            groupId,
            visible,
          }),
        ),
      },
    });
  } catch {
    /* Hosts can omit model context support. */
  }
}
export async function saveExport(path: string, mimeType: string) {
  if (app) {
    const filename = path.split(/[\\/]/).at(-1) ?? "animation";
    let offset = 0;
    let version: string | undefined;
    let total: number | undefined;
    const parts: Uint8Array[] = [];
    do {
      const result = await app.callServerTool({
        name: "animation_read_asset",
        arguments: {
          path,
          offset,
          version,
          sessionToken: window.__RUNTIME__?.token,
        },
      });
      if (result.isError) {
        throw Error((result.content?.[0] as any)?.text ?? "导出文件读取失败");
      }
      const chunk = result._meta?.binary as
        | {
            bytes: number[];
            total: number;
            offset: number;
            next: number;
            version: string;
          }
        | undefined;
      if (!chunk || !Array.isArray(chunk.bytes)) {
        throw Error("读取导出分块失败");
      }
      parts.push(Uint8Array.from(chunk.bytes));
      offset = chunk.next;
      total = chunk.total;
      version = chunk.version;
    } while (offset < total!);

    let totalLength = 0;
    for (const part of parts) totalLength += part.length;
    const combined = new Uint8Array(totalLength);
    let cur = 0;
    for (const part of parts) {
      combined.set(part, cur);
      cur += part.length;
    }

    let binary = "";
    const len = combined.length;
    const chunkSize = 8192;
    for (let i = 0; i < len; i += chunkSize) {
      const sub = combined.subarray(i, Math.min(i + chunkSize, len));
      binary += String.fromCharCode.apply(null, sub as unknown as number[]);
    }
    const base64 = btoa(binary);

    const result = await app.downloadFile({
      contents: [
        {
          type: "resource",
          resource: {
            uri: "file:///" + encodeURIComponent(filename),
            mimeType,
            blob: base64,
          },
        },
      ],
    });
    if (result.isError) throw Error("文件导出未完成");
  } else {
    downloadFile(path);
  }
}

export async function revealExport(jobId: string) {
  const result = await call("reveal_export", { jobId });
  if (!app?.getHostCapabilities()?.experimental?.["openai/files"])
    throw Error(
      "当前宿主未提供打开本地目录API，请使用支持openai/files的Codex版本",
    );
  await (app as any).request(
    { method: "openai/files/open", params: { path: result.directory } },
    z.object({}).passthrough(),
  );
}
