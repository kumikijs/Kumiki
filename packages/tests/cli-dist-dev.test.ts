// `kumiki dev` from the *built* CLI.
//
// The dev plugin reads its browser client and panel from disk, next to the
// module that holds it: `src/dev/*.ts` when the CLI runs from source, and
// whatever tsdown's copy rule produced when it runs from `dist/`. Every test in
// packages/cli starts the CLI from source, so a copy rule that put the files
// anywhere but where the built chunk looks went unnoticed and the published
// `kumiki dev` failed with ENOENT on start.
//
// This test starts `packages/cli/dist/kumiki.js` — the file `bin` points at —
// so the lookup runs from the built chunk against the built layout. The CLI's
// workspace dependencies still resolve to their TypeScript sources here (the
// dev `exports`), hence the tsx loader; that does not touch the CLI's own
// `dist/`, which is what is under test. This package depends on @kumikijs/cli,
// so turbo builds that `dist/` before these tests run.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { get } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const cliDir = join(here, "..", "cli");
const BUILT_CLI = join(cliDir, "dist", "kumiki.js");
const COUNTER = join(here, "..", "examples", "apps", "01-counter", "app.kumiki");
const TSX = pathToFileURL(createRequire(join(cliDir, "package.json")).resolve("tsx")).href;

/**
 * A real GET over the loopback. Not `fetch`: helpers/setup.ts replaces it with
 * the headless tiers' fixture-only double, which never leaves the process.
 */
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

describe("kumiki dev from the built CLI", () => {
  it("starts and serves the dev client and panel", { timeout: 60_000 }, async () => {
    if (!existsSync(BUILT_CLI)) {
      throw new Error(
        `${BUILT_CLI} not found — build @kumikijs/cli first (pnpm --filter @kumikijs/cli build)`,
      );
    }
    const child = spawn(
      process.execPath,
      ["--import", TSX, BUILT_CLI, "dev", COUNTER, "--port", "0"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    try {
      const url = await new Promise<string>((resolveUrl, reject) => {
        let out = "";
        let err = "";
        child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
          out += chunk;
          const m = /kumiki dev — (http:\/\/\S+)/.exec(out);
          if (m?.[1]) resolveUrl(m[1]);
        });
        child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
          err += chunk;
        });
        child.on("error", reject);
        // `close`, not `exit`: it fires once stdout/stderr have drained, so the
        // rejection carries the child's whole diagnostic.
        child.on("close", (code) => {
          reject(new Error(`built kumiki dev exited ${code} before listening:\n${out}${err}`));
        });
      });

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
