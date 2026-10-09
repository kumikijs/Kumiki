import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const cliDir = join(dirname(fileURLToPath(import.meta.url)), "..", "cli");
const CLI = join(cliDir, "src", "kumiki.ts");
const TSX = pathToFileURL(createRequire(join(cliDir, "package.json")).resolve("tsx")).href;

// `spawnSync` blocks the worker, so vitest's timeout cannot interrupt a hung child: the child's own limit is the shorter one, so it always fires first.
const CHILD_TIMEOUT_MS = 60_000;
const SPAWN = { timeout: 70_000 };

function runCli(args: string[]): { stdout: string; stderr: string; code: number } {
  const res = spawnSync(process.execPath, ["--import", TSX, CLI, ...args], {
    stdio: "pipe",
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  });
  // A child that never started or was killed has `status: null`; folding that into 1 would pass every `toBe(1)` below without the CLI having run.
  if (res.error) throw res.error;
  return { stdout: res.stdout, stderr: res.stderr, code: res.status ?? Number.NaN };
}

const SOURCE = `slot count : Int = 0

reducer reset on=ui.click(ResetBtn)
    do= count := 0

tile ResetBtn = button(text="reset")
tile App = column(heading("Count: " + count), ResetBtn)

app Counter
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

let dir: string;
let file: string;
let opLog: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kumiki-edit-line-"));
  file = join(dir, "c.kumiki");
  opLog = `${file}.kumiki-ops.jsonl`;
  writeFileSync(file, SOURCE);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a per-line edit patch whose text is not on its line", () => {
  it("is rejected by `edit`: exit 1, file untouched, nothing logged", SPAWN, () => {
    const patch = { "body:2": "replace 'cuont' -> 'count'" };
    const { stdout, stderr, code } = runCli(["edit", file, "reducer.reset", JSON.stringify(patch)]);
    expect(code).toBe(1);
    expect(stderr).toContain('edit rejected: "cuont" not present on body line 2 of reducer.reset');
    expect(stdout).not.toContain("edited");
    expect(readFileSync(file, "utf8")).toBe(SOURCE);
    expect(existsSync(opLog)).toBe(false);
  });

  it("is rejected when the text is elsewhere in the definition", SPAWN, () => {
    // `count` is on body line 2 of the reducer, not line 1. A check against the whole definition, which is what `{find, replace}` makes, passes here.
    const patch = { "body:1": "replace 'count' -> 'total'" };
    const { stderr, code } = runCli(["edit", file, "reducer.reset", JSON.stringify(patch)]);
    expect(code).toBe(1);
    expect(stderr).toContain('"count" not present on body line 1 of reducer.reset');
    expect(readFileSync(file, "utf8")).toBe(SOURCE);
    expect(existsSync(opLog)).toBe(false);
  });

  it("is rejected by `patch apply`: exit 1, file untouched, nothing logged", SPAWN, () => {
    const ops = join(dir, "ops.jsonl");
    const op = {
      op: "edit",
      layer: "reducer",
      name: "reset",
      patch: { "body:2": "replace 'cuont' -> 'count'" },
    };
    writeFileSync(ops, `${JSON.stringify(op)}\n`);
    const { stdout, stderr, code } = runCli(["patch", "apply", file, ops]);
    expect(code).toBe(1);
    expect(stderr).toContain('"cuont" not present on body line 2 of reducer.reset');
    expect(stdout).not.toContain("applied");
    expect(readFileSync(file, "utf8")).toBe(SOURCE);
    expect(existsSync(opLog)).toBe(false);
  });
});

describe("a per-line edit patch whose text is on its line", () => {
  it("still applies and logs one edit op", SPAWN, () => {
    const patch = { "body:2": "replace '0' -> '1'" };
    const { stdout, code } = runCli(["edit", file, "reducer.reset", JSON.stringify(patch)]);
    expect(code).toBe(0);
    expect(stdout).toContain("edited reducer.reset");
    expect(readFileSync(file, "utf8")).toBe(SOURCE.replace("do= count := 0", "do= count := 1"));
    const logged = readFileSync(opLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { op: string; patch: unknown });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ op: "edit", patch });
  });
});
