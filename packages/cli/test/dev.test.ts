import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "@kumikijs/examples";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startDevServer } from "../src/dev.ts";
import { CLI_ARGV, runCli } from "./helpers/cli.ts";

const COUNTER = app("01-counter");

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
    expect(code).toMatch(/app\.kumiki/);
  });

  it("reads a capability manifest at the project root, as check does", {
    timeout: 60_000,
  }, async () => {
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
    if (existsSync(logFile)) {
      expect(readFileSync(logFile, "utf8")).toBe("");
    }
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
