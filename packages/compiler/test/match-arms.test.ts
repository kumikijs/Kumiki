import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { compileOrFail, LOADABLE, writeTmpFile } from "./helpers/module.ts";
import { withApp, withReducer } from "./helpers/programs.ts";
import { scratchRoot } from "./helpers/scratch.ts";

// Under the package: the emitted module imports `@kumikijs/runtime` by name.
const TMP = scratchRoot(import.meta.url);

// Small enough that arms nested one per arm overrun it on every platform: on Linux x64 they do
// from about 290 arms. How many nested statements a stack holds differs by platform, so the
// check fixes the stack rather than inherit it.
const STACK_KB = 64;

// Each run starts a `node` process that loads the runtime from source.
const RUNS = { timeout: 60_000 } as const;

type Slots = Record<string, unknown>;

function emit(source: string): string {
  return writeTmpFile(TMP, "match-arms", "app.mjs", compileOrFail(source, LOADABLE));
}

/** Compiled on first use, so a program that does not compile fails its tests rather than the file's collection. */
function emitted(source: string): () => string {
  let file: string | undefined;
  return () => {
    file ??= emit(source);
    return file;
  };
}

/** What `node --check` reports about `file`: "" when it parses, its error line otherwise. */
function parseError(file: string): string {
  const run = spawnSync(process.execPath, [`--stack-size=${STACK_KB}`, "--check", file], {
    encoding: "utf8",
  });
  if (run.status === 0) return "";
  return run.stderr.split("\n").find((l) => /Error/.test(l)) ?? `exit ${run.status}`;
}

/** What the module observes after the match ran: the slots reducer `r` wrote, or the text `/` rendered. */
type Read = "slots" | "text";

const RUNNER = `
import { pathToFileURL } from "node:url";
const [file, read, subjects] = process.argv.slice(1);
const app = (await import(pathToFileURL(file).href)).createApp();
const reducer = app.reducers.find((r) => r.name === "r");
const route = app.routes.find((r) => r.pattern === "/");
const observed = JSON.parse(subjects).map((subject) => {
  app.live.subject = subject;
  return read === "slots" ? reducer.apply(app.live, {}).slots : route.tile().text;
});
process.stdout.write(JSON.stringify(observed));
`;

/**
 * What one app instance from `file` observes for each of `subjects` in turn, in a `node` process
 * of its own. Loaded through vitest instead, a module this size spends seconds in its transform
 * and starves the test files running beside it.
 */
function runEach(file: string, read: Read, subjects: readonly unknown[]): unknown[] {
  const run = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", RUNNER, file, read, JSON.stringify(subjects)],
    { encoding: "utf8" },
  );
  if (run.status !== 0) expect.fail(run.stderr);
  return JSON.parse(run.stdout);
}

type Arm = readonly [pattern: string, result: string];

/** A program whose one `match` is over slot `subject`, and where what that match chose shows. */
type Position = {
  program: (decls: string, arms: readonly Arm[]) => string;
  read: Read;
};

const NO_WRITE = Symbol("no write");

/** What the match in `file` chose for each of `subjects`: the `seen` it wrote, or the text it rendered. */
function chosen(position: Position, file: string, subjects: readonly unknown[]): unknown[] {
  const observed = runEach(file, position.read, subjects);
  if (position.read === "text") return observed;
  return observed.map((slots) =>
    Object.hasOwn(slots as Slots, "seen") ? (slots as Slots).seen : NO_WRITE,
  );
}

const seenIn = (decls: string): string => `${decls}\nslot seen : Text = "unset"`;

const POSITIONS: Record<"an expression" | "a reducer statement" | "a tile body", Position> = {
  "an expression": {
    program: (decls, arms) =>
      withReducer(
        seenIn(decls),
        `seen := match subject with\n${arms.map(([p, r]) => `  | ${p} -> "${r}"`).join("\n")}`,
      ),
    read: "slots",
  },
  "a reducer statement": {
    program: (decls, arms) =>
      withReducer(
        seenIn(decls),
        `match subject with\n${arms.map(([p, r]) => `  | ${p} -> { seen := "${r}" }`).join("\n")}`,
      ),
    read: "slots",
  },
  "a tile body": {
    program: (decls, arms) =>
      withApp(`${decls}
tile App = match subject with
${arms.map(([p, r]) => `  | ${p} -> text("${r}")`).join("\n")}`),
    read: "text",
  },
};

const POSITION_CASES = Object.entries(POSITIONS);

const variant = (tag: string) => ({ _tag: tag });

describe("a match with 1,000 arms", () => {
  const ARMS = 1_000;
  const tags = Array.from({ length: ARMS }, (_, i) => `T${i}`);
  const decls = `type Big = ${tags.join(" | ")}\nslot subject : Big = T0`;
  const arms: Arm[] = tags.map((t, i) => [t, `arm ${i}`]);

  describe.each(POSITION_CASES)("as %s", (_name, position) => {
    const file = emitted(position.program(decls, arms));

    it("emits a module the engine parses", () => {
      expect(parseError(file())).toBe("");
    });

    it("runs the arm for the first, a middle and the last tag", RUNS, () => {
      const picks = [0, ARMS / 2, ARMS - 1];
      expect(
        chosen(
          position,
          file(),
          picks.map((i) => variant(`T${i}`)),
        ),
      ).toEqual(picks.map((i) => `arm ${i}`));
    });
  });
});

describe("a match whose arms overlap", () => {
  const decls = `type Light = Red | Green
slot subject : Tuple(Light, Light) = (Red, Red)`;
  const arms: Arm[] = [
    ["(Red, _)", "first"],
    ["(_, Green)", "second"],
    ["_", "rest"],
  ];
  const pair = (a: string, b: string) => [variant(a), variant(b)];

  describe.each(POSITION_CASES)("as %s", (_name, position) => {
    const file = emitted(position.program(decls, arms));

    it("emits a module the engine parses", () => {
      expect(parseError(file())).toBe("");
    });

    it("runs the first arm whose pattern holds, though a later one holds too", RUNS, () => {
      expect(chosen(position, file(), [pair("Red", "Green")])).toEqual(["first"]);
    });

    it("tries the arms in order, past one whose pattern fails", RUNS, () => {
      expect(chosen(position, file(), [pair("Green", "Green"), pair("Green", "Red")])).toEqual([
        "second",
        "rest",
      ]);
    });
  });
});

// This file's scrutinee has a declared union type, so a value match over it covers every value
// (E0227) and only a statement and a tile body reach the end of their arms. The panic a value
// match reaches is pinned in `match-exhaustive.test.ts`.
describe("a match no arm of which holds", () => {
  const decls = `type Light = Red | Amber | Green
slot subject : Light = Red`;
  const arms: Arm[] = [
    ["Red", "red"],
    ["Amber", "amber"],
  ];

  it.each<[keyof typeof POSITIONS, string, unknown]>([
    ["a reducer statement", "writes nothing", NO_WRITE],
    ["a tile body", "renders an empty text", ""],
  ])("as %s, %s", RUNS, (name, _does, outcome) => {
    const position = POSITIONS[name];
    const file = emit(position.program(decls, arms));
    expect(parseError(file)).toBe("");
    expect(chosen(position, file, [variant("Green")])).toEqual([outcome]);
  });
});

describe("a match statement inside an arm of another", () => {
  // Matches in a row label sibling blocks, which may share a label; a match nested in another,
  // directly, through an `if` or an `else`, or through a `for`, labels a block inside the
  // other's, which may not. So may a match nested in that one in turn.
  const file = emitted(
    withReducer(
      seenIn(`type Light = Red | Green
slot subject : Tuple(Light, Light) = (Red, Red)
slot deeper : Text = "unset"
slot after  : Text = "unset"
slot looped : Text = "unset"
slot last   : Text = "unset"`),
      `match subject with
  | (Red, inner) -> {
      match inner with
        | Red -> { seen := "red, red" }
        | other -> {
            seen := "red, other"
            match other with
              | Green -> { deeper := "deeper green" }
              | _ -> { deeper := "deeper other" }
          }
      if inner == Green then {
        match inner with
          | Green -> { after := "then green" }
          | _ -> { after := "then other" }
      } else {
        match inner with
          | Red -> { after := "else red" }
          | _ -> { after := "else other" }
      }
      for x in [inner] {
        match x with
          | Green -> { looped := "looped green" }
          | _ -> { looped := "looped other" }
      }
      last := "outer red"
    }
  | _ -> { last := "outer other" }`,
    ),
  );

  it("emits a module the engine parses", () => {
    expect(parseError(file())).toBe("");
  });

  it("runs the inner arm, then the rest of the outer arm", RUNS, () => {
    const [redGreen, redRed, greenRed] = runEach(file(), "slots", [
      [variant("Red"), variant("Green")],
      [variant("Red"), variant("Red")],
      [variant("Green"), variant("Red")],
    ]);
    expect(redGreen).toEqual({
      seen: "red, other",
      deeper: "deeper green",
      after: "then green",
      looped: "looped green",
      last: "outer red",
    });
    expect(redRed).toEqual({
      seen: "red, red",
      after: "else red",
      looped: "looped other",
      last: "outer red",
    });
    expect(greenRed).toEqual({ last: "outer other" });
  });
});
