import { createServer, type IncomingMessage } from "node:http";
import { mkdir, readFile, writeFile, realpath, stat } from "node:fs/promises";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
export type Runtime = { origin: string; token: string; manualToken: string };
export async function body(req: IncomingMessage, limit: number) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Error("文件或请求过大");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function createGateway(
  root: string,
  htmlPath: string,
  execute: (op: string, args: unknown) => Promise<unknown>,
  port = 0,
) {
  await mkdir(root, { recursive: true });
  const canonicalRoot = await realpath(root);
  const token = randomBytes(32).toString("hex");
  let runtime: Runtime;
  function authorized(value: unknown) {
    if (typeof value !== "string") return false;
    const bytes = Buffer.from(value);
    return (
      bytes.length === token.length &&
      timingSafeEqual(bytes, Buffer.from(token))
    );
  }
  async function checkedFile(file: string) {
    const actual = await realpath(file);
    const relative = path.relative(canonicalRoot, actual);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      !["assets", "exports", "uploads", "projects"].includes(
        relative.split(path.sep)[0],
      )
    )
      throw Error("文件路径不在项目资源目录");
    if (!(await stat(actual)).isFile()) throw Error("文件不存在");
    return actual;
  }
  const web = createServer(async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const url = new URL(
        req.url ?? "/",
        runtime?.origin ?? "http://127.0.0.1",
      );
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type,X-Animation-Token",
        );
        res.setHeader("Access-Control-Allow-Private-Network", "true");
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === "GET" && url.pathname === "/") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          (await readFile(htmlPath, "utf8")).replace(
            "<head>",
            `<head><script>window.__RUNTIME__=${JSON.stringify(runtime)}</script>`,
          ),
        );
        return;
      }
      if (
        !authorized(
          req.headers["x-animation-token"] ?? url.searchParams.get("token"),
        )
      ) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (req.method === "GET" && url.pathname === "/api/file") {
        const file = await checkedFile(url.searchParams.get("path") ?? "");
        const ext = path.extname(file);
        res.setHeader(
          "Content-Type",
          (
            {
              ".png": "image/png",
              ".gif": "image/gif",
              ".webp": "image/webp",
              ".webm": "video/webm",
              ".zip": "application/zip",
              ".json": "application/json",
            } as Record<string, string>
          )[ext] ?? "application/octet-stream",
        );
        if (url.searchParams.get("download") === "1")
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${path.basename(file)}"`,
          );
        res.end(await readFile(file));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/upload") {
        const bytes = await body(req, 24 * 1024 * 1024),
          dir = path.join(root, "uploads");
        await mkdir(dir, { recursive: true });
        const file = path.resolve(dir, randomUUID() + ".png");
        await writeFile(file, bytes);
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            path: file,
            name: url.searchParams.get("name") ?? "image",
          }),
        );
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/action") {
        const { op, args } = JSON.parse(
          (await body(req, 4 * 1024 * 1024)).toString(),
        );
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(await execute(op, args)));
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });
  await new Promise<void>((resolve, reject) => {
    web.once("error", reject);
    web.listen(port, "127.0.0.1", () => resolve());
  });
  const address = web.address();
  if (!address || typeof address === "string")
    throw Error("本机资源服务启动失败");
  runtime = {
    origin: `http://127.0.0.1:${address.port}`,
    token,
    manualToken: randomBytes(32).toString("hex"),
  };
  return {
    runtime,
    web,
    fileUrl: (file: string) =>
      `${runtime.origin}/api/file?path=${encodeURIComponent(file)}&token=${token}`,
  };
}
