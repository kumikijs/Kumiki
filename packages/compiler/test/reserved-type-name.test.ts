import { describe, expect, it } from "vitest";
import { isReservedTypeName, RESERVED_TYPE_NAMES, STDLIB_TYPES } from "../src/stdlib-types.ts";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";

const TAIL = `tile App = column(text("x"))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]`;

const diagnostics = (src: string) =>
  checkSource(src).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);

const RESERVED = ["PanicInfo", "Route", "HttpError", "HttpStatus", "Duration", "FormValue"];

// Each use is one the standard library's definition would refuse, so a row
// fails if the name is reserved, and again if the use read the stdlib type.
const DECLARABLE: [string, string][] = [
  ["Email", `type Email = {address: Text}\nslot e : Email = {address: "ada@example.com"}`],
  ["Url", `type Url = Text\ntype Slug = nominal Text\nfn slug(u: Url) -> Slug = u`],
  ["Uuid", `type Uuid = Int\nslot id : Uuid = 5`],
  ["FormData", `type FormData = Text\nslot f : FormData = "x"`],
];

const collision = (name: string) =>
  `Type "${name}" collides with the standard library's ${name}; uses of it never see this type`;

describe("the reserved names", () => {
  it("are standard library entries, and the rows below name exactly them", () => {
    const stdlib = STDLIB_TYPES.map((t) => t.name);
    for (const name of RESERVED_TYPE_NAMES) expect(stdlib).toContain(name);
    expect([...RESERVED_TYPE_NAMES].sort()).toEqual([...RESERVED].sort());
  });

  it("and the declarable rows cover every other entry", () => {
    const declarable = DECLARABLE.map(([name]) => name);
    expect(STDLIB_TYPES.map((t) => t.name).sort()).toEqual([...RESERVED, ...declarable].sort());
    for (const name of declarable) expect(isReservedTypeName(name)).toBe(false);
  });
});

describe("a program declaring a type under a reserved name", () => {
  it.each(RESERVED)("is E0231 at the declaration of %s", (name) => {
    expect(checkSource(`slot n : Int = 0\ntype ${name} = {v: Int}\n${TAIL}`)).toEqual([
      {
        code: "E0231",
        kind: "reserved-type-name",
        message: collision(name),
        pos: { line: 2, col: 1 },
      },
    ]);
  });

  it.each([
    ["an alias of Text", "type Route = Text"],
    ["a union", "type Duration = Short | Long"],
    ["a type parameter", "type HttpError(T) = {v: T}"],
    [
      "the standard library's own definition",
      "type HttpStatus = nominal Int where between(0, 599)",
    ],
  ])("reports the declaration whatever its body: %s", (_, decl) => {
    expect(codesOf(`${decl}\n${TAIL}`)).toEqual(["E0231"]);
  });

  it("reports each declaration of the name, beside the E0007 for the duplicate", () => {
    const found = codesOf(`type Route = Text\ntype Route = Int\n${TAIL}`);
    expect(found.filter((c) => c === "E0231")).toHaveLength(2);
    expect(found).toContain("E0007");
  });
});

describe("a program declaring a type under a declarable name", () => {
  it.each(DECLARABLE)("is accepted for %s, and the uses mean the program's type", (_, decls) => {
    expect(diagnostics(`${decls}\n${TAIL}`)).toEqual([]);
  });
});

describe("a use of a reserved name keeps the standard library's type", () => {
  it("checks a slot against the standard library's Route, not the declared Text", () => {
    expect(diagnostics(`type Route = Text\nslot r : Route = "x"\n${TAIL}`)).toEqual([
      `E0231 1:1 ${collision("Route")}`,
      "E0201 2:18 Expected Route but got Text",
    ]);
  });

  it("follows an alias to the standard library's definition, so a self-alias is no cycle", () => {
    expect(codesOf(`type Route = Route\n${TAIL}`)).toEqual(["E0231"]);
  });

  it("types an error-boundary fallback's $1 as the PanicInfo the runtime builds", () => {
    const src = `type PanicInfo = Text
slot secret : Option(Text) = None
tile Fb in=PanicInfo = column(text("recovered: " + $1.message))
tile Risky error-boundary=Fb = column(text(secret.get))
tile App = column(Risky)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
    expect(diagnostics(src)).toEqual([`E0231 1:1 ${collision("PanicInfo")}`]);
  });

  it("refuses a fallback typed by a program's own PanicInfo at the declaration", () => {
    const src = `type PanicInfo = Text
slot secret : Option(Text) = None
slot reveal : Bool = false
tile Fb in=PanicInfo = column(text("recovered: " + $1))
tile Risky error-boundary=Fb = when(reveal, text(secret.get))
tile Btn = button(text="go") {id: "go"}
reducer go on=ui.click(Btn) do= reveal := true
tile App = column(Risky, Btn)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
    expect(diagnostics(src)).toEqual([`E0231 1:1 ${collision("PanicInfo")}`]);
  });
});

describe("the standard library names everywhere else", () => {
  const positions = (n: string): [string, string][] => {
    const lower = `${n.charAt(0).toLowerCase()}${n.slice(1)}`;
    return [
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
  };
  // `slot route` is E0115: that name is the router's slot, not a type's.
  const cases = STDLIB_TYPES.flatMap((t) =>
    positions(t.name)
      .filter(([, decls]) => !decls.startsWith("slot route "))
      .map(([where, decls]) => ({ name: t.name, where, decls })),
  );
  it.each(cases)("leaves $name in $where alone", ({ decls }) => {
    expect(diagnostics(`${decls}\n${TAIL}`)).toEqual([]);
  });
});
