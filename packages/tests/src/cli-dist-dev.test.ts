import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { get } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";

const cliDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "cli");
const BUILT_CLI = join(cliDir, "dist", "kumiki.js");
// The CLI's workspace dependencies dev-resolve to their .ts sources; tsx loads those without
// touching the CLI's own dist, which is what this test runs.
const TSX = pathToFileURL(createRequire(join(cliDir, "package.json")).resolve("tsx")).href;

// node:http rather than fetch: the test setup replaces fetch with a fixture-only double.
function httpGet(url: URL): Promise<{ status: number; body: string }> {
  return new Promise((resolveGet, reject) => {
    get(url, (res) => {
      let body = "";
      res.setEncoding("utf8").on("data", (chunk: string) => {
        body += chunk;
      });
      res.on("end", () => resolveGet({ status: res.statusCode ?? 0, body }));
    }).on("error", reject);
  });
}

function listeningUrl(child: ReturnType<typeof spawn>): Promise<string> {
  return new Promise((resolveUrl, reject) => {
    let out = "";
    let err = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      out += chunk;
      const m = /kumiki dev — (http:\/\/\S+)/.exec(out);
      if (m?.[1]) resolveUrl(m[1]);
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      err += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      reject(new Error(`built kumiki dev exited ${code} before listening:\n${out}${err}`));
    });
  });
}

describe("kumiki dev from the built CLI", () => {
  it("starts and serves the dev client and panel", { timeout: 60_000 }, async () => {
    expect(existsSync(BUILT_CLI), `${BUILT_CLI} is missing; build @kumikijs/cli first`).toBe(true);
    const child = spawn(
      process.execPath,
      ["--import", TSX, BUILT_CLI, "dev", app("01-counter"), "--port", "0"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    try {
      const url = await listeningUrl(child);

      const client = await httpGet(new URL("/@kumiki-dev/client.ts", url));
      expect(client.status).toBe(200);
      expect(client.body).not.toContain("__KUMIKI_TARGET__");
      expect(client.body).toMatch(/app\.kumiki/);

      const panel = await httpGet(new URL("/@kumiki-dev/panel.ts", url));
      expect(panel.status).toBe(200);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await once(child, "exit");
      }
    }
  });
});
