// Which members a receiver has (docs/spec/stdlib.md §2.2), decided per receiver.
//
// The checker used to ask one flat question — "does the runtime know this name
// on some receiver?" — so a member of one container was a member of all of
// them. `res.filter(…)` on a `Result` passed `check` and the runtime read the
// `Result` as a `Map`, answering `{}`; `opt.keys` handed back the object's own
// `_tag` / `_0` as data. §2.2.3's dispatch rule makes a name that is neither a
// field nor a member of a *known* receiver E0108, and these pin that rule.

import { readFileSync } from "node:fs";
import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { METHOD_MIN_ARGS } from "../src/codegen/expr.ts";
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

const recv = (r: Receiver): string => PARAMS[r].split(":")[0] as string;

/** `recv.member` written with as many arguments as the member needs. */
function use(r: Receiver, member: string, parens: boolean): string {
  const n = METHOD_MIN_ARGS.get(member) ?? 0;
  const args = Array.from({ length: n }, () => "1").join(", ");
  return parens || n > 0 ? `${recv(r)}.${member}(${args})` : `${recv(r)}.${member}`;
}

/** The codes for a `fn` whose body reads `expr`. */
function codes(expr: string): string[] {
  const src = `fn probe(${Object.values(PARAMS).join(", ")}) -> Text = (${expr}).show\n${APP}`;
  return check(parse(lex(src))).map((e) => e.code);
}

/** The E0108 messages for `slot`s declared by `decls`, read by `body`. */
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
  // Each row is its own program declaring only what it reads, so an E0108
  // cannot come from a neighbour.
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
    ["slot st : Set(Int) = [1, 2, 3]\nslot n : Int = 0", "n := st.filter($1 > 1).size", "Set"],
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
      'Type "Result" has no member ".filter" — it is a member of Map / List / Option',
    );
  });

  it("reports an assignment through a member of another receiver the same way", () => {
    const errs = reducerErrors("slot opt : Option(Int) = Some(3)", "opt.keys := []");
    expect(errs.map((e) => e.code)).toEqual(["E0108"]);
  });

  it("reports .copy on a receiver that is not a record, and not on one that is", () => {
    // `n.copy(z=1)` lowered to a record spread over a number and put `{z: 1}`
    // in an `Int` slot. On a record it is the update form (language.md §1.6.3).
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
    // A `$1` bound to an element that is itself a `List` is not resolved
    // (§2.2.2), so the name-based dispatch §2.2.3 keeps for it still applies.
    const errs = reducerErrors(
      "slot xss : List(List(Int)) = []\nslot n : Int = 0",
      "n := xss.map($1.size).length",
    );
    expect(errs.map((e) => e.code)).not.toContain("E0108");
  });
});

// Every receiver against every name another receiver has: the member is
// accepted exactly where its own row lists it, in both spellings.
describe("the per-receiver table, enumerated", () => {
  const every = new Set(Object.values(RECEIVER_MEMBERS).flat() as string[]);
  // A `Duration` is a `nominal Int`, so it is a number with one member more.
  const own = (r: Receiver): Set<string> =>
    new Set<string>([
      ...RECEIVER_MEMBERS[r],
      ...(r === "Duration" ? RECEIVER_MEMBERS.Int : []),
      // A `File`'s metadata is a field, not a member (§2.1).
      ...(r === "File" ? ["name", "size", "type"] : []),
      ...UNIVERSAL_MEMBERS,
    ]);

  for (const r of Object.keys(PARAMS) as Receiver[]) {
    it(`${r} accepts its own members and nothing else`, () => {
      const wrong: string[] = [];
      for (const m of every) {
        for (const parens of [false, true]) {
          const expr = use(r, m, parens);
          const reported = codes(expr).includes("E0108");
          if (reported === own(r).has(m)) wrong.push(`${expr} ${reported ? "E0108" : "ok"}`);
        }
      }
      expect(wrong).toEqual([]);
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

/**
 * The members §2.2.N lists for each receiver, read out of the section's
 * signature block. A qualified name (`Time.now`, `Duration.ms(n)`) is a
 * constructor, not a member; `show` is the member every value has and is read
 * from the Int / Float block like the rest, then set aside.
 */
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
