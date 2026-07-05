import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FIX_COUNTER_TYPO = resolve(here, "fixtures/counter-typo.kumiki");
const FIX_COUNTER_TESTS = resolve(here, "fixtures/counter-with-tests.kumiki");
const FIX_COUNTER_TYPO_WITH_TEST = resolve(here, "fixtures/counter-typo-with-test.kumiki");
const FIX_A11Y = resolve(here, "fixtures/a11y-missing-alt.kumiki");

type TextContent = { type: "text"; text: string };

async function withClient(fn: (client: Client) => Promise<void>): Promise<void> {
  const server = createServer();
  const [serverT, clientT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  try {
    await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as TextContent[];
  return content.map((c) => c.text).join("\n");
}

describe("kumiki_check strict options", () => {
  it("hides a11y diagnostics by default but surfaces them under strictA11y", async () => {
    await withClient(async (client) => {
      const relaxed = await callTool(client, "kumiki_check", { path: FIX_A11Y });
      expect(relaxed).toBe("ok — no diagnostics");
      const strict = await callTool(client, "kumiki_check", {
        path: FIX_A11Y,
        strictA11y: true,
      });
      expect(strict).toContain("E0701");
    });
  });
});

describe("kumiki_fix", () => {
  let workdir: string;
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "kumiki-mcp-"));
  });
  afterEach(() => rmSync(workdir, { recursive: true, force: true }));

  it("in dry-run returns planned patches without touching the file", async () => {
    const file = join(workdir, "typo.kumiki");
    copyFileSync(FIX_COUNTER_TYPO, file);
    const original = readFileSync(file, "utf8");
    await withClient(async (client) => {
      const out = await callTool(client, "kumiki_fix", { path: file });
      expect(out).toContain("E0103");
      expect(out).toContain("conut");
    });
    expect(readFileSync(file, "utf8")).toBe(original);
  });

  it("with apply:true writes the patch, returns before/after, and leaves the file clean", async () => {
    const file = join(workdir, "typo.kumiki");
    copyFileSync(FIX_COUNTER_TYPO, file);
    await withClient(async (client) => {
      const out = await callTool(client, "kumiki_fix", { path: file, apply: true });
      const parsed = JSON.parse(out) as {
        applied: number;
        before: string;
        after: string;
        remaining: unknown[];
      };
      expect(parsed.applied).toBeGreaterThan(0);
      expect(parsed.before).toContain("conut");
      expect(parsed.after).not.toContain("conut");
      expect(parsed.after).toContain("count := count + 1");
      expect(parsed.remaining).toEqual([]);
    });
    // File was actually written
    expect(readFileSync(file, "utf8")).not.toContain("conut");
  });
});

describe("kumiki_auto_patch", () => {
  let workdir: string;
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "kumiki-mcp-"));
  });
  afterEach(() => rmSync(workdir, { recursive: true, force: true }));

  it("applies a compile-tier fix and closes the loop against the failing test", {
    timeout: 30000,
  }, async () => {
    const file = join(workdir, "typo-with-test.kumiki");
    copyFileSync(FIX_COUNTER_TYPO_WITH_TEST, file);
    await withClient(async (client) => {
      const out = await callTool(client, "kumiki_auto_patch", {
        path: file,
        testName: "inc-works",
        apply: true,
      });
      const parsed = JSON.parse(out) as {
        ok: boolean;
        status: string;
        compileFixes?: number;
        regressed: string[];
      };
      expect(parsed.status).toBe("already-pass");
      expect(parsed.compileFixes).toBeGreaterThan(0);
      // AC2: regressed field is ALWAYS present on apply:true
      expect(Array.isArray(parsed.regressed)).toBe(true);
    });
    const after = readFileSync(file, "utf8");
    expect(after).not.toContain("conut");
    expect(after).toContain("count := count + 1");
  });

  it("dry-run reports 'proposed' (or already-pass) without writing", {
    timeout: 30000,
  }, async () => {
    const file = join(workdir, "counter-tests.kumiki");
    copyFileSync(FIX_COUNTER_TESTS, file);
    const original = readFileSync(file, "utf8");
    await withClient(async (client) => {
      const out = await callTool(client, "kumiki_auto_patch", {
        path: file,
        testName: "inc-works",
      });
      const parsed = JSON.parse(out) as { status: string };
      // The fixture's inc-works passes as-is → already-pass; still exercised end-to-end.
      expect(parsed.status).toBe("already-pass");
    });
    expect(readFileSync(file, "utf8")).toBe(original);
  });
});

describe("kumiki_test", () => {
  it("runs in-language tests and returns a structured pass/fail report", {
    timeout: 30000,
  }, async () => {
    await withClient(async (client) => {
      const out = await callTool(client, "kumiki_test", { path: FIX_COUNTER_TESTS });
      const parsed = JSON.parse(out) as {
        total: number;
        passed: number;
        failed: number;
        results: Array<{ name: string; pass: boolean }>;
      };
      expect(parsed.total).toBe(2);
      expect(parsed.passed).toBe(2);
      expect(parsed.failed).toBe(0);
      const names = parsed.results.map((r) => r.name).sort();
      expect(names).toEqual(["dec-works", "inc-works"]);
    });
  });

  it("supports prefix filter", { timeout: 30000 }, async () => {
    await withClient(async (client) => {
      const out = await callTool(client, "kumiki_test", {
        path: FIX_COUNTER_TESTS,
        filter: "inc-*",
      });
      const parsed = JSON.parse(out) as { total: number; results: Array<{ name: string }> };
      expect(parsed.total).toBe(1);
      expect(parsed.results[0]?.name).toBe("inc-works");
    });
  });
});

describe("kumiki_episode_list / kumiki_episode_tail", () => {
  let workdir: string;
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "kumiki-mcp-ep-"));
  });
  afterEach(() => rmSync(workdir, { recursive: true, force: true }));

  it("returns '(no episode log)' when the sidecar log does not exist", async () => {
    const source = join(workdir, "no-log.kumiki");
    writeFileSync(source, "");
    await withClient(async (client) => {
      const listOut = await callTool(client, "kumiki_episode_list", { path: source });
      expect(listOut).toBe("(no episode log)");
      const tailOut = await callTool(client, "kumiki_episode_tail", { path: source });
      expect(tailOut).toBe("(no episode log)");
    });
  });

  it("summarises with kumiki_episode_list, newest first, and honours limit", async () => {
    const source = join(workdir, "app.kumiki");
    writeFileSync(source, "");
    const logPath = `${source}.kumiki-episodes.jsonl`;
    const episodes = [
      {
        id: "ep_1",
        trigger: { kind: "init", target: "app", ts: 1 },
        steps: [{ kind: "reducer" }],
        status: "completed",
      },
      {
        id: "ep_2",
        trigger: { kind: "ui.click", target: "IncBtn", ts: 2 },
        steps: [{ kind: "reducer" }, { kind: "signal-update" }],
        status: "completed",
      },
      {
        id: "ep_3",
        trigger: { kind: "ui.click", target: "DecBtn", ts: 3 },
        steps: [{ kind: "reducer" }],
        status: "panic",
      },
    ];
    writeFileSync(logPath, `${episodes.map((e) => JSON.stringify(e)).join("\n")}\n`);
    await withClient(async (client) => {
      const listOut = await callTool(client, "kumiki_episode_list", { path: source });
      const summaries = JSON.parse(listOut) as Array<{
        id: string;
        trigger: { kind: string; target: string };
        status: string;
        steps: number;
      }>;
      expect(summaries.map((s) => s.id)).toEqual(["ep_3", "ep_2", "ep_1"]);
      expect(summaries[0]?.trigger).toEqual({ kind: "ui.click", target: "DecBtn" });
      expect(summaries[1]?.steps).toBe(2);

      const limited = await callTool(client, "kumiki_episode_list", { path: source, limit: 1 });
      const limitedParsed = JSON.parse(limited) as Array<{ id: string }>;
      expect(limitedParsed).toHaveLength(1);
      expect(limitedParsed[0]?.id).toBe("ep_3");

      const tailOut = await callTool(client, "kumiki_episode_tail", { path: source, n: 2 });
      const tail = JSON.parse(tailOut) as Array<{ id: string; status: string }>;
      expect(tail.map((e) => e.id)).toEqual(["ep_3", "ep_2"]);
    });
  });
});
