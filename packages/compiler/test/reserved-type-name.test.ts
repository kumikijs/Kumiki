import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_TYPE_CONSTRUCTORS,
  isReservedTypeName,
  PRIM_TYPE_NAMES,
  RUNTIME_SUPPLIED_TYPE_NAMES,
  reservedTypeReason,
  STDLIB_TYPES,
} from "../src/stdlib-types.ts";

// A program cannot declare a type under a name that already means a type in
// every program (language.md §1.3.6 inv. 6). Three tables of the checker hold
// those names:
//
// - the primitives (`Int`, `File`, …), which the parser reads as themselves
//   wherever a type is written;
// - the built-in type constructors (`Option`, `List`, `Map`, …), whose values,
//   members and arity the checker knows without a definition;
// - six of the standard library's domain types (stdlib.md §2.1.3), whose values
//   the runtime or the standard library builds or reads: the `PanicInfo` an
//   error-boundary fallback is applied to, the `Route` the router maintains,
//   the `HttpError` a failed request delivers and its `HttpStatus`, a
//   `Duration.ms(5)`, the `FormValue` a multipart body is read by.
//
// E0231 is reported at the declaration, and every use of the name keeps the
// built-in meaning.
//
// The other four domain types name types only a program builds values of. A
// program may declare its own, and its uses then mean the program's type.

const TAIL = `tile App = column(text("x"))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]`;

const diagnostics = (src: string) =>
  check(parse(lex(src))).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);
const codes = (src: string) => check(parse(lex(src))).map((e) => e.code);

/** The E0231 message for `name`, by what the name already means. */
const reservedMessage = (name: string, meaning: string) =>
  `Type "${name}" collides with ${meaning} ${name}; uses of it never see this type`;
const PRIMITIVE = "the primitive type";
const CONSTRUCTOR = "the built-in type constructor";
const RUNTIME = "the standard library's";

/** The six runtime-supplied names, spelled out so dropping one fails its row. */
const RUNTIME_SUPPLIED = ["PanicInfo", "Route", "HttpError", "HttpStatus", "Duration", "FormValue"];

/**
 * One row per reserved name, read from the checker's own tables — a primitive
 * or a constructor added there is reserved without a row being written here.
 */
const RESERVED: [name: string, meaning: string][] = [
  ...PRIM_TYPE_NAMES.map((n): [string, string] => [n, PRIMITIVE]),
  ...[...BUILTIN_TYPE_CONSTRUCTORS.keys()].map((n): [string, string] => [n, CONSTRUCTOR]),
  ...[...RUNTIME_SUPPLIED_TYPE_NAMES].map((n): [string, string] => [n, RUNTIME]),
];

/**
 * Names the rows above must include, so a table that shrank — or a rows
 * expression that stopped reading one — fails here rather than leaving fewer
 * rows that all pass.
 */
const SPOT: [name: string, meaning: string][] = [
  ["Int", PRIMITIVE],
  ["File", PRIMITIVE],
  ["Option", CONSTRUCTOR],
  ["List", CONSTRUCTOR],
  ["Map", CONSTRUCTOR],
  ["PanicInfo", RUNTIME],
];

/**
 * One row per declarable name: a declaration under it, and a use the standard
 * library's definition would refuse — so each row fails if the name is
 * reserved, and again if the use read the standard library's type.
 */
const DECLARABLE: [string, string][] = [
  ["Email", `type Email = {address: Text}\nslot e : Email = {address: "ada@example.com"}`],
  // The standard library's `Url` is a `nominal`, which another nominal over
  // `Text` does not accept; the program's alias of `Text` meets it.
  ["Url", `type Url = Text\ntype Slug = nominal Text\nfn slug(u: Url) -> Slug = u`],
  ["Uuid", `type Uuid = Int\nslot id : Uuid = 5`],
  ["FormData", `type FormData = Text\nslot f : FormData = "x"`],
];

describe("the reserved names", () => {
  it("are the primitives, the built-in constructors and six standard library entries", () => {
    for (const row of SPOT) expect(RESERVED).toContainEqual(row);
    const stdlib = STDLIB_TYPES.map((t) => t.name);
    for (const name of RUNTIME_SUPPLIED_TYPE_NAMES) expect(stdlib).toContain(name);
    expect([...RUNTIME_SUPPLIED_TYPE_NAMES].sort()).toEqual([...RUNTIME_SUPPLIED].sort());
  });

  it("are answered by one predicate, which names the table each comes from", () => {
    const reason: Record<string, string> = {
      [PRIMITIVE]: "primitive",
      [CONSTRUCTOR]: "constructor",
      [RUNTIME]: "runtime-supplied",
    };
    for (const [name, meaning] of RESERVED) {
      expect(reservedTypeReason(name), name).toBe(reason[meaning]);
      expect(isReservedTypeName(name), name).toBe(true);
    }
  });

  it("and the declarable rows cover every other standard library entry", () => {
    // A new standard-library type has to be put in one group or the other.
    const declarable = DECLARABLE.map(([name]) => name);
    expect(STDLIB_TYPES.map((t) => t.name).sort()).toEqual(
      [...RUNTIME_SUPPLIED, ...declarable].sort(),
    );
    for (const name of [...declarable, "Box", "Integer", "Options"]) {
      expect(reservedTypeReason(name), name).toBeUndefined();
      expect(isReservedTypeName(name), name).toBe(false);
    }
  });

  it("include every name the parser reads as a primitive", () => {
    for (const name of PRIM_TYPE_NAMES) {
      const [def] = parse(lex(`type Box = ${name}`)).defs;
      expect(def?.kind === "TypeDef" && def.body.kind, name).toBe("TypePrim");
    }
  });
});

describe("a program declaring a type under a reserved name", () => {
  for (const [name, meaning] of RESERVED) {
    it(`is E0231 at the declaration of "${name}"`, () => {
      const found = check(parse(lex(`slot n : Int = 0\ntype ${name} = {v: Int}\n${TAIL}`)));
      expect(found).toEqual([
        {
          code: "E0231",
          kind: "reserved-type-name",
          message: reservedMessage(name, meaning),
          pos: { line: 2, col: 1 },
        },
      ]);
    });
  }

  it("reports the declaration whatever its body or parameters", () => {
    for (const decl of [
      "type Route = Text",
      "type Duration = Short | Long",
      "type HttpError(T) = {v: T}",
      "type Text = Int",
      "type Int = nominal Text",
      "type Bool = Yes | No",
      "type Time = Int where positive",
      "type Option = Int",
      "type List(T) = {v: T}",
      "type Map(K, V) = {k: K}",
      "type Result(T, E) = Good(T) | Bad(E)",
      "type Tuple(A, B) = {a: A, b: B}",
      "type Set(T) = List(T)",
    ]) {
      expect(codes(`${decl}\n${TAIL}`), decl).toEqual(["E0231"]);
    }
  });

  it("reports a declaration identical to the built-in one too", () => {
    // Declaring again what the name already means adds nothing, and would
    // leave the name free to drift from it.
    for (const decl of [
      "type HttpStatus = nominal Int where between(0, 599)",
      "type Option(T) = None | Some(T)",
      "type Result(T, E) = Ok(T) | Err(E)",
    ]) {
      expect(codes(`${decl}\n${TAIL}`), decl).toEqual(["E0231"]);
    }
  });

  it("reports each declaration of the name", () => {
    // A second declaration is also E0007, which names the duplicate. E0231 is
    // about the name, so each declaration of it carries one.
    for (const name of ["Route", "Int", "Option"]) {
      const found = codes(`type ${name} = Text\ntype ${name} = Bool\n${TAIL}`);
      expect(
        found.filter((c) => c === "E0231"),
        name,
      ).toHaveLength(2);
      expect(found, name).toContain("E0007");
    }
  });
});

describe("a program declaring a type under a declarable name", () => {
  for (const [name, decls] of DECLARABLE) {
    it(`is accepted for "${name}", and the uses mean the program's type`, () => {
      expect(diagnostics(`${decls}\n${TAIL}`)).toEqual([]);
    });
  }
});

describe("a use of a reserved name keeps the standard library's type", () => {
  it("checks a slot against the standard library's Route, not the declared Text", () => {
    expect(diagnostics(`type Route = Text\nslot r : Route = "x"\n${TAIL}`)).toEqual([
      `E0231 1:1 ${reservedMessage("Route", RUNTIME)}`,
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
    expect(diagnostics(src)).toEqual([`E0231 1:1 ${reservedMessage("PanicInfo", RUNTIME)}`]);
  });
});

describe("a use of a primitive name keeps the primitive", () => {
  it("refuses `type Int = Text` on its own", () => {
    expect(diagnostics(`type Int = Text\n${TAIL}`)).toEqual([
      `E0231 1:1 ${reservedMessage("Int", PRIMITIVE)}`,
    ]);
  });

  it("checks a slot typed Int as an Int", () => {
    // `5` is an Int and stands; `"x"` is the Text the declaration meant, which
    // the primitive refuses.
    expect(diagnostics(`type Int = Text\nslot n : Int = 5\nslot t : Int = "x"\n${TAIL}`)).toEqual([
      `E0231 1:1 ${reservedMessage("Int", PRIMITIVE)}`,
      "E0201 3:16 Expected Int but got Text",
    ]);
  });

  it("checks a slot typed File as a File, inside a constructor and out", () => {
    const src = `type File = Text\nslot f : Option(File) = None\nslot g : File = "x"\n${TAIL}`;
    expect(diagnostics(src)).toEqual([
      `E0231 1:1 ${reservedMessage("File", PRIMITIVE)}`,
      "E0201 3:17 Expected File but got Text",
    ]);
  });

  it("follows a self-alias to the primitive, so it is no cycle", () => {
    expect(codes(`type Int = Int\n${TAIL}`)).toEqual(["E0231"]);
  });
});

describe("a use of a constructor name keeps the built-in constructor", () => {
  it("refuses `type Option = Int` on its own", () => {
    expect(diagnostics(`type Option = Int\n${TAIL}`)).toEqual([
      `E0231 1:1 ${reservedMessage("Option", CONSTRUCTOR)}`,
    ]);
  });

  it("checks `Option(Int)` against the built-in Option, with no arity report", () => {
    expect(diagnostics(`type Option = Int\nslot o : Option(Int) = None\n${TAIL}`)).toEqual([
      `E0231 1:1 ${reservedMessage("Option", CONSTRUCTOR)}`,
    ]);
  });

  it("reads a bare `Option` as the built-in constructor missing its argument", () => {
    // The declaration gave `Option` no parameters; the built-in takes one, and
    // that is the arity the use is measured against.
    expect(diagnostics(`type Option = Int\nslot o : Option = 5\n${TAIL}`)).toEqual([
      `E0231 1:1 ${reservedMessage("Option", CONSTRUCTOR)}`,
      `E0210 2:10 Type "Option" expects 1 type argument(s) but got 0`,
    ]);
  });

  it("accepts a list for `List(Int)` and refuses the declared record shape", () => {
    expect(diagnostics(`type List(T) = {v: T}\nslot b : List(Int) = [1, 2]\n${TAIL}`)).toEqual([
      `E0231 1:1 ${reservedMessage("List", CONSTRUCTOR)}`,
    ]);
    expect(diagnostics(`type List(T) = {v: T}\nslot a : List(Int) = {v: 1}\n${TAIL}`)).toEqual([
      `E0231 1:1 ${reservedMessage("List", CONSTRUCTOR)}`,
      "E0201 2:22 Expected List(Int) but got {v: Int}",
    ]);
  });

  it("looks a member up on the built-in List", () => {
    const src = (body: string) => `type List(T) = {v: T}\nfn f(l: List(Int)) -> Int = ${body}`;
    expect(diagnostics(`${src("l.length")}\n${TAIL}`)).toEqual([
      `E0231 1:1 ${reservedMessage("List", CONSTRUCTOR)}`,
    ]);
    expect(diagnostics(`${src("l.v")}\n${TAIL}`)).toEqual([
      `E0231 1:1 ${reservedMessage("List", CONSTRUCTOR)}`,
      `E0108 2:29 Type "List" has no member ".v"`,
    ]);
  });

  it("checks `Map(Text, Int)` against the built-in Map", () => {
    const decl = "type Map(K, V) = {k: K}";
    expect(diagnostics(`${decl}\nslot m : Map(Text, Int) = {"a": 1}\n${TAIL}`)).toEqual([
      `E0231 1:1 ${reservedMessage("Map", CONSTRUCTOR)}`,
    ]);
    expect(diagnostics(`${decl}\nslot m : Map(Text, Int) = {k: "a"}\n${TAIL}`)).toEqual([
      `E0231 1:1 ${reservedMessage("Map", CONSTRUCTOR)}`,
      "E0201 2:27 Expected Map(Text, Int) but got {k: Text}",
    ]);
  });

  it("checks `Set`, `Result` and `Tuple` against the built-ins, with no arity report", () => {
    for (const src of [
      `type Set(T) = {v: T}\nslot s : Set(Int) = [1]`,
      `type Result(T, E) = {v: T}\nslot r : Result(Int, Text) = Err("x")`,
      `type Tuple = {a: Int}\nslot p : Tuple(Int, Int) = (1, 2)`,
    ]) {
      expect(codes(`${src}\n${TAIL}`), src).toEqual(["E0231"]);
    }
  });

  it("follows a self-application to the built-in, so it is no cycle", () => {
    expect(codes(`type List(T) = List(T)\n${TAIL}`)).toEqual(["E0231"]);
    expect(codes(`type Option = Option(Int)\n${TAIL}`)).toEqual(["E0231"]);
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
    expect(diagnostics(src)).toEqual([`E0231 1:1 ${reservedMessage("PanicInfo", RUNTIME)}`]);
  });
});

describe("the standard library names everywhere else", () => {
  // Only `type <reserved name> = …` is refused. Each of these writes one of
  // the names in a position that reads it, or declares something that is not
  // a type.
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

describe("the primitive and constructor names everywhere else", () => {
  // Only `type <name> = …` is refused. Each of these writes one of the names
  // in a position that reads it, declares a type under a longer or lower-case
  // name, or declares something that is not a type.
  const use = (n: string): string =>
    BUILTIN_TYPE_CONSTRUCTORS.has(n)
      ? `${n}(${n === "Map" || n === "Result" ? "Text, Int" : "Int"})`
      : n;
  for (const n of [...PRIM_TYPE_NAMES, ...BUILTIN_TYPE_CONSTRUCTORS.keys()]) {
    const lower = `${n.charAt(0).toLowerCase()}${n.slice(1)}`;
    const positions: [string, string][] = [
      ["a slot annotation", `slot x : Option(${use(n)}) = None`],
      ["a fn parameter and return", `fn f(a: Option(${use(n)})) -> Option(${use(n)}) = a`],
      ["a record field", `type Box = {v: ${use(n)}}\nslot b : Option(Box) = None`],
      ["an alias of it", `type Mine = ${use(n)}\nslot b : Option(Mine) = None`],
      ["a type whose name starts with it", `type ${n}View = {v: Int}\nslot b : ${n}View = {v: 1}`],
      ["a type whose name ends with it", `type App${n} = Int\nslot b : App${n} = 1`],
      ["a lower-case type of that spelling", `type ${lower} = Int\nslot b : ${lower} = 1`],
      ["a slot of that spelling", `slot ${lower} : Int = 0`],
      ["a fn of that spelling", `fn ${lower}(a: Int) -> Int = a`],
      ["a tile of that name", `tile ${n} = text("t")`],
    ];
    for (const [where, decls] of positions) {
      it(`leaves "${n}" in ${where} alone`, () => {
        expect(diagnostics(`${decls}\n${TAIL}`)).toEqual([]);
      });
    }
  }
});
