import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
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
  type WireDiagnostic = { code: string; severity?: unknown };
  const pairs = (ds: WireDiagnostic[]) => ds.map((d) => [d.code, d.severity]);
  const writeMixed = (): string => {
    const file = join(workdir.path, "mixed.kumiki");
    writeFileSync(
      file,
      [
        "slot count : Int = 0",
        "reducer bump on=ui.focus(Card) do= count := count + 1",
        'tile Card = box(heading("Count: " + count.show))',
        "tile App = column(Card, text(totl.show))",
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
      ["W0212", "warning"],
      ["E0103", "error"],
    ]);
  });

  it("gives every diagnostic a severity, whichever tool reports it", async () => {
    const file = writeMixed();
    await withClient(async (client) => {
      const built = await callTool(client, "kumiki_build", { path: file });
      const [head, ...json] = built.split("\n");
      expect(head).toBe("build failed:");
      expect(pairs(JSON.parse(json.join("\n")) as WireDiagnostic[])).toEqual([["E0103", "error"]]);

      const fixed = JSON.parse(
        await callTool(client, "kumiki_fix", { path: file, apply: true }),
      ) as {
        remaining: WireDiagnostic[];
        warnings: WireDiagnostic[];
      };
      expect(pairs(fixed.remaining)).toEqual([["E0103", "error"]]);
      expect(pairs(fixed.warnings)).toEqual([["W0212", "warning"]]);

      const unparsed = await callTool(client, "kumiki_check", { source: "tile App = column(" });
      expect(pairs(JSON.parse(unparsed) as WireDiagnostic[])).toEqual([["E0000", "error"]]);
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
});
