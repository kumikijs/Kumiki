import { beforeAll, describe, expect, it } from "vitest";
import { loadApp, type ReducerShape } from "./helpers/module.ts";

type Case = { recv: string; from: string; to: string; out: string };

/** A `to` that holds each of JavaScript's replacement patterns. */
const PATTERNS: Case[] = [
  { recv: "cost: X", from: "X", to: "$$5", out: "cost: $$5" },
  { recv: "a-b", from: "-", to: "$&$&", out: "a$&$&b" },
  { recv: "one two", from: " ", to: "$`", out: "one$`two" },
  { recv: "one two", from: " ", to: "$'", out: "one$'two" },
];

/** What `from` matches: every occurrence, as plain text. */
const OCCURRENCES: Case[] = [
  { recv: "a-b-c", from: "-", to: "+", out: "a+b+c" },
  { recv: "a.b.c", from: ".", to: "$", out: "a$b$c" },
  { recv: "a+b", from: "a+", to: "x", out: "xb" },
  { recv: "abc", from: "x", to: "$&", out: "abc" },
  { recv: "abc", from: "", to: "-", out: "-a-b-c-" },
  // the inserted text is not scanned again
  { recv: "a-b", from: "-", to: "-+-", out: "a-+-b" },
  // matches don't overlap
  { recv: "aaa", from: "aa", to: "b", out: "ba" },
];

const CASES = [...PATTERNS, ...OCCURRENCES];

/** A Kumiki Text literal; the cases hold no `"` or `\` that would need an escape. */
function lit(s: string): string {
  if (/["\\]/.test(s)) throw new Error(`the case ${JSON.stringify(s)} needs an escape`);
  return `"${s}"`;
}

// `fromSlots` reads every operand from a slot, so no lowering can specialise on a literal; `once`
// draws `to` from `random()`, which differs on each read.
const SOURCE = `slot src   : Text = ""
slot pat   : Text = ""
slot rep   : Text = ""
slot held  : Text = ""
slot drawn : Text = ""
${CASES.map((_, i) => `slot w${i} : Text = ""`).join("\n")}

reducer literals on=ui.click(Lit)
    do= ${CASES.map((c, i) => `w${i} := ${lit(c.recv)}.replace(${lit(c.from)}, ${lit(c.to)})`).join("\n        ")}

reducer fromSlots on=ui.click(Held) do= held := src.replace(pat, rep)

reducer once on=ui.click(Once) do= drawn := "x|y|z".replace("|", random().show)

tile Lit  = button(text="literals")
tile Held = button(text="from slots")
tile Once = button(text="once")
tile App  = column(Lit, Held, Once, text(held), text(drawn))

app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

type AppShape = { live: Record<string, unknown>; reducers: ReducerShape[] };

let app: AppShape;

// A real module load can overrun the 10s hook default on a cold cache.
beforeAll(async () => {
  app = await loadApp<AppShape>(SOURCE, "text-replace");
}, 30_000);

/** The slot writes of one run of reducer `name`, with the slots holding `live`. */
function run(name: string, live: Record<string, unknown>): Record<string, unknown> {
  Object.assign(app.live, live);
  const reducer = app.reducers.find((r) => r.name === name);
  if (!reducer) expect.fail(`the compiled module has no reducer named ${name}`);
  return reducer.apply({}, {}).slots;
}

describe("Text.replace inserts `to` as written", () => {
  it.each(PATTERNS)("when `to` is the literal $to", (c) => {
    expect(run("literals", {})[`w${CASES.indexOf(c)}`]).toBe(c.out);
  });

  it.each(PATTERNS)("when `to` is $to read from a slot", (c) => {
    expect(run("fromSlots", { src: c.recv, pat: c.from, rep: c.to }).held).toBe(c.out);
  });
});

describe("Text.replace replaces every occurrence of `from`, matched as plain text", () => {
  it.each(OCCURRENCES)("$recv with the literal from $from", (c) => {
    expect(run("literals", {})[`w${CASES.indexOf(c)}`]).toBe(c.out);
  });

  it.each(OCCURRENCES)("$recv with from $from read from a slot", (c) => {
    expect(run("fromSlots", { src: c.recv, pat: c.from, rep: c.to }).held).toBe(c.out);
  });
});

describe("Text.replace reads `to` once, not once per match", () => {
  it("and inserts that one value at every occurrence of `from`", () => {
    const drawn = String(run("once", {}).drawn);
    const parts = /^x(.+)y(.+)z$/.exec(drawn);
    expect(parts, `${JSON.stringify(drawn)} is not x<to>y<to>z`).not.toBeNull();
    expect(parts?.[1]).toBe(parts?.[2]);
  });
});
