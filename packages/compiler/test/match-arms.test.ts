import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { compileOrFail, LOADABLE, type ReducerShape, writeTmpFile } from "./helpers/module.ts";
import { withApp } from "./helpers/programs.ts";

const made: string[] = [];
// A 2,000-arm module is hundreds of kilobytes.
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

// A quarter of V8's default. How many nested statements the default holds differs from one
// machine to the next, so the check fixes the stack rather than inherit it.
const STACK_KB = 256;

// A real module load overruns the 5s default on a cold cache.
const LOADS = { timeout: 60_000 } as const;

type Slots = Record<string, unknown>;
type TileNode = { kind: string; text?: string };
type LoadedApp = {
  live: Slots;
  reducers: ReducerShape[];
  routes: { pattern: string; tile: () => TileNode }[];
};

function emit(source: string): string {
  const file = writeTmpFile("match-arms", "app.mjs", compileOrFail(source, LOADABLE));
  made.push(dirname(file));
  return file;
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

async function load(file: string): Promise<LoadedApp> {
  const mod: { createApp: () => LoadedApp } = await import(
    `${pathToFileURL(file).href}?t=${Date.now()}`
  );
  return mod.createApp();
}

type Arm = readonly [pattern: string, result: string];

/** A program whose one `match` is over slot `subject`, and what that match did with a given subject. */
type Position = {
  program: (decls: string, arms: readonly Arm[]) => string;
  chosen: (app: LoadedApp, subject: unknown) => unknown;
};

const reducerProgram = (decls: string, body: string): string =>
  withApp(`${decls}
slot seen : Text = "unset"
reducer pick on=ui.click(B) do= ${body}
tile B = button(text="b", onClick=pick)
tile App = column(B)`);

function picked(app: LoadedApp, subject: unknown): Slots {
  app.live.subject = subject;
  const pick = app.reducers.find((r) => r.name === "pick");
  if (!pick) expect.fail("the compiled module has no reducer named pick");
  return pick.apply(app.live, {}).slots;
}

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

const POSITION_CASES = Object.entries(POSITIONS);

const variant = (tag: string) => ({ _tag: tag });

describe("a match with 2,000 arms", () => {
  const ARMS = 2_000;
  const tags = Array.from({ length: ARMS }, (_, i) => `T${i}`);
  const decls = `type Big = ${tags.join(" | ")}\nslot subject : Big = T0`;
  const arms: Arm[] = tags.map((t, i) => [t, `arm ${i}`]);

  describe.each(POSITION_CASES)("as %s", (_name, position) => {
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

    it("runs the first arm whose pattern holds, though a later one holds too", LOADS, async () => {
      expect(position.chosen(await load(file()), pair("Red", "Green"))).toBe("first");
    });

    it("tries the arms in order, past one whose pattern fails", LOADS, async () => {
      const app = await load(file());
      expect(position.chosen(app, pair("Green", "Green"))).toBe("second");
      expect(position.chosen(app, pair("Green", "Red"))).toBe("rest");
    });
  });
});

describe("a match no arm of which holds", () => {
  const decls = `type Light = Red | Amber | Green
slot subject : Light = Red`;
  const arms: Arm[] = [
    ["Red", "red"],
    ["Amber", "amber"],
  ];

  it.each<[keyof typeof POSITIONS, string, unknown]>([
    ["an expression", "answers undefined, which the assignment writes", undefined],
    ["a reducer statement", "writes nothing", NO_WRITE],
    ["a tile body", "renders an empty text", ""],
  ])("as %s, %s", LOADS, async (name, _does, outcome) => {
    const position = POSITIONS[name];
    const file = emit(position.program(decls, arms));
    expect(parseError(file)).toBe("");
    expect(position.chosen(await load(file), variant("Green"))).toBe(outcome);
  });
});

describe("a match statement inside an arm of another", () => {
  // Matches in a row label sibling blocks, which may share a label; a match nested in another,
  // directly or through an `if` or a `for`, labels a block inside the other's, which may not.
  const file = emitted(
    reducerProgram(
      `type Light = Red | Green
slot subject : Tuple(Light, Light) = (Red, Red)
slot after  : Text = "unset"
slot looped : Text = "unset"
slot last   : Text = "unset"`,
      `match subject with
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
  | _ -> { last := "outer other" }`,
    ),
  );

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
