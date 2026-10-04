import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { STDLIB_TYPES } from "../src/stdlib-types.ts";

// Most of the standard library's domain types (stdlib.md §2.1.3) name values
// the runtime or the standard library builds: the `PanicInfo` an error-boundary
// fallback is applied to, the `Route` the router maintains, the `HttpError` a
// failed request delivers, a `Duration.s(5)`. A program cannot declare a type
// under any of the names — the checker would reason about the program's type
// while the runtime kept to the standard library's value. E0231 is reported at
// the declaration, and every use of the name means the standard library's
// type.

const TAIL = `tile App = column(text("x"))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]`;

const diagnostics = (src: string) =>
  check(parse(lex(src))).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);
const codes = (src: string) => check(parse(lex(src))).map((e) => e.code);

describe("a program declaring a type under a standard library name", () => {
  for (const t of STDLIB_TYPES) {
    it(`is E0231 at the declaration of "${t.name}"`, () => {
      const found = check(parse(lex(`slot n : Int = 0\ntype ${t.name} = {v: Int}\n${TAIL}`)));
      expect(found).toEqual([
        {
          code: "E0231",
          kind: "reserved-type-name",
          message: `Type "${t.name}" collides with the standard library's ${t.name}; uses of it never see this type`,
          pos: { line: 2, col: 1 },
        },
      ]);
    });
  }

  it("reports the declaration whatever its body or parameters", () => {
    expect(codes(`type Route = Text\n${TAIL}`)).toEqual(["E0231"]);
    expect(codes(`type Duration = Short | Long\n${TAIL}`)).toEqual(["E0231"]);
    expect(codes(`type HttpError(T) = {v: T}\n${TAIL}`)).toEqual(["E0231"]);
  });

  it("reports a declaration identical to the standard library's too", () => {
    // `type Email = nominal Text where email` is the definition the standard
    // library already gives the name. Declaring it again adds nothing, and
    // would leave the name free to drift from what the standard library means.
    expect(codes(`type Email = nominal Text where email\n${TAIL}`)).toEqual(["E0231"]);
  });

  it("reports each declaration of the name", () => {
    // A second declaration is also E0007, which names the duplicate. E0231 is
    // about the name, so each declaration of it carries one.
    const found = codes(`type Route = Text\ntype Route = Int\n${TAIL}`);
    expect(found.filter((c) => c === "E0231")).toHaveLength(2);
    expect(found).toContain("E0007");
  });
});

describe("a use of the name keeps the standard library's type", () => {
  it("checks a slot against the standard library's Route, not the declared Text", () => {
    expect(diagnostics(`type Route = Text\nslot r : Route = "x"\n${TAIL}`)).toEqual([
      `E0231 1:1 Type "Route" collides with the standard library's Route; uses of it never see this type`,
      "E0201 2:18 Expected Route but got Text",
    ]);
  });

  it("follows an alias to the standard library's definition, so a self-alias is no cycle", () => {
    // `type Route = Route` is one mistake — the declaration — and the name it
    // writes is the standard library's record, so there is no loop to report.
    expect(codes(`type Route = Route\n${TAIL}`)).toEqual(["E0231"]);
  });

  it("types an error-boundary fallback's $1 as the PanicInfo the runtime builds", () => {
    // The fallback reads `$1.message`, which the record the runtime binds has
    // and the declared `Text` does not: the read is checked against the record.
    const src = `type PanicInfo = Text
slot secret : Option(Text) = None
tile Fb in=PanicInfo = column(text("recovered: " + $1.message))
tile Risky error-boundary=Fb = column(text(secret.get))
tile App = column(Risky)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
    expect(diagnostics(src)).toEqual([
      `E0231 1:1 Type "PanicInfo" collides with the standard library's PanicInfo; uses of it never see this type`,
    ]);
  });
});

describe("a fallback typed by a program's own PanicInfo", () => {
  it("is refused at the declaration", () => {
    // Accepted, the checker would read `$1` as the declared `Text` while the
    // runtime binds the panic record to it.
    const src = `type PanicInfo = Text
slot secret : Option(Text) = None
slot reveal : Bool = false
tile Fb in=PanicInfo = column(text("recovered: " + $1))
tile Risky error-boundary=Fb = when(reveal, text(secret.get))
tile Btn = button(text="go") {id: "go"}
reducer go on=ui.click(Btn) do= reveal := true
tile App = column(Risky, Btn)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
    expect(diagnostics(src)).toEqual([
      `E0231 1:1 Type "PanicInfo" collides with the standard library's PanicInfo; uses of it never see this type`,
    ]);
  });
});

describe("the standard library names everywhere else", () => {
  // Only `type <name> = …` is refused. Each of these writes one of the names
  // in a position that reads it, or declares something that is not a type.
  for (const t of STDLIB_TYPES) {
    const n = t.name;
    const lower = `${n.charAt(0).toLowerCase()}${n.slice(1)}`;
    const positions: [string, string][] = [
      ["a slot annotation", `slot x : Option(${n}) = None`],
      ["a fn parameter and return", `fn f(a: Option(${n})) -> Option(${n}) = a`],
      ["a tile in=", `tile T in=${n} = text("t")`],
      ["a record field", `type Box = {v: ${n}}\nslot b : Option(Box) = None`],
      ["an alias of it", `type Mine = ${n}\nslot b : Option(Mine) = None`],
      [
        "a type parameter of that spelling",
        `type Box(${n}) = {v: ${n}}\nslot b : Box(Int) = {v: 1}`,
      ],
      ["a type whose name starts with it", `type ${n}View = {v: Int}\nslot b : ${n}View = {v: 1}`],
      ["a type whose name ends with it", `type App${n} = Int\nslot b : App${n} = 1`],
      ["a slot of that spelling", `slot ${lower} : Int = 0`],
      ["a fn of that spelling", `fn ${lower}(a: Int) -> Int = a`],
      ["a tile of that name", `tile ${n} = text("t")`],
      ["a variant tag of that name", `type Mine = ${n} | Other\nslot m : Mine = ${n}`],
    ];
    for (const [where, decls] of positions) {
      // `slot route` is E0115: that name is the router's slot, not a type's.
      if (decls.startsWith("slot route ")) continue;
      it(`leaves "${n}" in ${where} alone`, () => {
        expect(diagnostics(`${decls}\n${TAIL}`)).toEqual([]);
      });
    }
  }
});
