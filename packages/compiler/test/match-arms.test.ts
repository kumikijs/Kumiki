// A `match` lowers to one `if` per arm, in source order, side by side: as an
// expression or a tile body each arm `return`s its value from the arrow the
// match is applied as, and as a statement in a reducer body each arm
// `break`s out of the block labelled around the arms. Nothing in the output
// nests once per arm, so a match with thousands of arms parses as readily as
// one with three.
//
// Whether the output parses is the half `compile` returning `ok` does not
// say, so every program here is compiled, written out, handed to
// `node --check`, then imported and run.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "@kumikijs/compiler";
import { afterAll, describe, expect, it } from "vitest";

const RUNTIME = { runtimeSpecifier: "@kumikijs/runtime", exportApp: true } as const;

const TMP_ROOT = resolve(__dirname, "test-tmp");
mkdirSync(TMP_ROOT, { recursive: true });
const made: string[] = [];
// Removed whatever the outcome: a 2,000-arm module is hundreds of kilobytes.
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

/**
 * The stack, in KiB, `node --check` parses each module with: a quarter of
 * V8's default. How many nested statements the default holds differs from one
 * machine to the next — under two thousand on one, several thousand on
 * another — so the check fixes the stack rather than inherit it. Under this
 * one, on Linux x64, a chain that nests once per arm runs out at about 1,400
 * arms, while output whose depth does not depend on the arm count needs no
 * more stack for 2,000 arms than for 3, which is about what Node itself needs
 * to start.
 */
const STACK_KB = 256;

// A real module load overruns the 5s default on a cold cache.
const LOADS = { timeout: 60_000 } as const;

type Slots = Record<string, unknown>;
type TileNode = { kind: string; text?: string };
type LoadedApp = {
  live: Slots;
  reducers: { name: string; apply: (live: Slots, payload: Slots) => { slots: Slots } }[];
  routes: { pattern: string; tile: () => TileNode }[];
};

/**
 * Compile `source` and write the module out, on first use. Answers the file;
 * each test that reads it asks for it, so a program that does not compile
 * fails those tests rather than the collection of the file.
 */
function emitted(source: string): () => string {
  let file: string | undefined;
  return () => {
    file ??= emit(source);
    return file;
  };
}

function emit(source: string): string {
  const result = compile(source, RUNTIME);
  if (result.kind !== "ok")
    expect.fail(result.errors.map((e) => `${e.code} ${e.message}`).join("\n"));
  const dir = mkdtempSync(join(TMP_ROOT, "match-arms-"));
  made.push(dir);
  const file = join(dir, "app.mjs");
  writeFileSync(file, result.js);
  return file;
}

/** What `node --check` reports about `file`: "" when it parses, its error line otherwise. */
function parseError(file: string): string {
  const run = spawnSync(process.execPath, [`--stack-size=${STACK_KB}`, "--check", file], {
    encoding: "utf8",
  });
  if (run.status === 0) return "";
  return run.stderr.split("\n").find((l) => /Error/.test(l)) ?? `exit ${run.status}`;
}

async function load(file: string): Promise<LoadedApp> {
  const mod: { createApp: () => LoadedApp } = await import(
    `${pathToFileURL(file).href}?t=${Date.now()}`
  );
  return mod.createApp();
}

/** One arm: its pattern, and the text the arm answers when it is the one that runs. */
type Arm = readonly [pattern: string, result: string];

/**
 * A program whose one `match` is over slot `subject`, in one of the three
 * positions a match is lowered from, and a way to run it: `chosen` puts a
 * value in `subject` and answers what the match did with it.
 */
type Position = {
  program: (decls: string, arms: readonly Arm[]) => string;
  chosen: (app: LoadedApp, subject: unknown) => unknown;
};

const reducerProgram = (decls: string, body: string): string => `${decls}
slot seen : Text = "unset"
reducer pick on=ui.click(B) do= ${body}
tile B = button(text="b", onClick=pick)
tile Page = column(B)
app A caps=[] routes={"/" -> Page, "/404" -> Page} init=[]
`;

/** `pick`'s writes, applied with `subject` in the live slots. */
function picked(app: LoadedApp, subject: unknown): Slots {
  app.live.subject = subject;
  const pick = app.reducers.find((r) => r.name === "pick");
  if (!pick) expect.fail("the compiled module has no reducer named pick");
  return pick.apply(app.live, {}).slots;
}

/** What `seen` was written to, or `NO_WRITE` when the reducer left it alone. */
const NO_WRITE = Symbol("no write");
function seenWrite(slots: Slots): unknown {
  return Object.hasOwn(slots, "seen") ? slots.seen : NO_WRITE;
}

const POSITIONS: Record<"an expression" | "a reducer statement" | "a tile body", Position> = {
  "an expression": {
    program: (decls, arms) =>
      reducerProgram(
        decls,
        `seen := match subject with\n${arms.map(([p, r]) => `  | ${p} -> "${r}"`).join("\n")}`,
      ),
    chosen: (app, subject) => seenWrite(picked(app, subject)),
  },
  "a reducer statement": {
    program: (decls, arms) =>
      reducerProgram(
        decls,
        `match subject with\n${arms.map(([p, r]) => `  | ${p} -> { seen := "${r}" }`).join("\n")}`,
      ),
    chosen: (app, subject) => seenWrite(picked(app, subject)),
  },
  "a tile body": {
    program: (decls, arms) => `${decls}
tile Shown = match subject with
${arms.map(([p, r]) => `  | ${p} -> text("${r}")`).join("\n")}
tile Missing = text("missing")
app A caps=[] routes={"/" -> Shown, "/404" -> Missing} init=[]
`,
    chosen: (app, subject) => {
      app.live.subject = subject;
      const route = app.routes.find((r) => r.pattern === "/");
      if (!route) expect.fail("the compiled module has no route for /");
      return route.tile().text;
    },
  },
};

const variant = (tag: string) => ({ _tag: tag });

describe("a match with 2,000 arms", () => {
  const ARMS = 2_000;
  const tags = Array.from({ length: ARMS }, (_, i) => `T${i}`);
  const decls = `type Big = ${tags.join(" | ")}\nslot subject : Big = T0`;
  const arms: Arm[] = tags.map((t, i) => [t, `arm ${i}`]);

  for (const [name, position] of Object.entries(POSITIONS)) {
    describe(`as ${name}`, () => {
      const file = emitted(position.program(decls, arms));

      it("emits a module the engine parses", () => {
        expect(parseError(file())).toBe("");
      });

      it("runs the arm for the first, a middle and the last tag", LOADS, async () => {
        const app = await load(file());
        for (const i of [0, 1_000, ARMS - 1]) {
          expect(position.chosen(app, variant(`T${i}`))).toBe(`arm ${i}`);
        }
      });
    });
  }
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

  for (const [name, position] of Object.entries(POSITIONS)) {
    describe(`as ${name}`, () => {
      const file = emitted(position.program(decls, arms));

      it("emits a module the engine parses", () => {
        expect(parseError(file())).toBe("");
      });

      it(
        "runs the first arm whose pattern holds, though a later one holds too",
        LOADS,
        async () => {
          // `(Red, Green)` fits the first arm and the second; the second never runs.
          expect(position.chosen(await load(file()), pair("Red", "Green"))).toBe("first");
        },
      );

      it("tries the arms in order, past one whose pattern fails", LOADS, async () => {
        const app = await load(file());
        expect(position.chosen(app, pair("Green", "Green"))).toBe("second");
        expect(position.chosen(app, pair("Green", "Red"))).toBe("rest");
      });
    });
  }
});

describe("a match no arm of which holds", () => {
  const decls = `type Light = Red | Amber | Green
slot subject : Light = Red`;
  const arms: Arm[] = [
    ["Red", "red"],
    ["Amber", "amber"],
  ];
  const OUTCOMES: readonly [position: keyof typeof POSITIONS, does: string, outcome: unknown][] = [
    ["an expression", "answers undefined, which the assignment writes", undefined],
    ["a reducer statement", "writes nothing", NO_WRITE],
    ["a tile body", "renders an empty text", ""],
  ];

  for (const [name, does, outcome] of OUTCOMES) {
    it(`as ${name}, ${does}`, LOADS, async () => {
      const position = POSITIONS[name];
      const file = emit(position.program(decls, arms));
      expect(parseError(file)).toBe("");
      expect(position.chosen(await load(file), variant("Green"))).toBe(outcome);
    });
  }
});

describe("a match statement inside an arm of another", () => {
  // Each inner match leaves its own block, not the outer one: the statements
  // after it in the outer arm still run. Matches in a row label sibling
  // blocks, which may share a label; a match nested in another — directly,
  // or through an `if` or a `for` — labels a block inside the other's, which
  // may not.
  const source = `type Light = Red | Green
slot subject : Tuple(Light, Light) = (Red, Red)
slot seen   : Text = "unset"
slot after  : Text = "unset"
slot looped : Text = "unset"
slot last   : Text = "unset"
reducer pick on=ui.click(B) do= match subject with
  | (Red, inner) -> {
      match inner with
        | Red -> { seen := "red, red" }
        | _ -> { seen := "red, other" }
      if true then {
        match inner with
          | Green -> { after := "then green" }
          | _ -> { after := "then other" }
      }
      for x in [inner] {
        match x with
          | Green -> { looped := "looped green" }
          | _ -> { looped := "looped other" }
      }
      last := "outer red"
    }
  | _ -> { last := "outer other" }
tile B = button(text="b", onClick=pick)
tile Page = column(B)
app A caps=[] routes={"/" -> Page, "/404" -> Page} init=[]
`;
  const file = emitted(source);

  it("emits a module the engine parses", () => {
    expect(parseError(file())).toBe("");
  });

  it("runs the inner arm, then the rest of the outer arm", LOADS, async () => {
    const app = await load(file());
    expect(picked(app, [variant("Red"), variant("Green")])).toEqual({
      seen: "red, other",
      after: "then green",
      looped: "looped green",
      last: "outer red",
    });
    expect(picked(app, [variant("Green"), variant("Red")])).toEqual({ last: "outer other" });
  });
});
