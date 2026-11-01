import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
const root = path.resolve(process.env.ANIMATION_DATA_DIR ?? ".animation-data");
const file = path.join(root, "debug.jsonl");
export function debugLog(event: string, details: unknown = {}) {
  try {
    mkdirSync(root, { recursive: true });
    try {
      if (statSync(file).size > 4 * 1024 * 1024)
        writeFileSync(
          file,
          readFileSync(file, "utf8").split("\n").slice(-500).join("\n"),
        );
    } catch {}
    const safe = JSON.parse(
      JSON.stringify(details, (key, value) =>
        /token|cookie|authorization/i.test(key) ? "[redacted]" : value,
      ),
    );
    appendFileSync(
      file,
      JSON.stringify({ time: new Date().toISOString(), event, details: safe }) +
        "\n",
    );
  } catch {
    /* Diagnostics must never interrupt an operation. */
  }
}
export function readDebugLogs() {
  try {
    return readFileSync(file, "utf8")
      .slice(-32 * 1024)
      .split("\n")
      .filter(Boolean)
      .slice(-60)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}
