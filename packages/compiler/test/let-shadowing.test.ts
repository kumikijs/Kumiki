import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { jsBinding } from "../src/codegen/context.ts";
import { RESERVED_BIND_NAMES } from "../src/reserved-binds.ts";
import { checkSource, codesOf, posOf, summariesOf } from "./helpers/diagnostics.ts";
import { LOADABLE, loadReducer } from "./helpers/module.ts";
import { withButtonApp, withRoot } from "./helpers/programs.ts";

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

async function apply(
  source: string,
  payload: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const reducer = await loadReducer(source, "subject");
  return reducer.apply({ seen: "", after: "" }, payload).slots;
}

/** What the `seen` slot holds after one application of `subject`. */
async function seenAfter(source: string, payload: Record<string, unknown> = {}): Promise<unknown> {
  return (await apply(source, payload)).seen;
}

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
      LOADABLE,
    );
    if (result.kind !== "ok") expect.fail(result.errors.map((e) => e.code).join("\n"));
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

describe("a pattern's binds are peers, not a shadowing pair", () => {
  it("reports a name bound twice in one variant pattern", () => {
    expect(
      codesOf(
        matching(`match p with
          | Both(a, a) -> { note := a }
          | Neither    -> { note := "none" }`),
      ),
    ).toEqual(["E0122"]);
  });

  it("reports one bound twice across a tuple pattern's items", () => {
    expect(
      codesOf(
        matching(`match pair with
          | (dup, dup) -> { note := dup }`),
      ),
    ).toEqual(["E0122"]);
  });

  it("leaves `_` alone, however many times it is written", () => {
    expect(
      codesOf(
        matching(`match p with
          | Both(_, _) -> { note := "both" }
          | Neither    -> { note := "none" }`),
      ),
    ).toEqual([]);
  });

  it("leaves a bind that shadows a name outside the pattern alone", () => {
    expect(
      codesOf(
        matching(`let outer = "x"
        match p with
          | Both(outer, b) -> { note := outer + b }
          | Neither        -> { note := "none" }`),
      ),
    ).toEqual([]);
  });

  it("leaves two arms that bind the same name alone", () => {
    expect(
      codesOf(
        matching(`match p with
          | Both(a, _) -> { note := a }
          | Neither    -> { note := "none" }`),
      ),
    ).toEqual([]);
  });
});

function diagnostics(source: string): { code: string; name: string; at: string }[] {
  const lines = source.split("\n");
  return checkSource(source).map((e) => ({
    code: e.code,
    name: /"([^"]+)"/.exec(e.message)?.[1] ?? "",
    at: e.pos ? (lines[e.pos.line - 1]?.slice(e.pos.col - 1) ?? "") : "",
  }));
}

describe("the checker scopes each `if` branch as codegen does", () => {
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
});

describe("a nested body's writes count as the reducer's (E0601)", () => {
  const BOTH_ARMS =
    "match Some(1) with\n          | Some(v) -> { total := v }\n          | None    -> { total := 0 }";

  it.each([
    [
      "both branches of an `if`",
      'if flag then { seen := "a" } else { seen := "b" }\n        seen := "c"',
    ],
    ["a `for` body", "for x in [1] { total := x }\n        total := 2"],
    ["both arms of a match", `${BOTH_ARMS}\n        total := 2`],
  ])("counts a slot written in %s as written after it", (_where, body) => {
    expect(codesOf(program("app.start", body))).toEqual(["E0601"]);
  });

  it.each([
    ["each branch of an `if`", 'if flag then { seen := "a" } else { seen := "b" }'],
    ["each arm of a match", BOTH_ARMS],
  ])("lets %s write the slot another one writes", (_where, body) => {
    expect(codesOf(program("app.start", body))).toEqual([]);
  });
});

describe("an E0103 for a name read outside its scope names the scope", () => {
  // A rename to a close name can type-check and read another value, so the diagnostic says which
  // scope holds the name: in `endedScope` (a read after it) or `laterScope` (a read before it) for
  // `kumiki fix`, in the message for the author.
  const undefinedNames = (source: string) =>
    checkSource(source)
      .filter((e) => e.code === "E0103")
      .map((e) => ({
        name: /"([^"]+)"/.exec(e.message)?.[1],
        endedScope: e.endedScope,
        laterScope: e.laterScope,
        declaredAt: /declared later, at (\d+:\d+)/.exec(e.message)?.[1],
        message: e.message,
      }));
  // Where each hint says the name was declared and the repair it gives, enough to tell every hint
  // from the others: a statement's from its expression twin, and a sibling's from an ended scope's.
  const LET_IN = 'by a "let … in", whose body ended before this read: move the read into that body';
  const REPAIR = {
    for: 'in a "for" loop, and a name carries no value out of a loop: move the read into the loop\'s body, or write the value to a slot there',
    if: 'in an "if" branch, which ended before this read: declare it once before the "if"',
    match: 'in a match arm, which ended before this read: declare it once before the "match"',
    "if sibling": 'in the other branch of this "if": declare it once before the "if"',
    "match sibling": 'in another arm of this match: declare it once before the "match"',
    "let-in": `${LET_IN}, or bind it with a "let" statement where both reads see it`,
    "let-in around both reads": `${LET_IN}, or bind it with one "let … in" around both reads`,
    "let-in in a tile": `${LET_IN}, or move both reads into a tile that declares "in=" and pass it the value`,
    "let-in in app.init": `${LET_IN} (see`,
    "for-expr":
      "in a tile's \"for\", and a name carries no value out of a loop: move the read into the loop's body (see",
    "match-expr":
      'in an arm of a "match" expression, which ended before this read: move the read into that arm',
    "match-expr sibling":
      'in another arm of this "match" expression: move the read into the arm that declares it',
    "for later": 'in a "for" loop: move the read into the loop\'s body, after the declaration',
    "if later": 'in an "if" branch: move the read into that branch, after the declaration',
    "match later": "in a match arm: move the read into that arm, after the declaration",
    "let-in later":
      'by a "let … in": move the read into its body, or bind it with a "let" statement where both reads see it',
    "let-in later around both reads":
      'by a "let … in": move the read into its body, or bind it with one "let … in" around both reads',
    "for-expr later": "in a tile's \"for\": move the read into the loop's body (see",
    "match-expr later": 'in an arm of a "match" expression: move the read into that arm (see',
  } as const;
  type Hint = keyof typeof REPAIR;
  const hinted = (name: string, hint: Hint) => ({
    name,
    endedScope: hint.split(" ")[0],
    message: expect.stringContaining(REPAIR[hint]),
  });
  /** The program with `tile` as its page's body, beside a reducer that reads nothing. */
  const page = (tile: string) => program("app.start", "()").replace("column(text(seen))", tile);
  /** The program with `fn` declared beside its reducer. */
  const withFn = (fn: string) =>
    program("app.start", "()").replace("tile Page", `${fn}\n\ntile Page`);
  /** The program with `after` initialized to `init`. */
  const afterIs = (init: string) =>
    program("app.start", "()").replace('slot after : Text = ""', `slot after : Text = ${init}`);
  /** The program with `init` as its `app.init`, beside an effect `say` that takes a `Text`. */
  const initIs = (init: string) =>
    program("app.start", "()")
      .replace(
        "reducer subject",
        'effect say cap=log.write\n    in=Text\n    out=Result(Text, Text)\n    map-request={level: "info", message: $1}\n\nreducer subject',
      )
      .replace("caps   = []", "caps   = [log.write]")
      .replace("init   = []", `init   = ${init}`);

  it.each<{ reads: string; body: string; name: string; hint: Hint }>([
    {
      reads: "a loop variable after the loop",
      body: "for idx in [1] { () }\n        total := idx",
      name: "idx",
      hint: "for",
    },
    {
      reads: "a `let` a `for` body declared",
      body: "for x in [1] { let n = x }\n        total := n",
      name: "n",
      hint: "for",
    },
    {
      reads: "a loop variable read as a receiver",
      body: "for idx in [1] { () }\n        seen := idx.show",
      name: "idx",
      hint: "for",
    },
    {
      reads: "a `let` after the `if`",
      body: "if flag then { let n = 1 } else { () }\n        total := n",
      name: "n",
      hint: "if",
    },
    {
      reads: "a `let` the `else` branch declared",
      body: "if flag then { () } else { let n = 1 }\n        total := n",
      name: "n",
      hint: "if",
    },
    {
      reads: "a `let` the `then` branch declared, in the `else` branch",
      body: "if flag then { let n = 1 } else { total := n }",
      name: "n",
      hint: "if sibling",
    },
    {
      reads: "a pattern variable after the match",
      body: "match Some(1) with\n          | Some(v) -> { () }\n          | None    -> { () }\n        total := v",
      name: "v",
      hint: "match",
    },
    {
      reads: "a `let` a catch-all arm declared",
      body: "match Some(1) with\n          | Some(v) -> { () }\n          | _       -> { let n = 2 }\n        total := n",
      name: "n",
      hint: "match",
    },
    {
      reads: "a pattern variable in a later arm",
      body: "match Some(1) with\n          | Some(v) -> { () }\n          | None    -> { total := v }",
      name: "v",
      hint: "match sibling",
    },
    {
      reads: "a `let` of an `if` in a `for` body, after the `for`",
      body: "for x in [1] {\n          if flag then { let n = x } else { () }\n        }\n        total := n",
      name: "n",
      hint: "for",
    },
    {
      reads: "a `let` of an `if` in a `for` body, after the `if` in that body",
      body: "for x in [1] {\n          if flag then { let n = x } else { () }\n          total := n\n        }",
      name: "n",
      hint: "if",
    },
    {
      reads: "a pattern variable of a match in an `if` branch, after the `if`",
      body: "if flag then {\n          match Some(1) with\n            | Some(v) -> { () }\n            | None    -> { () }\n        } else { () }\n        total := v",
      name: "v",
      hint: "if",
    },
    {
      reads: "a name a body nested in a branch declared, later in that branch",
      body: "if flag then {\n          for i in [1] { () }\n          total := i\n        } else { () }",
      name: "i",
      hint: "for",
    },
    {
      reads: "a name two bodies declared, by the later one",
      body: "for idx in [1] { () }\n        if flag then { let idx = 2 } else { total := idx }",
      name: "idx",
      hint: "if sibling",
    },
    {
      // `seed` is one edit from the slot `seen`: a close name in scope silences the arithmetic
      // hint, not this one.
      reads: "a name one edit from a name in scope",
      body: 'for seed in ["a"] { () }\n        seen := seed',
      name: "seed",
      hint: "for",
    },
    {
      // The `else` branch's `n` shadows the loop variable and hands it back.
      reads: "a name two scopes that end together declare, naming the outer one",
      body: "for n in [1] { if flag then { () } else { let n = 2 } }\n        total := n",
      name: "n",
      hint: "for",
    },
  ])("names the body for $reads", ({ body, name, hint }) => {
    expect(undefinedNames(program("app.start", body))).toEqual([hinted(name, hint)]);
  });

  it.each<{ reads: string; source: string; name: string; hint: Hint }>([
    {
      reads: "a `let … in` name in a later statement",
      source: program("app.start", 'seen := let n = "a" in n\n        after := n'),
      name: "n",
      hint: "let-in",
    },
    {
      reads: "a `let … in` name, not a statement body around it",
      source: program("app.start", 'for x in [1] { seen := let n = "a" in n }\n        after := n'),
      name: "n",
      hint: "let-in",
    },
    {
      reads: "a `let … in` name after it in a `fn`",
      source: withFn("fn twice(x: Int) -> Int = (let n = x in n) + n"),
      name: "n",
      hint: "let-in around both reads",
    },
    {
      reads: "a `let … in` name in a slot initializer",
      source: afterIs('(let n = "a" in n) + n'),
      name: "n",
      hint: "let-in around both reads",
    },
    {
      reads: "a `let … in` name in a sibling argument of a tile",
      source: page('column(text(let n = "a" in n), text(n))'),
      name: "n",
      hint: "let-in in a tile",
    },
    {
      reads: "a `let … in` name in a later entry of `app.init`",
      source: initIs('[say(let n = "a" in n), say(n)]'),
      name: "n",
      hint: "let-in in app.init",
    },
    {
      // Following a statement's hint would move the read after the `let … in` still.
      reads: "a `let … in` name a statement before it in the body ended too",
      source: program(
        "app.start",
        'for x in [1] {\n          if flag then { let n = "b" } else { () }\n          seen := let n = "a" in n\n        }\n        after := n',
      ),
      name: "n",
      hint: "let-in",
    },
    {
      reads: "a `match` expression's arm variable in a later statement",
      source: program(
        "app.start",
        'seen := match Some("a") with | Some(v) -> v | None -> ""\n        after := v',
      ),
      name: "v",
      hint: "match-expr",
    },
    {
      reads: "a `match` expression's arm variable in a later arm",
      source: program("app.start", 'seen := match Some("a") with | Some(v) -> v | None -> v'),
      name: "v",
      hint: "match-expr sibling",
    },
    {
      reads: "a `match` expression's arm variable after it in a `fn`",
      source: withFn(
        "fn pick(o: Option(Int)) -> Int = (match o with | Some(v) -> v | None -> 0) + v",
      ),
      name: "v",
      hint: "match-expr",
    },
    {
      reads: "a `match` expression's arm variable in a later arm, in a slot initializer",
      source: afterIs('match Some("a") with | Some(v) -> v | None -> v'),
      name: "v",
      hint: "match-expr sibling",
    },
    {
      reads: "a `match` expression's arm variable after it in a slot initializer",
      source: afterIs('(match Some("a") with | Some(v) -> v | None -> "") + v'),
      name: "v",
      hint: "match-expr",
    },
    {
      reads: "a value `match`'s arm variable in a sibling argument of a tile",
      source: page('column(text(match Some("a") with | Some(v) -> v | None -> ""), text(v))'),
      name: "v",
      hint: "match-expr",
    },
    {
      reads: "a tile `for` variable in a sibling",
      source: page("column(for idx in [1] text(idx.show), text(idx.show))"),
      name: "idx",
      hint: "for-expr",
    },
    {
      reads: "a tile `match` arm's variable in a sibling",
      source: page(
        'column(match Some(1) with | Some(v) -> text(v.show) | None -> text("none"), text(v.show))',
      ),
      name: "v",
      hint: "match-expr",
    },
    {
      reads: "a tile `match` arm's variable in a later arm",
      source: page("column(match Some(1) with | Some(v) -> text(v.show) | None -> text(v.show))"),
      name: "v",
      hint: "match-expr sibling",
    },
  ])("names the expression for $reads", ({ source, name, hint }) => {
    expect(undefinedNames(source)).toEqual([hinted(name, hint)]);
  });

  it("keeps the message of a misspelling beside a sibling's read", () => {
    const src = page("column(for idx in [1] text(idx.show), text(idx.show), text(sen))");
    expect(undefinedNames(src)).toEqual([
      hinted("idx", "for-expr"),
      { name: "sen", endedScope: undefined, message: 'Reference to undefined name "sen"' },
    ]);
  });

  it.each([
    {
      case: "a misspelling no body declared",
      source: program("app.start", "for x in [1] { () }\n        total := totl"),
      name: "totl",
    },
    {
      case: "a body's name read in another reducer",
      source: program("app.start", "for idx in [1] { () }").replace(
        "tile Page",
        "reducer other on=app.stop do= total := idx\n\ntile Page",
      ),
      name: "idx",
    },
    {
      case: "an expression's name read in another tile",
      source: page("column(for idx in [1] text(idx.show))").replace(
        "app A",
        "tile Other = text(idx.show)\n\napp A",
      ),
      name: "idx",
    },
    {
      case: "a later definition's name read in an earlier one",
      source: page("column(for idx in [1] text(idx.show))").replace(
        "tile Page",
        "tile Other = text(idx.show)\n\ntile Page",
      ),
      name: "idx",
    },
  ])("keeps the plain message for $case", ({ source, name }) => {
    expect(undefinedNames(source)).toEqual([
      { name, endedScope: undefined, message: `Reference to undefined name "${name}"` },
    ]);
  });

  it("names no scope for a binding the expression's own scope took from around it", () => {
    // The fragment binds `$1`, and the `let … in` inside it sees that `$1` as well as its `n`.
    const src = program(
      "app.start",
      'seen := ["a"].map(let n = $1 in n).head.get-or("")\n        after := $1',
    );
    expect(checkSource(src).map((e) => e.endedScope)).toEqual([undefined]);
  });

  it.each([
    [
      "an outer `let` a `let … in` shadowed",
      program("app.start", 'let n = 1\n        seen := let n = "a" in n\n        total := n'),
    ],
    [
      "a `fn` parameter a `let … in` shadowed",
      withFn("fn twice(n: Int) -> Int = (let n = 2 in n) + n"),
    ],
    [
      "a tile `for` variable a nested `for` over the same name shadowed",
      page("column(for idx in [1] column(for idx in [2] text(idx.show), text(idx.show)))"),
    ],
    [
      "a slot named like a tile `for` variable",
      page("column(for total in [1] text(total.show), text(total.show))"),
    ],
    [
      "a slot named like a `let … in` name",
      program("app.start", 'seen := let total = "a" in total\n        after := total.show'),
    ],
    [
      "a slot named like a `match` expression's arm variable",
      program(
        "app.start",
        'seen := match Some("a") with | Some(total) -> total | None -> ""\n        after := total.show',
      ),
    ],
  ])("still reads %s after the expression", (_case, src) => {
    expect(summariesOf(src)).toEqual([]);
  });

  it("accepts the hinted repair: a `let` statement both reads see binds the value", () => {
    const src = program(
      "app.start",
      'let n = "a"\n        for x in [1] {\n          if flag then { let n = "b" } else { () }\n          seen := n\n        }\n        after := n',
    );
    expect(summariesOf(src)).toEqual([]);
  });

  it("reads the slot a branch's `let` shadowed once the branch ends", () => {
    const src = program(
      "app.start",
      "if flag then { let total = 5\n                       seen := total.show } else { () }\n        total := total + 1",
    );
    expect(codesOf(src)).toEqual([]);
  });

  describe("before the scope that declares it", () => {
    /** A read ahead of the scope `declaration` opens in `source`, whose message says where. */
    const ahead = (source: string, name: string, hint: Hint, declaration: string) => {
      const at = posOf(source, declaration);
      return {
        name,
        laterScope: hint.split(" ")[0],
        declaredAt: `${at.line}:${at.col}`,
        message: expect.stringContaining(REPAIR[hint]),
      };
    };
    const plain = (name: string) => ({
      name,
      endedScope: undefined,
      laterScope: undefined,
      message: `Reference to undefined name "${name}"`,
    });

    it.each<{ reads: string; source: string; name: string; hint: Hint; declaration: string }>([
      {
        reads: "a loop variable before the loop",
        source: program("app.start", "total := idx\n        for idx in [1] { () }"),
        name: "idx",
        hint: "for later",
        declaration: "for idx",
      },
      {
        reads: "a `let` before the `if`",
        source: program("app.start", "total := n\n        if flag then { let n = 1 } else { () }"),
        name: "n",
        hint: "if later",
        declaration: "let n",
      },
      {
        reads: "a `let` in the branch before it",
        source: program("app.start", "if flag then { total := n } else { let n = 1 }"),
        name: "n",
        hint: "if later",
        declaration: "let n",
      },
      {
        reads: "a pattern variable before the match",
        source: program(
          "app.start",
          "total := v\n        match Some(1) with\n          | Some(v) -> { () }\n          | None    -> { () }",
        ),
        name: "v",
        hint: "match later",
        declaration: "Some(v)",
      },
      {
        reads: "a pattern variable in an earlier arm",
        source: program(
          "app.start",
          "match Some(1) with\n          | None    -> { total := v }\n          | Some(v) -> { () }",
        ),
        name: "v",
        hint: "match later",
        declaration: "Some(v)",
      },
      {
        reads: "a `let … in` name in an earlier statement",
        source: program("app.start", 'after := n\n        seen := let n = "a" in n'),
        name: "n",
        hint: "let-in later",
        declaration: "let n",
      },
      {
        reads: "a `match` expression's arm variable in an earlier statement",
        source: program(
          "app.start",
          'after := v\n        seen := match Some("a") with | Some(v) -> v | None -> ""',
        ),
        name: "v",
        hint: "match-expr later",
        declaration: "Some(v)",
      },
      {
        reads: "a tile `for` variable in an earlier sibling",
        source: page("column(text(idx.show), for idx in [1] text(idx.show))"),
        name: "idx",
        hint: "for-expr later",
        declaration: "for idx",
      },
      {
        reads: "a tile `match` arm's variable in an earlier sibling",
        source: page(
          'column(text(v.show), match Some(1) with | Some(v) -> text(v.show) | None -> text("none"))',
        ),
        name: "v",
        hint: "match-expr later",
        declaration: "Some(v)",
      },
      {
        reads: "a `let … in` name before it in a `fn`",
        source: program("app.start", "()").replace(
          "tile Page",
          "fn twice(x: Int) -> Int = n + (let n = x in n)\n\ntile Page",
        ),
        name: "n",
        hint: "let-in later around both reads",
        declaration: "let n",
      },
      {
        reads: "a `let … in` name before it in a test",
        source: `${program("app.start", "()")}
test probe =
    property-test
        for-all   = {k: Int}
        given     = {slots: {total: k}}
        invariant = m == (let m = k in m)
`,
        name: "m",
        hint: "let-in later around both reads",
        declaration: "let m",
      },
      {
        reads: "a `let` of the innermost scope, nested in a later one",
        source: program(
          "app.start",
          "total := n\n        for x in [1] {\n          if flag then { let n = x } else { () }\n        }",
        ),
        name: "n",
        hint: "if later",
        declaration: "let n",
      },
    ])("names the scope for $reads", ({ source, name, hint, declaration }) => {
      expect(undefinedNames(source)).toEqual([ahead(source, name, hint, declaration)]);
    });

    it("names no scope for a read ahead of its `let` in the same body, or in a `for`'s own list", () => {
      // The first read is in the body that declares `n`; the second in the `for` that declares
      // `idx`, which reads its list before the name is in scope.
      const src = program(
        "app.start",
        "for x in [1] { total := n\n                       let n = 1 }\n        for idx in [idx] { () }",
      );
      expect(undefinedNames(src)).toEqual([plain("n"), plain("idx")]);
    });

    it("names the scope that ended when another declares the name later", () => {
      const src = program(
        "app.start",
        "for idx in [1] { () }\n        total := idx\n        for idx in [2] { () }",
      );
      expect(undefinedNames(src)).toEqual([hinted("idx", "for")]);
    });

    it("keeps the message of a misspelling beside it", () => {
      const src = program(
        "app.start",
        "total := idx\n        seen := sen\n        for idx in [1] { () }",
      );
      expect(undefinedNames(src)).toEqual([
        ahead(src, "idx", "for later", "for idx"),
        plain("sen"),
      ]);
    });

    it("reads the slot of the same name before a scope that shadows it", () => {
      const src = page('column(text(seen), for seen in ["a"] text(seen))');
      expect(codesOf(src)).toEqual([]);
    });
  });
});

describe("a branch's `let` leaves the type of the name after the `if` alone", () => {
  const shadowed = (write: string): string =>
    program(
      "app.start",
      `let n = 5\n        if flag then { let n = "s"\n                       seen := n }\n                else { () }\n        ${write}`,
    );

  it("accepts the outer Int written to an Int slot after the `if`", LOADS, async () => {
    const src = shadowed("total := n");
    expect(codesOf(src)).toEqual([]);
    expect(await apply(src)).toMatchObject({ seen: "s", total: 5 });
  });

  it("reports the outer Int written to a Text slot after the `if` as E0201", () => {
    expect(diagnostics(shadowed("after := n")).map((d) => d.code)).toEqual(["E0201"]);
  });

  it("ends a branch's `$route` shadow with the branch (E0119)", () => {
    const src = program(
      "app.start",
      'if flag then { let $route = "x"\n                       seen := $route }\n                else { () }\n        after := $route',
    );
    expect(codesOf(src)).toEqual(["E0119"]);
  });
});

describe("a bind with no type of its own, over a slot of its name", () => {
  // `.map` with a fragment answers no type today, and nothing types a trigger's second payload
  // bind, so each `name` / `key` below is a bind with no type, over the slot `name : Text` /
  // `key : Text`. Each row reads it into an `Int` slot and a `Text` one: a bind that took the
  // slot's `Text` is reported at the first, and one that has a type of its own at the second.
  const SLOTS = `slot n    : Int       = 0
slot t    : Text      = ""
slot name : Text      = ""
slot key  : Text      = ""
slot xs   : List(Int) = []
effect e cap=log.write in=Unit out=Result(Unit, Text) map-request={level: "info", message: "m"}`;
  const summaries = (defs: string) =>
    summariesOf(withButtonApp(`${SLOTS}\n${defs}`, { caps: "log.write" }));
  const onClick = (body: string) => `reducer r on=ui.click(B) do= ${body}`;

  it.each([
    [
      "a `let … in`",
      onClick(`n := let name = xs.map($1) in name
    t := let name = xs.map($1) in name`),
    ],
    [
      "a `let` statement",
      onClick(`let name = xs.map($1)
    n := name
    t := name`),
    ],
    [
      "a `for`",
      onClick(`for name in xs.map($1) {
      n := name
      t := name
    }`),
    ],
    [
      "a match arm",
      onClick(`n := match xs.map($1).head with | Some(name) -> name | None -> n
    t := match xs.map($1).head with | Some(name) -> name | None -> t`),
    ],
    [
      "an effect trigger's second payload",
      `reducer r on=e.ok(_, key) do= n := key
    t := key`,
    ],
    ["a `for` in a tile", "tile T = column(for name in xs.map($1) text(name.size.show))"],
  ])("reports nothing when %s binds it", (_, defs) => {
    expect(summaries(defs)).toEqual([]);
  });

  it("is no receiver of the slot's type, so a member `Text` lacks is not E0108", () => {
    expect(summaries(onClick("t := (let name = $event in name).size.show"))).toEqual([]);
  });

  it.each([
    [
      "a `let … in`",
      onClick(`t := let name = xs.map($1) in name
    n := name`),
      "E0201 Expected Int but got Text",
    ],
    [
      "a `for`",
      onClick(`for name in xs.map($1) {
      t := name
    }
    n := name`),
      "E0201 Expected Int but got Text",
    ],
    [
      "a tile's `for`",
      `tile T = column(for name in xs.map($1) text("x"), text(name.size.show))`,
      'E0108 Type "Text" has no member ".size" — it is a member of Map / Set',
    ],
  ])("reads the slot again once %s ends", (_, defs, expected) => {
    expect(summaries(defs)).toEqual([expected]);
  });
});

describe("a `bind=` root that a local shadows", () => {
  // The lowering writes a bind's root slot whatever shadows it, so the checker refuses a local
  // root whether or not the local has a type; its type is never what the bind is checked by.
  it.each([
    ["input", "no type", "slot draft : List(Int) = []", "draft", "xs.map($1)"],
    ["input", "a type", "slot draft : List(Int) = []", "draft", "ys"],
    ["check", "no type", 'slot flag : Text = ""', "flag", "xs.map($1)"],
    ["check", "a type", 'slot flag : Text = ""', "flag", "bs"],
    ["editable", "no type", "slot id : EffectId = EffectId.none", "id", "xs.map($1)"],
    ["editable", "a type", "slot id : EffectId = EffectId.none", "id", "ys"],
  ])("is E0229 on %s, for a `for` variable with %s", (control, _, slot, name, list) => {
    const defs = `${slot}
slot xs : List(Int)  = [1]
slot ys : List(Text) = ["a"]
slot bs : List(Bool) = [true]
tile R = column(for ${name} in ${list} ${control}(bind=${name}))`;
    expect(codesOf(withRoot("R", defs))).toEqual(["E0229"]);
  });
});
