import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "@kumikijs/compiler";
import { nodeRuntimeBundleReader } from "@kumikijs/compiler/node";
import { describe, expect, it } from "vitest";
import {
  COUNTER,
  callOnce,
  callTool,
  FIX_A11Y,
  FIX_COUNTER_TESTS,
  FIX_COUNTER_TYPO,
  FIX_SMOKE_PANICS,
  FIX_WARNING_ONLY,
  flag,
  listTools,
  useWorkdir,
  withClient,
} from "./helpers/client.ts";

describe("kumiki_check strict options", () => {
  it("hides a11y diagnostics by default but surfaces them under strictA11y", async () => {
    expect((await callOnce("kumiki_check", { path: FIX_A11Y })).body).toBe("ok — no diagnostics");
    const strict = await callOnce("kumiki_check", { path: FIX_A11Y, strictA11y: true });
    expect(strict.body).toContain("E0701");
  });

  it.each([
    {},
    { strictIcons: true },
    { strictSelectorId: true },
  ])("accepts %o on a clean file and reports no diagnostics", async (strict) => {
    const res = await callOnce("kumiki_check", { path: FIX_COUNTER_TESTS, ...strict });
    expect(res.body).toBe("ok — no diagnostics");
  });
});

describe("isError mirrors the CLI's exit code", () => {
  it.each([
    "kumiki_check",
    "kumiki_build",
  ])("flags %s failing on well-formed input", async (name) => {
    expect(await flag(name, { path: FIX_COUNTER_TYPO })).toBe(true);
  });

  it("flags a smoke run on a file that compiles but panics", async () => {
    expect(await flag("kumiki_smoke", { path: FIX_SMOKE_PANICS })).toBe(true);
    expect(await flag("kumiki_smoke", { path: FIX_COUNTER_TESTS })).toBe(false);
  });

  it.each([
    { tool: "kumiki_check", says: "W0212" },
    { tool: "kumiki_fix", says: "no errors (1 warning)" },
    { tool: "kumiki_build", says: "build ok" },
  ])("$tool does not flag a warning-only file, and still names it", async ({ tool, says }) => {
    const res = await callOnce(tool, { path: FIX_WARNING_ONLY });
    expect(res.isError).toBe(false);
    expect(res.body).toContain(says);
    expect(res.body).toContain("W0212");
  });
});

describe("kumiki_run_scenario", () => {
  it("flags a scenario whose step failed", async () => {
    const failing = { steps: [{ expect: { state: { count: 99 } } }] };
    expect(await flag("kumiki_run_scenario", { path: FIX_COUNTER_TESTS, scenario: failing })).toBe(
      true,
    );
    const passing = { steps: [{ expect: { noErrors: true } }] };
    expect(await flag("kumiki_run_scenario", { path: FIX_COUNTER_TESTS, scenario: passing })).toBe(
      false,
    );
  });

  it("marks a step whose action could not run as FAIL, and says why", async () => {
    // No `expect`: the failed action is the only thing that can fail this step.
    const res = await callOnce("kumiki_run_scenario", {
      path: FIX_COUNTER_TESTS,
      scenario: { steps: [{ do: { click: "#typo" } }] },
    });
    expect(res.isError).toBe(true);
    expect(res.body).toContain("[FAIL] step 0: click #typo");
    expect(res.body).toContain("action failed: no element matching selector #typo");
  });
});

describe("the diagnostic wire shape", () => {
  const workdir = useWorkdir();
  type WireDiagnostic = { code: string; severity?: unknown; line?: number; col?: number };
  // By code: the order the checker reports them in is not what these tests are about.
  const pairs = (ds: WireDiagnostic[]) =>
    [...ds].sort((a, b) => a.code.localeCompare(b.code)).map((d) => [d.code, d.severity]);
  const writeMixed = (): string => {
    const file = join(workdir.path, "mixed.kumiki");
    writeFileSync(
      file,
      [
        "slot count : Int = 0",
        "reducer bump on=ui.focus(Card) do= count := count + 1",
        'tile Card = box(heading("Count: " + count.show))',
        "tile App = column(Card, text(zzz.show))",
        "app Mixed",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "",
      ].join("\n"),
    );
    return file;
  };

  it("kumiki_check on a warning-only file says in its payload that nothing in it fails", async () => {
    const res = await callOnce("kumiki_check", { path: FIX_WARNING_ONLY });
    expect(res.isError).toBe(false);
    const diagnostics = JSON.parse(res.body) as WireDiagnostic[];
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((d) => d.severity === "warning")).toBe(true);
  });

  it("tells a warning from an error in one file by `severity`", async () => {
    const res = await callOnce("kumiki_check", { path: writeMixed() });
    expect(res.isError).toBe(true);
    expect(pairs(JSON.parse(res.body) as WireDiagnostic[])).toEqual([
      ["E0103", "error"],
      ["W0212", "warning"],
    ]);
  });

  it.each([
    { tool: "kumiki_check", head: [] },
    { tool: "kumiki_build", head: ["build failed:"] },
  ])("$tool reports unparsable source as an E0000 error, and flags it", async ({ tool, head }) => {
    const res = await callOnce(tool, { source: "tile App = column(" });
    expect(res.isError).toBe(true);
    const lines = res.body.split("\n");
    expect(lines.slice(0, head.length)).toEqual(head);
    const diagnostics = JSON.parse(lines.slice(head.length).join("\n")) as WireDiagnostic[];
    expect(diagnostics).toEqual([
      {
        code: "E0000",
        kind: "parse-error",
        message: "Parse error at 1:19: Unexpected token in expression",
        line: 1,
        col: 19,
        severity: "error",
      },
    ]);
  });

  it("gives every diagnostic a severity, whichever tool reports it", async () => {
    const file = writeMixed();
    await withClient(async (client) => {
      const built = await callTool(client, "kumiki_build", { path: file });
      const [head, ...json] = built.split("\n");
      expect(head).toBe("build failed:");
      // Not sorted: the description promises the warnings, then the errors.
      const listed = JSON.parse(json.join("\n")) as WireDiagnostic[];
      expect(listed.map((d) => [d.code, d.severity])).toEqual([
        ["W0212", "warning"],
        ["E0103", "error"],
      ]);

      const fixed = JSON.parse(
        await callTool(client, "kumiki_fix", { path: file, apply: true }),
      ) as {
        remaining: WireDiagnostic[];
        warnings: WireDiagnostic[];
      };
      expect(pairs(fixed.remaining)).toEqual([["E0103", "error"]]);
      expect(pairs(fixed.warnings)).toEqual([["W0212", "warning"]]);
    });
  });

  it("kumiki_build hands a successful build's warnings back in a second content item", async () => {
    const expected = compile(readFileSync(FIX_WARNING_ONLY, "utf8"), {
      runtimeSpecifier: "./runtime.js",
      bundle: true,
      readRuntimeBundle: nodeRuntimeBundleReader,
      capabilities: [],
    });
    if (expected.kind !== "ok") throw new Error("the warning-only fixture does not compile");
    await withClient(async (client) => {
      const build = async (args: Record<string, unknown>) => {
        const res = await client.callTool({ name: "kumiki_build", arguments: args });
        expect(res.isError ?? false).toBe(false);
        return (res.content as { text: string }[]).map((c) => c.text);
      };
      const summary = await build({ path: FIX_WARNING_ONLY });
      expect(summary).toHaveLength(2);
      const [head = "", warnings = ""] = summary;
      expect(head).toBe(
        `build ok — ${expected.js.length} bytes of JS (pass includeJs=true for the source)`,
      );
      const [label, ...list] = warnings.split("\n");
      expect(label).toBe("warnings:");
      expect(pairs(JSON.parse(list.join("\n")) as WireDiagnostic[])).toEqual([
        ["W0212", "warning"],
      ]);
      expect(await build({ path: FIX_WARNING_ONLY, includeJs: true })).toEqual([
        expected.js,
        warnings,
      ]);
      expect(await build({ path: COUNTER })).toHaveLength(1);
    });
  });

  it.each([
    "kumiki_check",
    "kumiki_build",
    "kumiki_fix",
    "kumiki_auto_patch",
  ])("%s says what `severity` means in its description", async (name) => {
    const description = (await listTools()).find((t) => t.name === name)?.description ?? "";
    expect(description).toContain('`severity` is `"error"`');
    expect(description).toContain('or `"warning"`');
  });

  it.each([
    ["kumiki_build", "a second content item holds them, `warnings:` followed by a JSON list"],
    ["kumiki_build", "the warnings, then the errors that failed it"],
    ["kumiki_auto_patch", "Every outcome carries `warnings`"],
  ])("%s says where it puts the warnings: %s", async (name, says) => {
    const description = (await listTools()).find((t) => t.name === name)?.description ?? "";
    expect(description).toContain(says);
  });
});
