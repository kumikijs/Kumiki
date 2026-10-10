import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { app } from "@kumikijs/examples";
import { normalizePath, type ViteDevServer } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startDevServer } from "../src/dev.ts";
import { CLI_ARGV, runCli } from "./helpers/cli.ts";
import { tempDir } from "./helpers/files.ts";

const COUNTER = app("01-counter");

describe("kumiki dev", () => {
  let close: () => Promise<void>;
  let baseUrl: string;
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = tempDir();
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
    expect(code).toMatch(/app\.kumiki/);
  });

  it("reads a capability manifest at the project root, as check does", {
    timeout: 60_000,
  }, async () => {
    const projectRoot = tempDir();
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
    if (existsSync(logFile)) {
      expect(readFileSync(logFile, "utf8")).toBe("");
    }
  });

  it("logs a client abort mid-body on /__kumiki/episode, writes nothing for it, and keeps serving", async () => {
    const logFile = join(tmpRoot, "episodes.jsonl");
    const server = await start({ episodeLog: logFile });
    const logged = vi.spyOn(server.config.logger, "error");
    const { hostname, port } = new URL(baseUrl);
    const socket = connect(Number(port), hostname);
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    socket.write(
      `POST /__kumiki/episode HTTP/1.1\r\nHost: ${hostname}\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"id":"ep_cut`,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    socket.destroy();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(logged).toHaveBeenCalledWith("[kumiki dev] request stream error: aborted");

    const res = await fetch(new URL("/__kumiki/episode", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "ep_after" }),
    });
    expect(res.status).toBe(204);
    expect(readFileSync(logFile, "utf8").trim().split("\n")).toEqual(['{"id":"ep_after"}']);
  });

  it("returns 500 when --episode-log points at a path that cannot be written", async () => {
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

// The runtime keeps module-level state, so the page works only if the dev
// client and the app import it through one URL.
describe("the runtime kumiki dev serves", () => {
  const RUNTIME = "@kumikijs/runtime";
  const requireHere = createRequire(import.meta.url);
  const PLUGIN_RUNTIME = normalizePath(
    createRequire(requireHere.resolve("@kumikijs/vite")).resolve(RUNTIME),
  );
  /** The workspace links the runtime into this package, so a project here resolves the link. */
  const WORKSPACE_TMP = resolve(import.meta.dirname, "../test-tmp");

  const APP = `slot n : Int = 0
reducer inc on=ui.click(B) do= n := n + 1
tile B = button(text="+")
tile App = column(B, text(n.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  function workspaceDir(): string {
    mkdirSync(WORKSPACE_TMP, { recursive: true });
    const dir = mkdtempSync(join(WORKSPACE_TMP, "kumiki-dev-runtime-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
  }

  function project(where: "tmp" | "workspace" = "tmp"): string {
    const dir = where === "tmp" ? tempDir() : workspaceDir();
    writeFileSync(join(dir, "app.kumiki"), APP);
    return dir;
  }

  function runtimeFrom(dir: string): string {
    return normalizePath(createRequire(join(dir, "package.json")).resolve(RUNTIME));
  }

  /** Asked of the directories, not of `require`: the runner's `NODE_PATH` is not read by Vite. */
  function runtimeAbove(dir: string): boolean {
    for (let d = dir; ; d = dirname(d)) {
      if (existsSync(join(d, "node_modules", RUNTIME))) return true;
      if (dirname(d) === d) return false;
    }
  }

  async function serve(dir: string) {
    const warnings: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warnings.push(args.join(" "));
    });
    let started: Awaited<ReturnType<typeof startDevServer>>;
    try {
      started = await startDevServer(join(dir, "app.kumiki"), { port: 0 });
    } finally {
      warn.mockRestore();
    }
    cleanups.push(() => started.server.close());
    return { ...started, warned: warnings.join("\n") };
  }

  function mountImport(code: string): string {
    const m = /import\s*\{[^}]*\bmount\b[^}]*\}\s*from\s*"([^"]+)"/.exec(code);
    if (!m?.[1]) throw new Error(`no import of mount in:\n${code}`);
    return m[1];
  }

  /** Loads the page's modules over HTTP the way a browser does. */
  async function loadPage(server: ViteDevServer, url: string) {
    const get = async (path: string) => {
      const res = await fetch(new URL(path, url));
      expect(res.status, path).toBe(200);
      return res.text();
    };
    const client = await get("/@kumiki-dev/client.ts");
    const appUrl = /import\s+\w+\s+from\s*"([^"]+\.kumiki[^"]*)"/.exec(client)?.[1];
    if (!appUrl) throw new Error(`the dev client imports no .kumiki module:\n${client}`);
    const appCode = await get(appUrl);
    const clientRuntime = mountImport(client);
    const appRuntime = mountImport(appCode);
    await get(appRuntime);
    const env = server.environments.client;
    const served = (await env.moduleGraph.getModuleByUrl(appRuntime))?.file;
    const meta = env.depsOptimizer?.metadata;
    const prebundle = meta?.optimized[RUNTIME] ?? meta?.discovered[RUNTIME];
    return { clientRuntime, appRuntime, served, prebundle };
  }

  it("serves the plugin's runtime, without a warning, where the root cannot resolve one", async () => {
    const dir = project();
    expect(runtimeAbove(dir)).toBe(false);

    const { server, url, warned } = await serve(dir);
    expect(warned).not.toContain("Failed to resolve dependency");

    const page = await loadPage(server, url);
    expect(page.appRuntime).toBe(page.clientRuntime);
    expect(page.served).toBe(PLUGIN_RUNTIME);
    expect(page.prebundle).toBeUndefined();
  });

  it("pre-bundles the runtime the project installed, once, for the client and the app", async () => {
    const dir = project();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "p", private: true }));
    const installed = join(dir, "node_modules", "@kumikijs", "runtime");
    mkdirSync(installed, { recursive: true });
    writeFileSync(
      join(installed, "package.json"),
      JSON.stringify({ name: RUNTIME, type: "module", exports: { ".": "./index.js" } }),
    );
    // The runtime's single-file build, as the published package's entry is.
    copyFileSync(requireHere.resolve(`${RUNTIME}/bundle`), join(installed, "index.js"));
    const own = runtimeFrom(dir);
    expect(own).not.toBe(PLUGIN_RUNTIME);

    const { server, url } = await serve(dir);
    const page = await loadPage(server, url);
    expect(page.appRuntime).toBe(page.clientRuntime);
    expect(page.prebundle?.src).toBe(own);
    expect(page.served).toBe(page.prebundle?.file);
  });

  it("serves a runtime linked from the workspace from its source, once, for the client and the app", async () => {
    // A project inside the workspace resolves the runtime through the
    // workspace link, and Vite serves a linked package from its source.
    const dir = project("workspace");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "p", private: true }));
    const linked = runtimeFrom(dir);

    const { server, url } = await serve(dir);
    const page = await loadPage(server, url);
    expect(page.appRuntime).toBe(page.clientRuntime);
    expect(page.served).toBe(linked);
    expect(page.prebundle).toBeUndefined();
  });
});

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

  it(
    "starts the server when the arguments are valid",
    async () => {
      // `--port 0` takes any free port; only a non-zero port is strict.
      const child = spawn(process.execPath, [...CLI_ARGV, "dev", COUNTER, "--port", "0"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      try {
        const banner = await new Promise<string>((resolveBanner, reject) => {
          let out = "";
          let err = "";
          child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
            out += chunk;
            const line = /kumiki dev — http:\/\/\S+/.exec(out);
            if (line) resolveBanner(line[0]);
          });
          child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
            err += chunk;
          });
          child.on("exit", (code) => {
            reject(new Error(`kumiki dev exited ${code} before listening:\n${out}${err}`));
          });
        });
        expect(banner).toMatch(/^kumiki dev — http:\/\//);
      } finally {
        child.kill();
      }
    },
    DISPATCH_TIMEOUT_MS,
  );
});
