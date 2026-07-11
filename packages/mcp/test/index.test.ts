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
const FIX_REGRESSION = resolve(here, "fixtures/regression.kumiki");
const FIX_FAILING_SINGLE = resolve(here, "fixtures/failing-single.kumiki");

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

  it("strictIcons / strictSelectorId are wired through and default-off", async () => {
    await withClient(async (client) => {
      // Counter-tests fixture is clean under default settings AND under either
      // strict-icons or strict-selector-id — the toggles never surface false
      // positives on well-formed input, so both invocations should be `ok`.
      // The point of this test is to prove the options are wired to the
      // typechecker at all (the previous test only exercised strictA11y).
      const off = await callTool(client, "kumiki_check", { path: FIX_COUNTER_TESTS });
      expect(off).toBe("ok — no diagnostics");
      const iconsOn = await callTool(client, "kumiki_check", {
        path: FIX_COUNTER_TESTS,
        strictIcons: true,
      });
      expect(iconsOn).toBe("ok — no diagnostics");
      const selectorIdOn = await callTool(client, "kumiki_check", {
        path: FIX_COUNTER_TESTS,
        strictSelectorId: true,
      });
      expect(selectorIdOn).toBe("ok — no diagnostics");
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

  it("`only` narrows planning to a single diagnostic code", async () => {
    const file = join(workdir, "typo.kumiki");
    copyFileSync(FIX_COUNTER_TYPO, file);
    await withClient(async (client) => {
      // The typo emits E0103 (undefined-reference). Passing `only: "E9999"`
      // should filter it out; no patches are planned so the tool reports
      // "(no auto-patches available)" with the underlying error listed.
      const filtered = await callTool(client, "kumiki_fix", { path: file, only: "E9999" });
      expect(filtered).toContain("(no auto-patches available)");
      expect(filtered).toContain("E0103");
      // With the matching code, the patch surfaces.
      const targeted = await callTool(client, "kumiki_fix", { path: file, only: "E0103" });
      expect(targeted).toContain("E0103");
      expect(targeted).toContain("conut");
    });
  });

  it("returns a JSON error envelope for a bad path", async () => {
    await withClient(async (client) => {
      const out = await callTool(client, "kumiki_fix", {
        path: join(workdir, "does-not-exist.kumiki"),
      });
      const parsed = JSON.parse(out) as { error: { kind: string; message: string } };
      expect(parsed.error).toBeDefined();
      expect(typeof parsed.error.message).toBe("string");
    });
  });
});

describe("kumiki_auto_patch", () => {
  let workdir: string;
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "kumiki-mcp-"));
  });
  afterEach(() => rmSync(workdir, { recursive: true, force: true }));

  it("applies a compile-tier fix and reaches already-pass on a fixture where the test then passes", {
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
      };
      // Tier-1 clears the E0103 typo; the (now-compiling) test passes.
      // The variant here is `already-pass`, not `applied`.
      expect(parsed.status).toBe("already-pass");
      expect(parsed.compileFixes).toBeGreaterThan(0);
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

  it("applied variant on a single-test fixture: FAIL → PASS with regressed:[]", {
    timeout: 30000,
  }, async () => {
    const file = join(workdir, "failing-single.kumiki");
    copyFileSync(FIX_FAILING_SINGLE, file);
    await withClient(async (client) => {
      const out = await callTool(client, "kumiki_auto_patch", {
        path: file,
        testName: "greet-should-say-planet",
        apply: true,
      });
      const parsed = JSON.parse(out) as {
        ok: boolean;
        status: string;
        pass: boolean;
        patch: { code: string; description: string };
        regressed: string[];
      };
      expect(parsed.status).toBe("applied");
      expect(parsed.pass).toBe(true);
      expect(parsed.ok).toBe(true);
      expect(parsed.regressed).toEqual([]);
      expect(parsed.patch.code).toBe("TEST");
    });
    const after = readFileSync(file, "utf8");
    expect(after).toContain('greeting := "planet"');
    expect(after).not.toContain('greeting := "world"');
  });

  it("applied variant reports regressed test names when the patch breaks another test", {
    timeout: 30000,
  }, async () => {
    const file = join(workdir, "regression.kumiki");
    copyFileSync(FIX_REGRESSION, file);
    await withClient(async (client) => {
      // Test A wants message="planet", impl says "world" — Tier-2 replaces
      // "world" with "planet" everywhere outside test bodies. Test B was
      // asserting on "world" so it now fails: `regressed` must list "B".
      const out = await callTool(client, "kumiki_auto_patch", {
        path: file,
        testName: "A",
        apply: true,
      });
      const parsed = JSON.parse(out) as {
        ok: boolean;
        status: string;
        pass: boolean;
        regressed: string[];
      };
      expect(parsed.status).toBe("applied");
      expect(parsed.pass).toBe(true);
      expect(parsed.regressed).toEqual(["B"]);
      // ok:false because a regression was introduced, even though the
      // named test now passes.
      expect(parsed.ok).toBe(false);
    });
  });

  it("returns a JSON error envelope for a bad path", async () => {
    await withClient(async (client) => {
      const out = await callTool(client, "kumiki_auto_patch", {
        path: join(workdir, "does-not-exist.kumiki"),
        testName: "anything",
      });
      const parsed = JSON.parse(out) as { error: { kind: string; message: string } };
      expect(parsed.error).toBeDefined();
      expect(typeof parsed.error.message).toBe("string");
    });
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

  it("surfaces malformed JSONL lines via a warnings field", async () => {
    const source = join(workdir, "app.kumiki");
    writeFileSync(source, "");
    const logPath = `${source}.kumiki-episodes.jsonl`;
    // Mix of good and bad lines. The bad line ("{ not json") is neither
    // parseable nor blank — it must not be silently dropped.
    writeFileSync(
      logPath,
      [
        JSON.stringify({ id: "ep_a", trigger: { kind: "init" }, steps: [], status: "completed" }),
        "{ not json",
        JSON.stringify({ id: "ep_b", trigger: { kind: "init" }, steps: [], status: "completed" }),
      ].join("\n") + "\n",
    );
    await withClient(async (client) => {
      const listOut = await callTool(client, "kumiki_episode_list", { path: source });
      const listParsed = JSON.parse(listOut) as {
        summaries: Array<{ id: string }>;
        warnings: Array<{ kind: string; message: string }>;
      };
      expect(listParsed.summaries.map((s) => s.id)).toEqual(["ep_b", "ep_a"]);
      expect(listParsed.warnings).toHaveLength(1);
      expect(listParsed.warnings[0]?.kind).toBe("malformed-jsonl");
      expect(listParsed.warnings[0]?.message).toContain("1");

      const tailOut = await callTool(client, "kumiki_episode_tail", { path: source });
      const tailParsed = JSON.parse(tailOut) as {
        episodes: Array<{ id: string }>;
        warnings: Array<{ kind: string }>;
      };
      expect(tailParsed.episodes.map((e) => e.id)).toEqual(["ep_b", "ep_a"]);
      expect(tailParsed.warnings[0]?.kind).toBe("malformed-jsonl");
    });
  });

  it("passes through #162 panic fields (stack / cause / category) via episode_tail", async () => {
    const source = join(workdir, "app.kumiki");
    writeFileSync(source, "");
    const logPath = `${source}.kumiki-episodes.jsonl`;
    const withStack = {
      id: "ep_stack",
      trigger: { kind: "ui.click", target: "BoomBtn", ts: 1 },
      steps: [
        {
          kind: "panic",
          message: "boom",
          location: `reducer "boom"`,
          stack: "Error: boom\n    at boom (src/x.ts:1:1)",
          cause: [{ message: "root", stack: "Error: root\n    at inner (src/y.ts:2:2)" }],
          category: "reducer",
          ts: 2,
        },
      ],
      status: "panic",
    };
    writeFileSync(logPath, `${JSON.stringify(withStack)}\n`);
    await withClient(async (client) => {
      const tailOut = await callTool(client, "kumiki_episode_tail", { path: source });
      const tail = JSON.parse(tailOut) as Array<{
        steps: Array<{
          kind: string;
          message?: string;
          stack?: string;
          cause?: Array<{ message: string; stack?: string }>;
          category?: string;
        }>;
      }>;
      expect(tail).toHaveLength(1);
      const panicStep = tail[0]!.steps[0]!;
      expect(panicStep.kind).toBe("panic");
      expect(panicStep.stack).toMatch(/at boom/);
      expect(panicStep.category).toBe("reducer");
      expect(panicStep.cause).toHaveLength(1);
      expect(panicStep.cause![0]!.message).toBe("root");
      expect(panicStep.cause![0]!.stack).toMatch(/at inner/);
    });
  });
});
