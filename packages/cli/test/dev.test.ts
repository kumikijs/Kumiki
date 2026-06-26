// Integration tests for `kumiki dev` (issue #118, spec §10.7).
//
// Starts the dev server on an ephemeral port via the programmatic
// `startDevServer` API, then probes:
//   - GET / returns the synthesized HTML with the dev panel container and
//     the injected dev client script tag.
//   - GET /@kumiki-dev/client.ts returns the substituted client source so
//     the static `__KUMIKI_TARGET__` placeholder has been replaced with the
//     absolute target path BEFORE serving (required for Vite's HMR matcher).
//   - POST /__kumiki/episode with --episode-log appends one JSONL line per
//     posted body, matching the `kumiki run --episode-log` format.

import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startDevServer } from "../src/dev.ts";

const here = dirname(fileURLToPath(import.meta.url));
const COUNTER = resolve(here, "../../examples/apps/01-counter/app.kumiki");

describe("kumiki dev", () => {
  let close: () => Promise<void>;
  let baseUrl: string;
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "kumiki-dev-"));
  });

  afterEach(async () => {
    if (close) await close();
  });

  async function start(opts: Parameters<typeof startDevServer>[2] = {}) {
    const { server, url } = await startDevServer(COUNTER, [], { port: 0, ...opts });
    baseUrl = url;
    close = () => server.close();
    return server;
  }

  it("serves an HTML root with the panel container and client script tag", async () => {
    await start();
    const res = await fetch(baseUrl);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<div id="app">');
    expect(html).toContain('<div id="kumiki-dev-panel">');
    expect(html).toContain('type="module"');
    expect(html).toContain("/@kumiki-dev/client.ts");
  });

  it("substitutes __KUMIKI_TARGET__ with the absolute path in the dev client", async () => {
    await start();
    const res = await fetch(new URL("/@kumiki-dev/client.ts", baseUrl));
    expect(res.status).toBe(200);
    const code = await res.text();
    expect(code).not.toContain("__KUMIKI_TARGET__");
    // After Vite's transform the static specifier becomes a /@fs/... or
    // relative URL — the path's tail still matches the .kumiki basename.
    expect(code).toMatch(/app\.kumiki/);
    // Substitution happens BEFORE Vite transforms — both the import and the
    // hot.accept boundary share the same specifier shape; rely on the basename
    // to confirm without coupling to Vite's URL-rewriting choices.
  });

  it("appends one JSONL line per /__kumiki/episode POST when --episode-log is set", async () => {
    const logFile = join(tmpRoot, "episodes.jsonl");
    await start({ episodeLog: logFile });

    const ep1 = {
      id: "ep_aaa",
      trigger: { kind: "ui.click", ts: 1 },
      steps: [],
      status: "completed",
    };
    const ep2 = {
      id: "ep_bbb",
      trigger: { kind: "ui.click", ts: 2 },
      steps: [],
      status: "completed",
    };

    const post = (body: object) =>
      fetch(new URL("/__kumiki/episode", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    expect((await post(ep1)).status).toBe(204);
    expect((await post(ep2)).status).toBe(204);

    expect(existsSync(logFile)).toBe(true);
    const lines = readFileSync(logFile, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ id: "ep_aaa" });
    expect(JSON.parse(lines[1] as string)).toMatchObject({ id: "ep_bbb" });
  });

  it("discards POSTs to /__kumiki/episode silently when --episode-log is unset", async () => {
    await start();
    const res = await fetch(new URL("/__kumiki/episode", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "ep_xxx" }),
    });
    expect(res.status).toBe(204);
  });

  it("rejects non-POST requests to /__kumiki/episode with 405", async () => {
    await start();
    const res = await fetch(new URL("/__kumiki/episode", baseUrl));
    expect(res.status).toBe(405);
  });

  it("propagates --strict-a11y to the kumiki vite plugin so a11y violations fail compile", async () => {
    // Write a throwaway .kumiki with an unlabeled button, point the dev server
    // at it with --strict-a11y, request the file's URL, and expect a 500 with
    // the E0701 code in the body.
    const dir = mkdtempSync(join(tmpRoot, "a11y-"));
    const file = join(dir, "bad.kumiki");
    writeFileSync(
      file,
      `tile App = button()
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`,
    );
    try {
      const { server, url } = await startDevServer(file, [], {
        port: 0,
        strictA11y: true,
      });
      baseUrl = url;
      close = () => server.close();
      // Use Vite's `transformRequest` directly — fetching the file URL is
      // brittle across Vite versions, but transformRequest deterministically
      // exercises the plugin chain.
      await expect(server.transformRequest(file)).rejects.toThrow(/E0701/);
    } finally {
      try {
        unlinkSync(file);
      } catch {
        /* best-effort */
      }
    }
  });
});
