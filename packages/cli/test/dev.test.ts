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

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startDevServer } from "../src/dev.ts";

const CLI_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "kumiki.ts");

function runCli(args: string[]): { out: string; code: number } {
  try {
    const out = execFileSync("npx", ["tsx", CLI_PATH, ...args], {
      stdio: "pipe",
      shell: true,
      encoding: "utf8",
    });
    return { out, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { out: `${err.stdout ?? ""}${err.stderr ?? ""}`, code: err.status ?? 1 };
  }
}

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

  async function start(opts: Parameters<typeof startDevServer>[1] = {}) {
    const { server, url } = await startDevServer(COUNTER, { port: 0, ...opts });
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

  it("reads a capability manifest at the project root, as check does", async () => {
    // The dev server makes the .kumiki file's own directory Vite's root so the
    // static `import App` resolves. The manifest search must not inherit that
    // root: a file that `kumiki check` accepts has to compile here too.
    const projectRoot = mkdtempSync(join(tmpdir(), "kumiki-dev-caps-"));
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ name: "p" }));
    writeFileSync(
      join(projectRoot, "kumiki.caps.json"),
      JSON.stringify({ capabilities: ["telemetry.track"] }),
    );
    const file = join(projectRoot, "src", "app.kumiki");
    writeFileSync(
      file,
      `slot sent : Int = 0
effect track cap=telemetry.track in={name: Text} out=Unit
reducer fire on=ui.click(B) do= emit track({name: "x"})
tile B = button(text="b")
tile App = column(B, text(sent.show))
app A caps=[telemetry.track] routes={"/" -> App, "/404" -> App} init=[]
`,
    );
    expect(runCli(["check", file]).code).toBe(0);

    const { server, url } = await startDevServer(file, { port: 0 });
    close = () => server.close();
    const res = await fetch(new URL("/app.kumiki?import", url));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("export default App;");
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

  it("returns 400 with an error body on /__kumiki/episode POSTs that are not valid JSON", async () => {
    const logFile = join(tmpRoot, "episodes.jsonl");
    await start({ episodeLog: logFile });
    const res = await fetch(new URL("/__kumiki/episode", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not valid json",
    });
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { error: string };
    expect(payload.error).toMatch(/invalid episode JSON/);
    // The corrupted body must NOT have polluted the JSONL — `kumiki replay`
    // would choke on it. Either no file, or an empty one is acceptable.
    if (existsSync(logFile)) {
      expect(readFileSync(logFile, "utf8")).toBe("");
    }
  });

  it("returns 500 when --episode-log points at a path that cannot be written", async () => {
    // Point at the tmp directory itself — appendFileSync to a directory
    // errors with EISDIR on every platform we ship for.
    await start({ episodeLog: tmpRoot });
    const res = await fetch(new URL("/__kumiki/episode", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "ep_zzz" }),
    });
    expect(res.status).toBe(500);
    const payload = (await res.json()) as { error: string };
    expect(payload.error).toMatch(/failed to append episode log/);
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
      const { server, url } = await startDevServer(file, {
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

// CLI dispatch tests spawn `npx tsx kumiki.ts ...` so the first run pays the
// tsx cold-start cost. Local runs were ~1s/test; CI cold start pushed the
// first invocation past vitest's 5s default. Give the whole suite a 30s
// per-test budget so cold-start drift doesn't flake builds.
const DISPATCH_TIMEOUT_MS = 30_000;

describe("kumiki dev — CLI dispatch argument parsing", () => {
  it(
    "exits 2 with a usage message when no input file is given",
    () => {
      const { code, out } = runCli(["dev"]);
      expect(code).toBe(2);
      expect(out).toMatch(/kumiki dev <input\.kumiki>/);
    },
    DISPATCH_TIMEOUT_MS,
  );

  it(
    "rejects --port with a non-numeric value",
    () => {
      const { code, out } = runCli(["dev", "fake.kumiki", "--port", "abc"]);
      expect(code).toBe(2);
      expect(out).toMatch(/invalid --port 'abc'/);
    },
    DISPATCH_TIMEOUT_MS,
  );

  it(
    "rejects --port outside the valid range",
    () => {
      const { code, out } = runCli(["dev", "fake.kumiki", "--port", "70000"]);
      expect(code).toBe(2);
      expect(out).toMatch(/invalid --port '70000'/);
    },
    DISPATCH_TIMEOUT_MS,
  );

  it(
    "rejects --episode-log when its value is missing (next token starts with --)",
    () => {
      const { code, out } = runCli(["dev", "fake.kumiki", "--episode-log", "--strict-a11y"]);
      expect(code).toBe(2);
      expect(out).toMatch(/Usage: kumiki dev/);
    },
    DISPATCH_TIMEOUT_MS,
  );

  it(
    "rejects --episode-log when it is the last argument",
    () => {
      const { code, out } = runCli(["dev", "fake.kumiki", "--episode-log"]);
      expect(code).toBe(2);
      expect(out).toMatch(/Usage: kumiki dev/);
    },
    DISPATCH_TIMEOUT_MS,
  );
});
