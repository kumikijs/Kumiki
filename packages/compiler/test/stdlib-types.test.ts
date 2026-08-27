// The standard library's type names had no single home: the checker knew none
// of them (so `HttpError` was an unresolvable name that accepted every value)
// and `dts.ts` carried five of the nine in a private list. `stdlib-types.ts` is
// now the one table, and this drives every entry through both consumers so a
// name added to one side cannot go missing from the other.

import { check, generateDts, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { BUILTIN_TYPE_CONSTRUCTORS, STDLIB_TYPES } from "../src/stdlib-types.ts";

const TAIL = `tile App = column(text("x"))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
const codes = (src: string) => check(parse(lex(src))).map((e) => e.code);

/** A type name only Kumiki source can carry — every entry must be spellable. */
describe("every stdlib type resolves in the checker", () => {
  for (const t of STDLIB_TYPES) {
    it(`resolves "${t.name}"`, () => {
      expect(codes(`slot v : ${t.name} = 1\n${TAIL}`)).not.toContain("E0117");
    });
  }

  it("reports a name that is not one of them", () => {
    expect(codes(`slot v : HttpErrror = 1\n${TAIL}`)).toEqual(["E0117"]);
  });
});

describe("every stdlib type generates a real TypeScript type", () => {
  const providerLine = (src: string): string | undefined =>
    generateDts(parse(lex(src)))
      .split("\n")
      .find((l) => l.includes('"custom.thing"'));

  for (const t of STDLIB_TYPES) {
    it(`maps "${t.name}" with no unknown anywhere in it`, () => {
      const line = providerLine(`effect e cap=custom.thing in=${t.name} out=Result(Unit, Text)
${TAIL}`);
      expect(line, `no provider line for ${t.name}`).toBeDefined();
      // Not a prefix check: an `unknown` nested inside a record field or a
      // union member is the same hole, and that is where `File` inside
      // `FormValue` sat while the primitive table was missing it.
      expect(line, `${t.name} generated an unknown`).not.toContain("unknown");
    });
  }

  it("quotes a field name TypeScript cannot take bare", () => {
    // `PanicInfo.episode-id` is kebab-case; unquoted, the declaration does not
    // parse at all — which is what routing PanicInfo through this table opened.
    expect(
      providerLine(`effect e cap=custom.thing in=PanicInfo out=Result(Unit, Text)
${TAIL}`),
    ).toContain('"episode-id": string');
  });

  it("names a user generic's parameters instead of erasing them", () => {
    const src = `type Box(T) = {v: T}
effect e cap=custom.thing in=Box(Int) out=Result(Unit, Text)
${TAIL}`;
    const dts = generateDts(parse(lex(src)));
    expect(dts).toContain("export type Box<T> = { v: T };");
    expect(dts).toContain("Provider<Box<number>,");
  });
});

describe("the built-in type constructors", () => {
  for (const [name, arity] of BUILTIN_TYPE_CONSTRUCTORS) {
    if (arity === null) continue;
    it(`accepts "${name}" with ${arity} argument(s) and reports any other count`, () => {
      const args = Array.from({ length: arity }, () => "Int").join(", ");
      expect(codes(`slot v : ${name}(${args}) = 1\n${TAIL}`)).not.toContain("E0210");
      expect(codes(`slot v : ${name}(${args}, Int) = 1\n${TAIL}`)).toContain("E0210");
    });
  }

  it("accepts Tuple at any arity", () => {
    for (const args of ["Int", "Int, Text", "Int, Text, Bool"]) {
      expect(codes(`slot v : Tuple(${args}) = 1\n${TAIL}`)).not.toContain("E0210");
    }
  });

  it("reports a constructor that is not one of them", () => {
    expect(codes(`slot v : Lst(Int) = 1\n${TAIL}`)).toContain("E0117");
  });
});

describe("a program's own definition shadows the standard library's", () => {
  it("takes the program's Route over the built-in one", () => {
    // The built-in `Route` is a record; a program that redefines it as Text
    // must have its own definition checked against, not the built-in.
    expect(codes(`type Route = Text\nslot r : Route = "x"\n${TAIL}`)).toEqual([]);
    expect(codes(`type Route = Text\nslot r : Route = 1\n${TAIL}`)).toEqual(["E0201"]);
  });

  it("checks against the built-in when the program declares nothing", () => {
    expect(codes(`slot r : Route = 1\n${TAIL}`)).toEqual(["E0201"]);
  });
});
