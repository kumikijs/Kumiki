import { compile, ParseError } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { compileOrFail, parseErrorOn, writeTmpFile } from "./helpers/module.ts";
import { withRoot } from "./helpers/programs.ts";
import { scratchRoot } from "./helpers/scratch.ts";

const TMP = scratchRoot(import.meta.url);

// CI runs on Linux, where V8 parsed the same modules up to 1.3 times as deep as on Windows, so
// each module is parsed on 77% of V8's default 984 KB stack rather than on the one it inherits.
const STACK_KB = 757;

// Each check starts a `node` process.
const RUNS = { timeout: 60_000 } as const;

const DEFS = `slot xs : List(Int) = [1]
slot flag : Bool = true
slot o : Option(Int) = Some(1)`;

type Nest = {
  name: string;
  /** How many levels of `wrap` one definition may hold. */
  deepest: number;
  wrap: (tree: string, level: number) => string;
};

const NESTS: readonly Nest[] = [
  { name: "a for in a for", deepest: 250, wrap: (t, l) => `for a${l} in xs ${t}` },
  { name: "a when in a when", deepest: 250, wrap: (t) => `when(flag, ${t})` },
  { name: "an if in an if", deepest: 250, wrap: (t) => `if flag then ${t} else text("n")` },
  {
    name: "a match in a match",
    deepest: 250,
    wrap: (t, l) => `match o with | Some(v${l}) -> ${t} | None -> text("n")`,
  },
  { name: "a for over a column", deepest: 83, wrap: (t, l) => `for a${l} in xs column(${t})` },
  { name: "a column in a column", deepest: 251, wrap: (t) => `column(${t})` },
];

/** `App`, a column holding `depth` levels of `wrap` around a text. */
function nested({ wrap }: Nest, depth: number): string {
  let tree = 'text("x")';
  for (let level = depth - 1; level >= 0; level--) tree = wrap(tree, level);
  return withRoot(tree, DEFS);
}

describe.each(NESTS)("$name", (nest) => {
  it("is refused by the parser one level deeper", () => {
    expect(() => compile(nested(nest, nest.deepest + 1), { runtimeSpecifier: "x" })).toThrow(
      ParseError,
    );
  });

  it(
    "compiles at its deepest to a module that parses on a stack as small as Windows'",
    RUNS,
    () => {
      const js = compileOrFail(nested(nest, nest.deepest));
      expect(parseErrorOn(STACK_KB, writeTmpFile(TMP, "nest", "app.mjs", js))).toBe("");
    },
  );
});
