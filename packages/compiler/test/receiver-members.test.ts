import { readFileSync } from "node:fs";
import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { KNOWN_MEMBERS, METHOD_MIN_ARGS } from "../src/codegen/expr.ts";
import { RECEIVER_MEMBERS, type Receiver, UNIVERSAL_MEMBERS } from "../src/stdlib-members.ts";

const APP = `tile App = column(text("x"))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

/** The parameters `probe` is given, one per receiver, named for it. */
const PARAMS: Record<Receiver, string> = {
  Map: "m: Map(Text, Int)",
  Set: "s: Set(Int)",
  List: "xs: List(Int)",
  Option: "o: Option(Int)",
  Result: "r: Result(Int, Text)",
  Text: "t: Text",
  Int: "i: Int",
  Float: "f: Float",
  Bool: "b: Bool",
  Time: "tm: Time",
  Duration: "d: Duration",
  Bytes: "by: Bytes",
  File: "fl: File",
};

const WRAPPED: [param: string, reads: Receiver][] = [
  ["rd: RefinedDuration", "Duration"],
  ["nd: NominalDuration", "Duration"],
  ["ids: Ids", "List"],
  ["mt: Meters", "Int"],
];
const WRAPPED_DECLS = `type RefinedDuration = Duration where between(0, 1000)
type NominalDuration = nominal Duration
type Ids = List(Int)
type Meters = nominal Int
`;

/** Parameters besides one per receiver, for the fragment probes below. */
const EXTRA_PARAMS = ["fs: List(Float)"];

const nameOf = (param: string): string => param.split(":")[0] as string;

/** `recv.member` written with as many arguments as the member needs. */
function use(recv: string, member: string, parens: boolean): string {
  const n = METHOD_MIN_ARGS.get(member) ?? 0;
  const args = Array.from({ length: n }, () => "1").join(", ");
  return parens || n > 0 ? `${recv}.${member}(${args})` : `${recv}.${member}`;
}

/** The errors for a `fn` whose body reads `expr`. */
function probe(expr: string) {
  const params = [...Object.values(PARAMS), ...WRAPPED.map(([p]) => p), ...EXTRA_PARAMS];
  const src = `${WRAPPED_DECLS}fn probe(${params.join(", ")}) -> Text = (${expr}).show\n${APP}`;
  return check(parse(lex(src)));
}

/** The codes for a `fn` whose body reads `expr`. */
function codes(expr: string): string[] {
  return probe(expr).map((e) => e.code);
}

/** Every `check` error for `slot`s declared by `decls`, read by `body`. */
function reducerErrors(decls: string, body: string) {
  const src = `${decls}
reducer run on=ui.click(Run) do= ${body}
tile Run = button(text="run")
tile App = column(Run)
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
  return check(parse(lex(src)));
}

describe("a member of one container on another", () => {
  const rows: [string, string, string][] = [
    [
      'slot res : Result(Int, Text) = Ok(3)\nslot sink : Result(Int, Text) = Err("x")',
      "sink := res.filter($1 > 2)",
      "Result",
    ],
    ["slot res : Result(Int, Text) = Ok(3)\nslot n : Int = 0", "n := res.values.length", "Result"],
    ["slot opt : Option(Int) = Some(3)\nslot n : Int = 0", "n := opt.keys.length", "Option"],
    ["slot opt : Option(Int) = Some(3)\nslot n : Int = 0", "n := opt.size", "Option"],
    ["slot opt : Option(Int) = Some(3)\nslot n : Int = 0", "n := opt.entries.length", "Option"],
    ["slot st : Set(Int) = [1, 2, 3]\nslot n : Int = 0", "n := st.map($1 * 2).length", "Set"],
  ];
  for (const [decls, body, type] of rows) {
    it(`${body} is E0108 naming ${type}`, () => {
      const errs = reducerErrors(decls, body).filter((e) => e.code === "E0108");
      expect(errs).toHaveLength(1);
      expect(errs[0]?.message).toContain(`Type "${type}" has no member`);
    });
  }

  it("names the receivers that do have the member", () => {
    const [err] = reducerErrors(
      'slot res : Result(Int, Text) = Ok(3)\nslot sink : Result(Int, Text) = Err("x")',
      "sink := res.filter($1 > 2)",
    );
    expect(err?.message).toBe(
      'Type "Result" has no member ".filter" — it is a member of Map / Set / List / Option',
    );
  });

  it("reports an assignment through a member of another receiver the same way", () => {
    const errs = reducerErrors("slot opt : Option(Int) = Some(3)", "opt.keys := []");
    expect(errs.map((e) => e.code)).toEqual(["E0108"]);
  });

  it("reports .copy on a receiver that is not a record, and not on one that is", () => {
    const n = reducerErrors("slot n : Int = 0", "n := n.copy(z=1)");
    expect(n.map((e) => e.code)).toEqual(["E0108"]);
    const rec = reducerErrors("slot rec : {z: Int} = {z: 0}", "rec := rec.copy(z=1)");
    expect(rec.map((e) => e.code)).toEqual([]);
  });

  it("reports .ms, which §2.2.9 has only as a constructor, on a Duration", () => {
    const errs = reducerErrors("slot d : Duration = Duration.s(1)\nslot n : Int = 0", "n := d.ms");
    expect(errs.map((e) => e.code)).toEqual(["E0108"]);
  });

  it("stays silent on a receiver whose type it cannot decide", () => {
    const errs = reducerErrors(
      "slot xs : List(Int) = []\nslot n : Int = 0",
      "n := xs.fold([], $1.push($2)).map($1.size).length",
    );
    expect(errs.map((e) => e.code)).not.toContain("E0108");
  });
});

describe("the per-receiver table, enumerated", () => {
  const every = new Set<string>([
    ...(Object.values(RECEIVER_MEMBERS).flat() as string[]),
    ...KNOWN_MEMBERS,
    ...UNIVERSAL_MEMBERS,
  ]);
  // A `Duration` is a `nominal Int`, so it is a number with one member more.
  const own = (r: Receiver): Set<string> =>
    new Set<string>([
      ...RECEIVER_MEMBERS[r],
      ...(r === "Duration" ? RECEIVER_MEMBERS.Int : []),
      // A `File`'s metadata is a field, not a member (§2.1).
      ...(r === "File" ? ["name", "size", "type"] : []),
      ...UNIVERSAL_MEMBERS,
    ]);

  const receivers: [param: string, reads: Receiver][] = [
    ...(Object.entries(PARAMS) as [Receiver, string][]).map(([r, p]): [string, Receiver] => [p, r]),
    ...WRAPPED,
  ];
  for (const [param, r] of receivers) {
    it(`${param} accepts the ${r} row and nothing else`, () => {
      const wrong: string[] = [];
      for (const m of every) {
        for (const parens of [false, true]) {
          const expr = use(nameOf(param), m, parens);
          const reported = codes(expr).includes("E0108");
          if (reported === own(r).has(m)) wrong.push(`${expr} ${reported ? "E0108" : "ok"}`);
        }
      }
      expect(wrong).toEqual([]);
    });
  }
});

describe("a Duration under an alias, a refinement or a nominal", () => {
  const rows: [string, string, string][] = [
    [
      "a refined alias",
      "type W = Duration where between(0, 1000)\nslot w : W = Duration.ms(5)\nslot n : Int = 0",
      "n := w.to-ms",
    ],
    [
      "an inline refinement",
      "slot w : Duration where between(0, 1000) = Duration.ms(5)\nslot n : Int = 0",
      "n := w.to-ms",
    ],
    [
      "a nominal over it",
      "type W = nominal Duration\nslot w : W = 0\nslot n : Int = 0",
      "n := w.to-ms",
    ],
    [
      "a list element read through $1",
      "type W = Duration where between(0, 1000)\nslot ws : List(W) = []",
      "ws := ws.sort-by($1.to-ms)",
    ],
  ];
  for (const [what, decls, body] of rows) {
    it(`has .to-ms through ${what}`, () => {
      expect(reducerErrors(decls, body).map((e) => e.code)).toEqual([]);
    });
  }

  it("is a program's own `type Duration` when one is declared, which may lack .to-ms", () => {
    const errs = reducerErrors(
      "type Duration = Int\nslot d : Duration = 0\nslot n : Int = 0",
      "n := d.to-ms",
    );
    expect(errs.map((e) => e.message)).toEqual([
      'Type "Int" has no member ".to-ms" — it is a member of Time / Duration',
    ]);
  });
});

describe("the receiver an E0108 names", () => {
  const rows: [string, string, string][] = [
    [
      "slot d : Duration = Duration.s(1)\nslot n : Int = 0",
      "n := d.ms",
      'Type "Duration" has no member ".ms"',
    ],
    [
      "slot d : Duration = Duration.s(1)\nslot n : Int = 0",
      "n := d.length",
      'Type "Duration" has no member ".length" — it is a member of List / Text',
    ],
    [
      "type W = Duration where between(0, 1000)\nslot w : W = Duration.ms(5)\nslot n : Int = 0",
      "n := w.size",
      'Type "Duration" has no member ".size" — it is a member of Map / Set',
    ],
    [
      "type Ids = List(Int)\nslot ids : Ids = []\nslot n : Int = 0",
      "n := ids.size",
      'Type "List" has no member ".size" — it is a member of Map / Set',
    ],
  ];
  for (const [decls, body, message] of rows) {
    it(`${body} → ${message}`, () => {
      expect(reducerErrors(decls, body).map((e) => e.message)).toEqual([message]);
    });
  }

  it("names a Duration in E0602 too, where the member is its own", () => {
    const errs = reducerErrors("slot d : Duration = Duration.s(1)", "d.to-ms := 1");
    expect(errs.map((e) => e.message)).toEqual([
      'Cannot assign through ".to-ms": it is a member of "Duration", not a field',
    ]);
  });
});

describe("members on a fragment's $1 / $2", () => {
  const pairs: [ok: string, bad: string][] = [
    ["xs.filter($1.abs > 0)", "xs.filter($1.size > 0)"],
    ["xs.map($1.abs)", "xs.map($1.size)"],
    ["xs.find($1.abs > 0)", "xs.find($1.size > 0)"],
    ["xs.sort-by($1.abs)", "xs.sort-by($1.size)"],
    ["fs.map($1.sqrt)", "fs.map($1.length)"],
    ["xs.fold(0, $1 + $2.abs)", "xs.fold(0, $1 + $2.size)"],
    ["m.entries.map($1.length)", "m.entries.map($1.size)"],
    ["m.entries.map($2.abs)", "m.entries.map($2.size)"],
    ["m.filter($1.length > 0)", "m.filter($1.abs > 0)"],
    ["m.filter($2.abs > 0)", "m.filter($2.size > 0)"],
    ['m.update("k", $1.abs)', 'm.update("k", $1.size)'],
    ["o.map($1.abs)", "o.map($1.size)"],
    ["o.filter($1.abs > 0)", "o.filter($1.size > 0)"],
    ["o.flat-map(Some($1.abs))", "o.flat-map(Some($1.size))"],
    ["r.map($1.abs)", "r.map($1.size)"],
    ["r.map-err($1.length)", "r.map-err($1.abs)"],
  ];
  for (const [ok, bad] of pairs) {
    it(`${ok} is ok, ${bad} is E0108`, () => {
      expect(codes(ok)).toEqual([]);
      expect(codes(bad)).toEqual(["E0108"]);
    });
  }
});

describe("a member of another receiver on a member's result", () => {
  const rows: [string, string][] = [
    ["xs.head.size", 'Type "Option" has no member ".size"'],
    ['m.get("k").keys', 'Type "Option" has no member ".keys"'],
    ["r.to-option.values", 'Type "Option" has no member ".values"'],
    ['t.split(",").size', 'Type "List" has no member ".size"'],
    ["m.keys.size", 'Type "List" has no member ".size"'],
    ["s.to-list.size", 'Type "List" has no member ".size"'],
  ];
  for (const [expr, head] of rows) {
    it(`${expr} is E0108`, () => {
      const errs = probe(expr);
      expect(errs.map((e) => e.code)).toEqual(["E0108"]);
      expect(errs[0]?.message.startsWith(head)).toBe(true);
    });
  }
});

/** `line` split at the commas that are not inside parentheses. */
function topLevelPieces(line: string): string[] {
  const pieces = [""];
  let depth = 0;
  for (const ch of line) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) pieces.push("");
    else pieces[pieces.length - 1] += ch;
  }
  return pieces;
}

function specMembers(path: string): Map<Receiver, Set<string>> {
  const md = readFileSync(new URL(path, import.meta.url), "utf8");
  const out = new Map<Receiver, Set<string>>();
  const sections = md.split(/^### 2\.2\.\d+ /m).slice(1);
  for (const section of sections) {
    const heading = section.slice(0, section.indexOf("\n"));
    const receivers = heading.split("/").map((h) => h.trim().replace(/\(.*$/, "")) as Receiver[];
    for (const r of receivers) out.set(r, new Set());
    const block = /^```\n([\s\S]*?)^```/m.exec(section)?.[1] ?? "";
    for (const raw of block.split("\n")) {
      const line = raw.replace(/;.*$/, "");
      const names = line.includes(" : ")
        ? [line.slice(0, line.indexOf(" : "))]
        : topLevelPieces(line);
      for (const piece of names) {
        const m = /^\s*([a-z][a-z0-9-]*)(?:\([^)]*\))?\s*(?:\((Int|Float)\b.*)?$/.exec(piece);
        if (!m?.[1]) continue;
        for (const r of m[2] ? [m[2] as Receiver] : receivers) out.get(r)?.add(m[1]);
      }
    }
    if (section.startsWith("Int / Float")) {
      for (const r of receivers) out.get(r)?.delete("show");
    }
  }
  return out;
}

describe("the table is the one §2.2 lists", () => {
  for (const [track, path] of [
    ["en", "../../../docs/spec/stdlib.md"],
    ["ja", "../../../docs/ja/spec/stdlib.md"],
  ] as const) {
    it(`matches the ${track} spec, receiver by receiver`, () => {
      const spec = specMembers(path);
      const table = new Map(
        (Object.keys(RECEIVER_MEMBERS) as Receiver[])
          .filter((r) => r !== "Bool" && r !== "File")
          .map((r) => [r, new Set<string>(RECEIVER_MEMBERS[r])]),
      );
      expect(spec).toEqual(table);
    });
  }

  it("lists `show` as the member every value has", () => {
    expect([...UNIVERSAL_MEMBERS]).toEqual(["show"]);
  });
});
