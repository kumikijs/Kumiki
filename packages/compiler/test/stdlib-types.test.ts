import { generateDts, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { BUILTIN_TYPE_CONSTRUCTORS, STDLIB_TYPES } from "../src/stdlib-types.ts";
import { codesOf } from "./helpers/diagnostics.ts";

const TAIL = `tile App = column(text("x"))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

describe("every stdlib type resolves in the checker", () => {
  for (const t of STDLIB_TYPES) {
    it(`resolves "${t.name}"`, () => {
      expect(codesOf(`slot v : ${t.name} = 1\n${TAIL}`)).not.toContain("E0117");
    });
  }

  it("reports a name that is not one of them", () => {
    expect(codesOf(`slot v : HttpErrror = 1\n${TAIL}`)).toEqual(["E0117"]);
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
      expect(line, `${t.name} generated an unknown`).not.toContain("unknown");
    });
  }

  it("quotes a field name TypeScript cannot take bare", () => {
    const line = providerLine(`effect e cap=custom.thing in=PanicInfo out=Result(Unit, Text)
${TAIL}`);
    expect(line).toContain('"episode-id": {');
    expect(line).not.toMatch(/[^"]episode-id:/);
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
      expect(codesOf(`slot v : ${name}(${args}) = 1\n${TAIL}`)).not.toContain("E0210");
      expect(codesOf(`slot v : ${name}(${args}, Int) = 1\n${TAIL}`)).toContain("E0210");
    });
  }

  it("accepts Tuple at any arity", () => {
    for (const args of ["Int", "Int, Text", "Int, Text, Bool"]) {
      expect(codesOf(`slot v : Tuple(${args}) = 1\n${TAIL}`)).not.toContain("E0210");
    }
  });

  it("reports a constructor that is not one of them", () => {
    expect(codesOf(`slot v : Lst(Int) = 1\n${TAIL}`)).toContain("E0117");
  });
});

describe("a program's own definition shadows the standard library's", () => {
  it("takes the program's Route over the built-in one", () => {
    expect(codesOf(`type Route = Text\nslot r : Route = "x"\n${TAIL}`)).toEqual([]);
    expect(codesOf(`type Route = Text\nslot r : Route = 1\n${TAIL}`)).toEqual(["E0201"]);
  });

  it("checks against the built-in when the program declares nothing", () => {
    expect(codesOf(`slot r : Route = 1\n${TAIL}`)).toEqual(["E0201"]);
  });
});
