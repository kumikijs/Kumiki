import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { runCli, SPAWN } from "./helpers/cli.ts";
import { seed } from "./helpers/files.ts";
import { logPath } from "./helpers/op-log.ts";

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

let file: string;
let opLog: string;

beforeEach(() => {
  file = seed(SOURCE, "c.kumiki");
  opLog = logPath(file);
});

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
    const ops = join(dirname(file), "ops.jsonl");
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
