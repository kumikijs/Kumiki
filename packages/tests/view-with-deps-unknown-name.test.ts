// `view --with-deps` and MCP `kumiki_view` with `withDeps` on a qualified name
// the file does not define.
//
// §9.2.5: `view` exits 1 when the qualified name does not exist, and the MCP
// server flags the same failure with `isError: true` and the error envelope.
// Without the dependency flag, both already did. With it, the walk over the
// name's dependencies found nothing to print, and the empty result went out as
// a success: an empty line and exit 0 at the CLI, empty text with no `isError`
// over MCP. A typo'd name read as a definition with no body.
//
// The CLI half spawns the CLI, because the exit code is the thing under test
// and only a real process has one.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "@kumikijs/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const cliDir = join(here, "..", "cli");
const CLI = join(cliDir, "src", "kumiki.ts");
const TSX = pathToFileURL(createRequire(join(cliDir, "package.json")).resolve("tsx")).href;

// The child's limit is the shorter one: `spawnSync` blocks the worker, so a
// hung CLI has to be stopped by its own timeout before vitest's.
const CHILD_TIMEOUT_MS = 60_000;
const SPAWN = { timeout: 70_000 };

const SOURCE = `slot count : Int = 0

reducer inc on=ui.click(IncBtn) do= count := count + 1

tile IncBtn = button(text="+")
tile App = column(heading("Count: " + count), IncBtn)

app Counter
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

/** `reducer.inc` and everything it reads, dependencies first. */
const INC_WITH_DEPS = `slot count : Int = 0

tile IncBtn = button(text="+")

reducer inc on=ui.click(IncBtn) do= count := count + 1`;

const NOT_FOUND = 'Definition "slot.nope" not found';

let dir: string;
let file: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "kumiki-view-deps-"));
  file = join(dir, "c.kumiki");
  writeFileSync(file, SOURCE);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function runCli(args: string[]): { stdout: string; stderr: string; code: number } {
  const res = spawnSync(process.execPath, ["--import", TSX, CLI, ...args], {
    stdio: "pipe",
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  });
  // A process that never started, or one a signal killed, has `status: null`;
  // folding that into a number would let a `toBe(1)` pass on a CLI that never ran.
  if (res.error) throw res.error;
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", code: res.status ?? Number.NaN };
}

type TextContent = { type: "text"; text: string };

async function view(args: Record<string, unknown>): Promise<{ isError: boolean; body: string }> {
  const server = createServer();
  const [serverT, clientT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  try {
    const res = await client.callTool({ name: "kumiki_view", arguments: { path: file, ...args } });
    const body = (res.content as TextContent[]).map((c) => c.text).join("\n");
    return { isError: res.isError === true, body };
  } finally {
    await client.close();
    await server.close();
  }
}

describe("kumiki view --with-deps", () => {
  it("fails on a qname that is not defined, as it does without the flag", SPAWN, () => {
    const res = runCli(["view", file, "slot.nope", "--with-deps"]);
    expect(res).toEqual({ stdout: "", stderr: `${NOT_FOUND}\n`, code: 1 });
    expect(runCli(["view", file, "slot.nope"])).toEqual(res);
  });

  it("prints a defined qname after its dependencies", SPAWN, () => {
    expect(runCli(["view", file, "reducer.inc", "--with-deps"])).toEqual({
      stdout: `${INC_WITH_DEPS}\n`,
      stderr: "",
      code: 0,
    });
  });
});

describe("MCP kumiki_view with withDeps", () => {
  it("reports a qname that is not defined as an error, as it does without withDeps", async () => {
    const res = await view({ name: "slot.nope", withDeps: true });
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.body)).toEqual({ error: { kind: "error", message: NOT_FOUND } });
    expect(await view({ name: "slot.nope" })).toEqual(res);
  });

  it("returns a defined qname after its dependencies", async () => {
    expect(await view({ name: "reducer.inc", withDeps: true })).toEqual({
      isError: false,
      body: INC_WITH_DEPS,
    });
  });
});
