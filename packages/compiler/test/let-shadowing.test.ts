// A reducer's top-level `let` lands in the same JS block as the trigger's binds
// and the positional-binding declarations codegen seeds, so a `let` that took a
// name already declared there emitted a second `const` for it and the whole
// module threw `SyntaxError: Identifier '…' has already been declared` at load
// — with `check` and `build` clean. The language's answer to a name written
// twice is that the inner binding shadows the outer one (errors.md E0119: "a
// name an enclosing `let` or pattern binds is that binding, not the payload"),
// and the nested forms implemented it already; only the top level did not.
//
// These assert on the emitted module actually loading and its reducer computing
// the right next state, because that is the half `check` and `build` never saw.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { check, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { jsBinding } from "../src/codegen/context.ts";
import { RESERVED_BIND_NAMES } from "../src/reserved-binds.ts";

const RUNTIME = { runtimeSpecifier: "@kumikijs/runtime", exportApp: true } as const;

const TMP_ROOT = resolve(__dirname, "test-tmp");
mkdirSync(TMP_ROOT, { recursive: true });

type ReducerShape = {
  name: string;
  apply: (
    live: Record<string, unknown>,
    payload: Record<string, unknown>,
  ) => { slots: Record<string, unknown> };
};

/**
 * A program whose one reducer is `subject`. `on` is the whole trigger and
 * `body` the whole `do=` clause; an `on` naming `ping` gets the effect that
 * declares it.
 */
function program(on: string, body: string): string {
  const usesEffect = on.startsWith("ping.");
  const effect = usesEffect
    ? `effect ping cap=log.write
            in=Unit
            out=Result(Text, Text)
            map-request={level: "info", message: "ping"}

`
    : "";
  return `slot seen  : Text = ""
slot after : Text = ""
slot flag  : Bool = true
slot total : Int  = 0

${effect}reducer subject
    on=${on}
    do= ${body}

tile Page = column(text(seen))

app A
    caps   = [${usesEffect ? "log.write" : ""}]
    routes = {"/" -> Page, "/404" -> Page}
    init   = []
`;
}

/**
 * Compile, write the module to disk and `import()` it, then apply `subject`.
 * The import is what a duplicate declaration fails: it throws at parse time,
 * before a line of the module runs.
 */
async function apply(
  source: string,
  payload: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = compile(source, RUNTIME);
  if (result.kind !== "ok")
    expect.fail(result.errors.map((e) => `${e.code} ${e.message}`).join("\n"));
  const dir = mkdtempSync(join(TMP_ROOT, "let-shadow-"));
  const file = join(dir, "app.mjs");
  writeFileSync(file, result.js);
  const mod: { createApp: () => { reducers: ReducerShape[] } } = await import(
    `${pathToFileURL(file).href}?t=${Date.now()}`
  );
  const reducer = mod.createApp().reducers.find((r) => r.name === "subject");
  if (!reducer) expect.fail("the compiled module has no reducer named subject");
  return reducer.apply({ seen: "", after: "" }, payload).slots;
}

/** What the `seen` slot holds after one application of `subject`. */
async function seenAfter(source: string, payload: Record<string, unknown> = {}): Promise<unknown> {
  return (await apply(source, payload)).seen;
}

// Writing a module to disk and importing it costs a real module load, which
// overruns the 5s default on a cold cache.
const LOADS = { timeout: 30_000 } as const;

describe("a top-level `let` over a positional binding", () => {
  for (const name of RESERVED_BIND_NAMES.keys()) {
    it(`shadows ${name} instead of colliding with it`, LOADS, async () => {
      expect(
        await seenAfter(program("app.start", `let ${name} = "x"\n        seen := ${name}`)),
      ).toBe("x");
    });
  }

  it("leaves one declaration of each reserved name in the emitted module", LOADS, async () => {
    const result = compile(
      program("app.start", 'let $route = "x"\n        seen := $route'),
      RUNTIME,
    );
    if (result.kind !== "ok") expect.fail(result.errors.map((e) => e.code).join("\n"));
    // The shadow takes an identifier of its own, so the seeded declaration is
    // still the only one under the name the seed uses.
    for (const name of RESERVED_BIND_NAMES.keys()) {
      expect(result.js.split(`const ${jsBinding(name)} =`).length - 1).toBe(1);
    }
  });
});

describe("a top-level `let` over a trigger's bind", () => {
  it("shadows the bind for the reads that follow it", LOADS, async () => {
    const src = program("ping.ok($m, _)", 'let $m = "shadow"\n        seen := $m');
    expect(await seenAfter(src, { $1: "payload" })).toBe("shadow");
  });

  it("leaves the reads before it reading the payload", LOADS, async () => {
    const src = program(
      "ping.ok($m, _)",
      'seen := $m\n        let $m = "shadow"\n        after := $m',
    );
    expect(await apply(src, { $1: "payload" })).toEqual({ seen: "payload", after: "shadow" });
  });

  it("evaluates its own right-hand side against the binding it shadows", LOADS, async () => {
    // `let $m = $m + "!"` reads the outer binding: the new one is not in scope
    // until the statement that declares it has run.
    const src = program("ping.ok($m, _)", 'let $m = $m + "!"\n        seen := $m');
    expect(await seenAfter(src, { $1: "payload" })).toBe("payload!");
  });

  it("shadows a plain bind, not just a `$`-prefixed one", LOADS, async () => {
    const src = program("ping.ok(m, _)", 'let m = "shadow"\n        seen := m');
    expect(await seenAfter(src, { $1: "payload" })).toBe("shadow");
  });
});

describe("a top-level `let` over an earlier `let`", () => {
  it("shadows it for the reads that follow", LOADS, async () => {
    const src = program(
      "app.start",
      'let n = "first"\n        let n = "second"\n        seen := n',
    );
    expect(await seenAfter(src)).toBe("second");
  });

  it("reads the earlier one on its own right-hand side", LOADS, async () => {
    const src = program(
      "app.start",
      'let n = "first"\n        let n = n + "/second"\n        seen := n',
    );
    expect(await seenAfter(src)).toBe("first/second");
  });
});

describe("the nested forms shadow as they always did", () => {
  it("binds a `for` over a name already in scope", LOADS, async () => {
    const src = program("ping.ok($m, _)", 'for $m in ["a", "b"]\n          seen := seen + $m');
    expect(await seenAfter(src, { $1: "payload" })).toBe("ab");
  });

  it("binds a match arm over a name already in scope", LOADS, async () => {
    const src = program(
      "ping.ok($m, _)",
      'match Some("arm") with\n          | Some($m) -> seen := $m\n          | None     -> seen := "none"',
    );
    expect(await seenAfter(src, { $1: "payload" })).toBe("arm");
  });

  it("binds a `let … in` expression over a name already in scope", LOADS, async () => {
    const src = program("ping.ok($m, _)", 'seen := let $m = "inner" in $m');
    expect(await seenAfter(src, { $1: "payload" })).toBe("inner");
  });

  it("evaluates a `let … in` right-hand side against the binding it shadows", LOADS, async () => {
    const src = program("ping.ok($m, _)", 'seen := let $m = $m + "!" in $m');
    expect(await seenAfter(src, { $1: "payload" })).toBe("payload!");
  });
});

describe("a shadow ends with the scope that declared it", () => {
  it("gives the name back after a `for` body", LOADS, async () => {
    const src = program("ping.ok($m, _)", 'for $m in ["a"] { seen := $m }\n        after := $m');
    expect(await apply(src, { $1: "payload" })).toEqual({ seen: "a", after: "payload" });
  });

  it("gives the name back after a match arm", LOADS, async () => {
    const src = program(
      "ping.ok($m, _)",
      'match Some("arm") with\n          | Some($m) -> { seen := $m }\n          | None     -> { seen := "none" }\n        after := $m',
    );
    expect(await apply(src, { $1: "payload" })).toEqual({ seen: "arm", after: "payload" });
  });

  it("keeps a top-level `let` visible to the nested scopes that follow it", LOADS, async () => {
    const src = program(
      "ping.ok($m, _)",
      'let $m = "shadow"\n        for x in ["a"]\n          seen := $m + x',
    );
    expect(await seenAfter(src, { $1: "payload" })).toBe("shadowa");
  });
});

describe("a binding declared inside a branch stays inside it", () => {
  // Both branches of an `if`, and a match's catch-all arm, are blocks of their
  // own in the emitted module. A shadow declared in one is out of scope on the
  // statement after it, so the name has to mean the outer binding again there.
  it("gives the name back after an `if`", LOADS, async () => {
    const src = program(
      "app.start",
      'let n = "outer"\n        if flag then { let n = "inner"\n                       seen := n }\n                else { seen := "no" }\n        after := n',
    );
    expect(await apply(src)).toEqual({ seen: "inner", after: "outer" });
  });

  it("gives the name back after a catch-all match arm", LOADS, async () => {
    const src = program(
      "app.start",
      'let n = "outer"\n        match Some("some") with\n          | Some(v) -> { seen := v }\n          | _       -> { let n = "inner"\n                         seen := n }\n        after := n',
    );
    expect(await apply(src)).toEqual({ seen: "some", after: "outer" });
  });
});

/**
 * A program whose one reducer's `do=` clause is `body`, with a union and a
 * tuple in scope so a pattern's binds can be written out in full.
 */
function matching(body: string): string {
  return `type Pair = Both(Text, Text) | Neither

slot note : Text     = ""
slot p    : Pair     = Both("first", "second")
slot pair : Tuple(Text, Text) = ("a", "b")

reducer subject on=app.start
    do= ${body}

tile Page = column(text(note))

app A
    caps   = []
    routes = {"/" -> Page, "/404" -> Page}
    init   = []
`;
}

const codes = (source: string): string[] => check(parse(lex(source))).map((e) => e.code);

describe("a pattern's binds are peers, not a shadowing pair", () => {
  // Nothing nests two binds of one pattern, so there is no scope between them
  // for the second to shadow the first — the same reason a bind list cannot
  // take a positional binding's name (E0121). Left to `declareBind` the repeat
  // would take an identifier of its own and the arm would silently read the
  // second positional, with `check` and `smoke` both clean; before the
  // shadowing rule reached patterns it was a module that did not load.
  it("reports a name bound twice in one variant pattern", () => {
    expect(
      codes(
        matching(`match p with
          | Both(a, a) -> { note := a }
          | Neither    -> { note := "none" }`),
      ),
    ).toEqual(["E0122"]);
  });

  it("reports one bound twice across a tuple pattern's items", () => {
    expect(
      codes(
        matching(`match pair with
          | (dup, dup) -> { note := dup }`),
      ),
    ).toEqual(["E0122"]);
  });

  it("leaves `_` alone, however many times it is written", () => {
    expect(
      codes(
        matching(`match p with
          | Both(_, _) -> { note := "both" }
          | Neither    -> { note := "none" }`),
      ),
    ).toEqual([]);
  });

  it("leaves a bind that shadows a name outside the pattern alone", () => {
    expect(
      codes(
        matching(`let outer = "x"
        match p with
          | Both(outer, b) -> { note := outer + b }
          | Neither        -> { note := "none" }`),
      ),
    ).toEqual([]);
  });

  it("leaves two arms that bind the same name alone", () => {
    expect(
      codes(
        matching(`match p with
          | Both(a, _) -> { note := a }
          | Neither    -> { note := "none" }`),
      ),
    ).toEqual([]);
  });
});

/**
 * Every diagnostic `check` reports: its code, the name its message quotes, and
 * the source from its position to the end of that line.
 */
function diagnostics(source: string): { code: string; name: string; at: string }[] {
  const lines = source.split("\n");
  return check(parse(lex(source))).map((e) => ({
    code: e.code,
    name: /"([^"]+)"/.exec(e.message)?.[1] ?? "",
    at: e.pos ? (lines[e.pos.line - 1]?.slice(e.pos.col - 1) ?? "") : "",
  }));
}

describe("the checker scopes each `if` branch as codegen does", () => {
  // language.md §1.6.7: "each branch of an `if`" is a scope, and a binding
  // declared in one ends with it. Codegen emits each branch as a block of its
  // own, so a read `check` let through would resolve to nothing and throw
  // `n is not defined` the first time the reducer ran.
  it("reports a branch-local `let` read after the `if` as E0103 at the read", () => {
    const src = program(
      "app.start",
      'if flag then { let n = "inner" } else { let n = "other" }\n        seen := n',
    );
    expect(diagnostics(src)).toEqual([{ code: "E0103", name: "n", at: "n" }]);
  });

  it("reports one declared in only one branch and read after the `if`", () => {
    const src = program(
      "app.start",
      'if flag then { let n = "inner" } else { () }\n        seen := n',
    );
    expect(diagnostics(src)).toEqual([{ code: "E0103", name: "n", at: "n" }]);
  });

  it("does not carry a `let` from the `then` branch into the `else` branch", () => {
    const src = program("app.start", 'if flag then { let n = "inner" } else { seen := n }');
    expect(diagnostics(src)).toEqual([{ code: "E0103", name: "n", at: "n }" }]);
  });

  it("still counts a slot written in both branches as written after the `if` (E0601)", () => {
    const src = program(
      "app.start",
      'if flag then { seen := "a" } else { seen := "b" }\n        seen := "c"',
    );
    expect(codes(src)).toEqual(["E0601"]);
  });

  it("still lets each branch write the slot the other one writes", () => {
    const src = program("app.start", 'if flag then { seen := "a" } else { seen := "b" }');
    expect(codes(src)).toEqual([]);
  });
});

describe("an E0103 for a name read after its scope ended names the scope", () => {
  // A read after the scope that declared the name — a reducer's `if` branch,
  // `for` body or match arm, or an expression's: a `let … in` body, a `match`
  // expression's arm, a tile's `for` body — is E0103 like a misspelling, but
  // renaming it to a close name is not the repair: the renamed read
  // type-checks and reads another value. So the diagnostic says which scope it
  // was, in `endedScope` for a reader such as `kumiki fix`, and in the message
  // for the author.
  const undefinedNames = (source: string) =>
    check(parse(lex(source)))
      .filter((e) => e.code === "E0103")
      .map((e) => ({ endedScope: e.endedScope, message: e.message }));
  const HINTS: Record<string, string> = {
    if: 'it is scoped to an "if" branch, which ends with it: declare it before the "if", or move the read into the branch',
    for: 'it is scoped to a "for" body, which ends with it: declare it before the "for", or move the read into the body',
    match:
      'it is scoped to a match arm, which ends with it: declare it before the "match", or move the read into the arm',
    "let-in":
      'it is scoped to the body of a "let … in", which ends with it: move the read into that body, or bind it where both reads see it',
    "for-expr": `it is scoped to a tile's "for" body, which ends with it: move the read into the body`,
    "match-expr":
      'it is scoped to an arm of a "match" expression, which ends with it: move the read into the arm',
  };
  /** The program with `tile` as its page's body, beside a reducer that reads nothing. */
  const page = (tile: string) => program("app.start", "()").replace("column(text(seen))", tile);
  const hinted = (name: string, scope: string) => ({
    endedScope: scope,
    message: `Reference to undefined name "${name}" — ${HINTS[scope]} (see docs/spec/language.md §1.6.7)`,
  });

  it("names the `for` body for a loop variable read after the loop", () => {
    const src = program("app.start", "for idx in [1] { () }\n        total := idx");
    expect(undefinedNames(src)).toEqual([hinted("idx", "for")]);
  });

  it("names the `for` body for a `let` it declared", () => {
    const src = program("app.start", "for x in [1] { let n = x }\n        total := n");
    expect(undefinedNames(src)).toEqual([hinted("n", "for")]);
  });

  it("names the `if` branch for a `let` read after the `if`", () => {
    const src = program("app.start", "if flag then { let n = 1 } else { () }\n        total := n");
    expect(undefinedNames(src)).toEqual([hinted("n", "if")]);
  });

  it("names the `if` branch for a `let` the `else` branch declared", () => {
    const src = program("app.start", "if flag then { () } else { let n = 1 }\n        total := n");
    expect(undefinedNames(src)).toEqual([hinted("n", "if")]);
  });

  it("names the `if` branch for a read in the other branch", () => {
    const src = program("app.start", "if flag then { let n = 1 } else { total := n }");
    expect(undefinedNames(src)).toEqual([hinted("n", "if")]);
  });

  it("names the match arm for a pattern variable read after the match", () => {
    const src = program(
      "app.start",
      "match Some(1) with\n          | Some(v) -> { () }\n          | None    -> { () }\n        total := v",
    );
    expect(undefinedNames(src)).toEqual([hinted("v", "match")]);
  });

  it("names the match arm for a `let` a catch-all arm declared", () => {
    const src = program(
      "app.start",
      "match Some(1) with\n          | Some(v) -> { () }\n          | _       -> { let n = 2 }\n        total := n",
    );
    expect(undefinedNames(src)).toEqual([hinted("n", "match")]);
  });

  it("names the innermost body when the one that declared it is nested", () => {
    const src = program(
      "app.start",
      "for x in [1] {\n          if flag then { let n = x } else { () }\n        }\n        total := n",
    );
    expect(undefinedNames(src)).toEqual([hinted("n", "if")]);
  });

  it("names a body nested in a branch for a read later in that branch", () => {
    const src = program(
      "app.start",
      "if flag then {\n          for i in [1] { () }\n          total := i\n        } else { () }",
    );
    expect(undefinedNames(src)).toEqual([hinted("i", "for")]);
  });

  it("keeps the hint when a name in scope is one edit away", () => {
    // `seed` is one edit from the slot `seen`, which is the case the
    // arithmetic hint stands down for. This one does not: the checker knows
    // the name was declared and has ended, so a rename is wrong regardless.
    const src = program("app.start", 'for seed in ["a"] { () }\n        seen := seed');
    expect(undefinedNames(src)).toEqual([hinted("seed", "for")]);
  });

  it("keeps the message of a misspelling no body declared", () => {
    const src = program("app.start", "for x in [1] { () }\n        total := totl");
    expect(undefinedNames(src)).toEqual([
      { endedScope: undefined, message: 'Reference to undefined name "totl"' },
    ]);
  });

  it("does not carry a body's names into another reducer", () => {
    const src = program("app.start", "for idx in [1] { () }").replace(
      "tile Page",
      "reducer other on=app.stop do= total := idx\n\ntile Page",
    );
    expect(undefinedNames(src)).toEqual([
      { endedScope: undefined, message: 'Reference to undefined name "idx"' },
    ]);
  });

  it("reads the slot a branch's `let` shadowed once the branch ends", () => {
    const src = program(
      "app.start",
      "if flag then { let total = 5\n                       seen := total.show } else { () }\n        total := total + 1",
    );
    expect(codes(src)).toEqual([]);
  });

  it("names the `let … in` body for its name read in a later statement", () => {
    const src = program("app.start", 'seen := let n = "a" in n\n        after := n');
    expect(undefinedNames(src)).toEqual([hinted("n", "let-in")]);
  });

  it("names the `let … in` body, not a statement body around it", () => {
    const src = program(
      "app.start",
      'for x in [1] { seen := let n = "a" in n }\n        after := n',
    );
    expect(undefinedNames(src)).toEqual([hinted("n", "let-in")]);
  });

  it("names the `let … in` body for its name read after it in a `fn`", () => {
    const src = program("app.start", "()").replace(
      "tile Page",
      "fn twice(x: Int) -> Int = (let n = x in n) + n\n\ntile Page",
    );
    expect(undefinedNames(src)).toEqual([hinted("n", "let-in")]);
  });

  it("names the `let … in` body in a slot initializer", () => {
    const src = program("app.start", "()").replace(
      'slot after : Text = ""',
      'slot after : Text = (let n = "a" in n) + n',
    );
    expect(undefinedNames(src)).toEqual([hinted("n", "let-in")]);
  });

  it("names the arm of a `match` expression for its variable read in a later statement", () => {
    const src = program(
      "app.start",
      'seen := match Some("a") with | Some(v) -> v | None -> ""\n        after := v',
    );
    expect(undefinedNames(src)).toEqual([hinted("v", "match-expr")]);
  });

  it("names a tile's `for` body for its variable read in a sibling", () => {
    const src = page("column(for idx in [1] text(idx.show), text(idx.show))");
    expect(undefinedNames(src)).toEqual([hinted("idx", "for-expr")]);
  });

  it("names the arm of a tile's `match` for its variable read in a sibling", () => {
    const src = page(
      'column(match Some(1) with | Some(v) -> text(v.show) | None -> text("none"), text(v.show))',
    );
    expect(undefinedNames(src)).toEqual([hinted("v", "match-expr")]);
  });

  it("keeps the message of a misspelling beside a sibling's read", () => {
    const src = page("column(for idx in [1] text(idx.show), text(idx.show), text(sen))");
    expect(undefinedNames(src)).toEqual([
      hinted("idx", "for-expr"),
      { endedScope: undefined, message: 'Reference to undefined name "sen"' },
    ]);
  });

  it("does not carry an expression's names into another tile", () => {
    const src = page("column(for idx in [1] text(idx.show))").replace(
      "app A",
      "tile Other = text(idx.show)\n\napp A",
    );
    expect(undefinedNames(src)).toEqual([
      { endedScope: undefined, message: 'Reference to undefined name "idx"' },
    ]);
  });
});

describe("a branch's `let` leaves the type of the name after the `if` alone", () => {
  // A scope carries the names it binds and the types it gives them, and both
  // end with the branch. The outer `n` is an Int and the branch's is Text, so a
  // branch whose types leaked would hand Text to the statements after the
  // `if`: the valid write to an Int slot would be rejected, and the outer Int
  // written into a Text slot would pass.
  const shadowed = (write: string): string =>
    program(
      "app.start",
      `let n = 5\n        if flag then { let n = "s"\n                       seen := n }\n                else { () }\n        ${write}`,
    );

  it("accepts the outer Int written to an Int slot after the `if`", LOADS, async () => {
    const src = shadowed("total := n");
    expect(codes(src)).toEqual([]);
    expect(await apply(src)).toMatchObject({ seen: "s", total: 5 });
  });

  it("reports the outer Int written to a Text slot after the `if` as E0201", () => {
    expect(diagnostics(shadowed("after := n")).map((d) => d.code)).toEqual(["E0201"]);
  });

  it("ends a branch's `$route` shadow with the branch (E0119)", () => {
    // `$route` resolves through the positional-bind gate rather than the
    // undefined-name one, so it is a separate way out of the branch.
    const src = program(
      "app.start",
      'if flag then { let $route = "x"\n                       seen := $route }\n                else { () }\n        after := $route',
    );
    expect(codes(src)).toEqual(["E0119"]);
  });
});
