import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdtemp, mkdir, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";

const read = async (file) => JSON.parse(await readFile(file, "utf8"));
test("Windows release is directly installable; macOS shell entrypoint is preserved", async () => {
  const mac = await read("artifacts/beta/mcp.json");
  const windows = await read("artifacts/beta-windows/mcp.json");
  const source = await read("mcp.json");
  assert.deepEqual(mac, source);
  assert.equal(mac.mcpServers["animation-builder"].command, "sh");
  assert(
    !(await readFile("artifacts/beta/scripts/launch.sh", "utf8")).includes(
      "\r",
    ),
    "POSIX launcher must use LF even when built on Windows",
  );
  assert.equal(
    await readFile("artifacts/beta/scripts/launch.sh", "utf8"),
    await readFile("scripts/launch.sh", "utf8"),
  );
  const win = windows.mcpServers["animation-builder"];
  assert.equal(win.command, "powershell");
  assert.deepEqual(win.args, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "${PLUGIN_ROOT}/scripts/launch.ps1",
  ]);
  assert.equal(win.cwd, "${PLUGIN_ROOT}");
  assert.deepEqual(
    windows,
    await read("artifacts/beta-windows/mcp.windows.json"),
  );
  assert.equal(
    (await read("artifacts/beta-windows/build-manifest.json")).platform,
    "win32",
  );
});

test(
  "native Windows manifest starts MCP and renders the editor without sh",
  { skip: process.platform !== "win32", timeout: 60000 },
  async () => {
    await mkdir("artifacts", { recursive: true });
    const data = await mkdtemp(path.resolve("artifacts/Windows startup 数据 "));
    const root = path.resolve("artifacts/beta-windows");
    const config = (await read(path.join(root, "mcp.json"))).mcpServers[
      "animation-builder"
    ];
    // No Git Bash, WSL or other shell is on this PATH. Use the exact shipped
    // command and absolute plugin-root substitutions, from an unrelated cwd.
    const env = {
      ...process.env,
      PATH:
        path.join(
          process.env.SystemRoot,
          "System32",
          "WindowsPowerShell",
          "v1.0",
        ) +
        path.delimiter +
        path.join(process.env.SystemRoot, "System32"),
      ANIMATION_DATA_DIR: data,
    };
    delete env.Path;
    delete env.ANIMATION_NODE_BINARY;
    env.PATH =
      path.join(
        process.env.SystemRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
      ) +
      path.delimiter +
      path.join(process.env.SystemRoot, "System32");
    const client = new Client({
      name: "windows-startup-regression",
      version: "1",
    });
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args.map((arg) => arg.replaceAll("${PLUGIN_ROOT}", root)),
      cwd: path.dirname(root),
      env,
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk) => (stderr += chunk));
    let browser;
    try {
      await client.connect(transport);
      const tools = (await client.listTools()).tools;
      assert.equal(tools.length, 35);
      for (const name of [
        "animation_open_editor",
        "animation_batch_layers",
        "animation_keyframes",
      ])
        assert(tools.some((tool) => tool.name === name));
      const opened = await client.callTool({
        name: "animation_open_editor",
        arguments: { reset: true },
      });
      assert(!opened.isError, JSON.stringify(opened));
      const created = await client.callTool({
        name: "animation_create",
        arguments: {
          name: "Windows startup smoke",
          width: 64,
          height: 64,
          fps: 12,
          duration: 1,
        },
      });
      assert(!created.isError, JSON.stringify(created));
      const resource = await client.readResource({
        uri: "ui://codex-animation-builder/preview-v5",
      });
      assert(resource.contents[0].text.includes("<html"));
      const origin = opened._meta.runtime.origin;
      const response = await fetch(origin);
      assert.equal(response.status, 200);
      const errors = [];
      browser = await chromium.launch({
        headless: true,
        ...(process.env.ANIMATION_TEST_BROWSER
          ? { executablePath: process.env.ANIMATION_TEST_BROWSER }
          : {}),
      });
      const page = await browser.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(origin);
      await page.getByRole("button", { name: "导出", exact: true }).waitFor();
      await page.screenshot({ path: path.join(data, "editor.png") });
      assert.deepEqual(errors, []);
      console.log(
        "PASS: native Windows MCP, 35 tools, editor resource and browser UI; " +
          path.join(data, "editor.png"),
      );
    } catch (error) {
      throw new Error(error.message + "\nServer stderr: " + stderr, {
        cause: error,
      });
    } finally {
      await browser?.close();
      await client.close();
    }
  },
);

test(
  "Windows launcher prefers bundled Codex Node and preserves explicit overrides",
  { skip: process.platform !== "win32" },
  async () => {
    const fixture = await mkdtemp(
      path.resolve("artifacts/Node selection 空格 "),
    );
    await mkdir(path.join(fixture, "scripts"));
    await cp("scripts/launch.ps1", path.join(fixture, "scripts/launch.ps1"));
    await writeFile(
      path.join(fixture, "run.mjs"),
      "console.log(process.execPath); process.exit(Number(process.argv[2] ?? 0));",
    );
    const command = (await read("mcp.windows.json")).mcpServers[
      "animation-builder"
    ];
    const args = command.args.map((arg) =>
      arg.replaceAll("${PLUGIN_ROOT}", fixture),
    );
    const env = { ...process.env };
    delete env.ANIMATION_NODE_BINARY;
    const launch = () =>
      execFileSync(command.command, args, {
        env,
        encoding: "utf8",
        windowsHide: true,
      }).trim();
    const bundled = path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe",
    );
    assert.equal(
      path.normalize(launch()).toLowerCase(),
      path.normalize(bundled).toLowerCase(),
    );
    env.ANIMATION_NODE_BINARY = process.execPath;
    assert.equal(
      path.normalize(launch()).toLowerCase(),
      path.normalize(process.execPath).toLowerCase(),
    );
    env.ANIMATION_NODE_BINARY = path.join(fixture, "missing.exe");
    assert.equal(
      path.normalize(launch()).toLowerCase(),
      path.normalize(bundled).toLowerCase(),
    );
    // With no bundled runtime, PATH remains a supported fallback.
    env.USERPROFILE = fixture;
    delete env.Path;
    env.PATH =
      path.dirname(process.execPath) + path.delimiter + process.env.PATH;
    assert.equal(
      path.normalize(launch()).toLowerCase(),
      path.normalize(process.execPath).toLowerCase(),
    );
    assert.throws(
      () =>
        execFileSync(command.command, [...args, "23"], {
          env,
          windowsHide: true,
        }),
      (error) => error.status === 23,
    );
  },
);

test(
  "POSIX launcher selects Codex before PATH and retains override/PATH fallbacks",
  { skip: process.platform === "win32" && !process.env.ANIMATION_TEST_SH },
  async () => {
    const fixture = await mkdtemp(path.resolve("artifacts/POSIX selection "));
    const root = fixture.replaceAll("\\", "/");
    const bundledDir = path.join(
      fixture,
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin",
    );
    await mkdir(bundledDir, { recursive: true });
    await mkdir(path.join(fixture, "bin"));
    const fake = (label) =>
      `#!/bin/sh\nif [ "$1" = "-e" ]; then exit 0; fi\nprintf '%s\\n' '${label}'\n`;
    await writeFile(path.join(bundledDir, "node"), fake("codex"), {
      mode: 0o755,
    });
    await writeFile(path.join(fixture, "bin/node"), fake("path"), {
      mode: 0o755,
    });
    await writeFile(path.join(fixture, "override"), fake("override"), {
      mode: 0o755,
    });
    const shell = process.env.ANIMATION_TEST_SH ?? "sh";
    const env = {
      ...process.env,
      HOME: root,
      PATH: root + "/bin:/usr/bin:/bin",
      ANIMATION_NODE_BINARY: "",
    };
    delete env.Path;
    const launch = () =>
      execFileSync(shell, [path.resolve("scripts/launch.sh")], {
        env,
        encoding: "utf8",
      }).trim();
    assert.equal(launch(), "codex");
    env.ANIMATION_NODE_BINARY = root + "/override";
    assert.equal(launch(), "override");
    env.ANIMATION_NODE_BINARY = root + "/missing";
    assert.equal(launch(), "codex");
    await writeFile(path.join(bundledDir, "node"), "#!/bin/sh\nexit 1\n", {
      mode: 0o755,
    });
    assert.equal(launch(), "path");
  },
);
