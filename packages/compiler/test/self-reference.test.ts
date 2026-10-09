import { type CompileResult, compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const TAIL = `app Main caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

/** `compile` never throws for these: the failure is a diagnostic, not a crash. */
function outcome(source: string): CompileResult {
  return compile(source, { runtimeSpecifier: "@kumikijs/runtime", capabilities: [] });
}

const REJECTED: readonly { what: string; code: string; source: string }[] = [
  {
    what: "a tile that expands into itself",
    code: "E0005",
    source: `tile App = column(text("a"), App)\n${TAIL}`,
  },
  {
    what: "two tiles that expand into each other",
    code: "E0005",
    source: `tile A = column(text("a"), B)
tile B = column(text("b"), A)
tile App = column(A)
${TAIL}`,
  },
  {
    what: "a fn that calls itself",
    code: "E0006",
    source: `fn fact(n: Int) -> Int = if n <= 1 then 1 else n * fact(n - 1)
tile App = column(text(fact(5).show))
${TAIL}`,
  },
  {
    what: "a slot initializer that reads another slot",
    code: "E0304",
    source: `slot b : Int = 1
slot a : Int = b + 1
tile App = column(text(a.show))
${TAIL}`,
  },
  {
    what: "a type that resolves to itself",
    code: "E0009",
    source: `type A = A
slot x : A = 1
tile App = column(text("a"))
${TAIL}`,
  },
  {
    what: "two types that resolve to each other",
    code: "E0009",
    source: `type A = B
type B = A
slot x : A = 1
tile App = column(text("a"))
${TAIL}`,
  },
];

describe("a definition written in terms of itself never reaches code generation", () => {
  for (const { what, code, source } of REJECTED) {
    it(`refuses to build ${what}`, () => {
      const result = outcome(source);
      expect(result.kind, `${what} produced an artifact`).toBe("fail");
      if (result.kind !== "fail") return;
      expect(result.errors.map((e) => e.code)).toContain(code);
      for (const e of result.errors) {
        expect(e.pos.line).toBeGreaterThanOrEqual(1);
        expect(e.pos.col).toBeGreaterThanOrEqual(1);
      }
    });
  }

  it("builds the accepted forms of all four", () => {
    const source = `type Thread = {label: Text, replies: List(Thread)}
slot xs : List(Int) = [1, 2, 3]
slot t : Thread = {label: "root", replies: [{label: "reply", replies: []}]}
fn total(ns: List(Int)) -> Int = ns.fold(0, $1 + $2)
tile Item in=Int = text($1.show)
tile App = column(for x in xs Item(x) {key: x.show}, text(total(xs).show), text(t.label))
${TAIL}`;
    expect(outcome(source).kind).toBe("ok");
  });
});
