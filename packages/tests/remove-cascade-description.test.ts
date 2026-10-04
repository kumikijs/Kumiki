// `cascade` on a remove takes the target's dependents (ai-edit.md §9.4.1): every
// definition that references it, and every one that references those, which
// can reach the `app`. The `kumiki_remove` description is the only text an
// agent reads before calling the tool, and it said the opposite: "definitions
// that only it referenced", the target's own dependencies. An agent that took it
// at its word cascaded a type it believed nothing needed and lost the slot, the
// reducer, the root tile and the `app` with it. The CLI's `--cascade` help
// described the other direction, and nothing held the two surfaces together.
//
// Both are read the way their readers read them: the description off
// `tools/list`, the help off `kumiki remove --help`.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "@kumikijs/mcp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const cliDir = join(here, "..", "cli");
const CLI = join(cliDir, "src", "kumiki.ts");
const TSX = pathToFileURL(createRequire(join(cliDir, "package.json")).resolve("tsx")).href;

type Transport = Parameters<ReturnType<typeof createServer>["connect"]>[0];
type Message = Parameters<Transport["send"]>[0];

/**
 * A JSON-RPC session with the server, over a transport that hands messages
 * across in memory: the exchange an agent has, without the SDK client.
 */
async function connect(): Promise<{
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
}> {
  const server = createServer();
  const answers = new Map<string | number, (reply: Message) => void>();
  const transport: Transport = {
    start: async () => {},
    close: async () => {},
    send: async (reply) => {
      if ("id" in reply && reply.id !== undefined) answers.get(reply.id)?.(reply);
    },
  };
  await server.connect(transport);
  let lastId = 0;
  const request = (method: string, params: Record<string, unknown>): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = ++lastId;
      answers.set(id, (reply) =>
        "result" in reply ? resolve(reply.result) : reject(new Error(JSON.stringify(reply))),
      );
      transport.onmessage?.({ jsonrpc: "2.0", id, method, params });
    });
  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  });
  transport.onmessage?.({ jsonrpc: "2.0", method: "notifications/initialized" });
  return { request, close: () => server.close() };
}

const normalize = (s: string): string => s.replace(/\s+/g, " ").trim();

async function removeDescription(): Promise<string> {
  const session = await connect();
  try {
    const listed = (await session.request("tools/list", {})) as {
      tools: { name: string; description?: string }[];
    };
    const tool = listed.tools.find((t) => t.name === "kumiki_remove");
    expect(tool?.description, "kumiki_remove is listed with a description").toBeTypeOf("string");
    return normalize(tool?.description ?? "");
  } finally {
    await session.close();
  }
}

/** The `--cascade` entry of `kumiki remove --help`, with commander's line wrapping undone. */
function cliCascadeHelp(): string {
  const help = execFileSync(process.execPath, ["--import", TSX, CLI, "remove", "--help"], {
    encoding: "utf8",
  });
  const lines = help.split("\n");
  const at = lines.findIndex((l) => l.trimStart().startsWith("--cascade"));
  expect(at, `no --cascade entry in:\n${help}`).toBeGreaterThanOrEqual(0);
  // A wrapped description goes on under its own column, further in than the
  // next option's flags.
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((l) => !/^ {3,}\S/.test(l));
  const entry = [lines[at], ...(end === -1 ? rest : rest.slice(0, end))].join(" ");
  return normalize(entry.replace(/^\s*--cascade\s+/, ""));
}

// The issue's program: `type.N` is referenced by the slot alone, and the slot by
// the reducer and the root tile, which the `app` routes to. `tile.IncBtn`
// references nothing that goes, so it is what is left.
const PROGRAM = `type N = nominal Int where between(0, 999)
slot count : N = 0

reducer inc on=ui.click(IncBtn) do= count := count + 1

tile IncBtn = button(text="+")
tile App = column(heading("Count: " + count), IncBtn)

app Counter
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

describe("kumiki_remove's description of cascade", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kumiki-cascade-description-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("says it takes every definition that references the target, out to the app", async () => {
    const description = await removeDescription();
    expect(description).toMatch(/\bdependents\b/);
    expect(description).toContain("every definition that references it");
    expect(description).toMatch(/\btransitively\b/);
    expect(description).toMatch(/\bapp\b/);

    // And that is what the tool does to the program the description misled.
    const file = join(dir, "m.kumiki");
    writeFileSync(file, PROGRAM);
    const session = await connect();
    try {
      const result = (await session.request("tools/call", {
        name: "kumiki_remove",
        arguments: { path: file, name: "type.N", cascade: true },
      })) as { content: { text: string }[]; isError?: boolean };
      const out = result.content.map((c) => c.text).join("\n");
      expect(result.isError, out).not.toBe(true);
      const cascaded = out
        .split("\n")
        .filter((l) => l.startsWith("  cascaded "))
        .map((l) => l.slice("  cascaded ".length));
      expect(cascaded).toEqual(["app.Counter", "reducer.inc", "slot.count", "tile.App"]);
    } finally {
      await session.close();
    }
  });

  it("states the relation the CLI's --cascade help states", { timeout: 60_000 }, async () => {
    const help = cliCascadeHelp();
    expect(help).toMatch(/^also remove \S/);
    expect(await removeDescription()).toContain(help);
  });
});
