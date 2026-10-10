import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { jsBinding } from "../src/codegen/context.ts";
import { RESERVED_BIND_NAMES } from "../src/reserved-binds.ts";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";
import { LOADABLE, loadReducer } from "./helpers/module.ts";

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

  it("still counts a slot written in both branches as written after the `if` (E0601)", () => {
    const src = program(
      "app.start",
      'if flag then { seen := "a" } else { seen := "b" }\n        seen := "c"',
    );
    expect(codesOf(src)).toEqual(["E0601"]);
  });

  it("still lets each branch write the slot the other one writes", () => {
    const src = program("app.start", 'if flag then { seen := "a" } else { seen := "b" }');
    expect(codesOf(src)).toEqual([]);
  });
});

describe("an E0103 for a name a nested body declared names the body", () => {
  // A rename to a close name type-checks and reads another value, so the diagnostic says which
  // body ended the name: in `endedScope` for `kumiki fix`, in the message for the author.
  const undefinedNames = (source: string) =>
    checkSource(source)
      .filter((e) => e.code === "E0103")
      .map((e) => ({ endedScope: e.endedScope, message: e.message }));
  const HINTS: Record<string, string> = {
    if: 'it is scoped to an "if" branch, which ends with it: declare it before the "if", or move the read into the branch',
    for: 'it is scoped to a "for" body, which ends with it: declare it before the "for", or move the read into the body',
    match:
      'it is scoped to a match arm, which ends with it: declare it before the "match", or move the read into the arm',
  };
  const hinted = (name: string, scope: string) => ({
    endedScope: scope,
    message: `Reference to undefined name "${name}" — ${HINTS[scope]} (see docs/spec/language.md)`,
  });

  it.each([
    {
      reads: "a loop variable after the loop",
      body: "for idx in [1] { () }\n        total := idx",
      name: "idx",
      scope: "for",
    },
    {
      reads: "a `let` a `for` body declared",
      body: "for x in [1] { let n = x }\n        total := n",
      name: "n",
      scope: "for",
    },
    {
      reads: "a `let` after the `if`",
      body: "if flag then { let n = 1 } else { () }\n        total := n",
      name: "n",
      scope: "if",
    },
    {
      reads: "a `let` the `else` branch declared",
      body: "if flag then { () } else { let n = 1 }\n        total := n",
      name: "n",
      scope: "if",
    },
    {
      reads: "a `let` in the other branch",
      body: "if flag then { let n = 1 } else { total := n }",
      name: "n",
      scope: "if",
    },
    {
      reads: "a pattern variable after the match",
      body: "match Some(1) with\n          | Some(v) -> { () }\n          | None    -> { () }\n        total := v",
      name: "v",
      scope: "match",
    },
    {
      reads: "a `let` a catch-all arm declared",
      body: "match Some(1) with\n          | Some(v) -> { () }\n          | _       -> { let n = 2 }\n        total := n",
      name: "n",
      scope: "match",
    },
    {
      reads: "a `let` of a nested body, naming the innermost one",
      body: "for x in [1] {\n          if flag then { let n = x } else { () }\n        }\n        total := n",
      name: "n",
      scope: "if",
    },
    {
      reads: "a name a body nested in a branch declared, later in that branch",
      body: "if flag then {\n          for i in [1] { () }\n          total := i\n        } else { () }",
      name: "i",
      scope: "for",
    },
    {
      // `seed` is one edit from the slot `seen`, the case the arithmetic hint stands down for.
      reads: "a name one edit from a name in scope",
      body: 'for seed in ["a"] { () }\n        seen := seed',
      name: "seed",
      scope: "for",
    },
  ])("names the body for $reads", ({ body, name, scope }) => {
    expect(undefinedNames(program("app.start", body))).toEqual([hinted(name, scope)]);
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
  ])("keeps the plain message for $case", ({ source, name }) => {
    expect(undefinedNames(source)).toEqual([
      { endedScope: undefined, message: `Reference to undefined name "${name}"` },
    ]);
  });

  it("reads the slot a branch's `let` shadowed once the branch ends", () => {
    const src = program(
      "app.start",
      "if flag then { let total = 5\n                       seen := total.show } else { () }\n        total := total + 1",
    );
    expect(codesOf(src)).toEqual([]);
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
