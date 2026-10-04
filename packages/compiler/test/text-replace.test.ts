// `Text.replace(from, to)` (stdlib.md §2.2.6): every occurrence of `from`,
// matched as plain text, is replaced by `to` exactly as written.
//
// JavaScript's `replaceAll` reads a string replacement as a pattern — `$$` is
// `$`, `$&` the match, `` $` `` and `$'` the text before and after it — and
// Kumiki has no such syntax, so `to` must never reach it as one. These run the
// lowered expression instead of reading the generated JS: what the module
// computes is the claim, whichever way the lowering spells it.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "@kumikijs/compiler";
import { beforeAll, describe, expect, it } from "vitest";

type Case = { recv: string; from: string; to: string; out: string };

/** A `to` that holds each of JavaScript's replacement patterns. */
const PATTERNS: Case[] = [
  { recv: "cost: X", from: "X", to: "$$5", out: "cost: $$5" },
  { recv: "a-b", from: "-", to: "$&$&", out: "a$&$&b" },
  { recv: "one two", from: " ", to: "$`", out: "one$`two" },
  { recv: "one two", from: " ", to: "$'", out: "one$'two" },
  { recv: "a-b", from: "-", to: "$1$<name>", out: "a$1$<name>b" },
];

/** What `from` matches: every occurrence, as plain text. */
const OCCURRENCES: Case[] = [
  { recv: "a-b-c", from: "-", to: "+", out: "a+b+c" },
  { recv: "a.b.c", from: ".", to: "$", out: "a$b$c" },
  { recv: "a+b", from: "a+", to: "x", out: "xb" },
  { recv: "abc", from: "x", to: "$&", out: "abc" },
  // An empty `from` matches at every position, the end included, as the
  // platform's `replaceAll` matches it.
  { recv: "abc", from: "", to: "-", out: "-a-b-c-" },
];

const CASES = [...PATTERNS, ...OCCURRENCES];

/** A Kumiki Text literal; the cases hold no `"` or `\` that would need an escape. */
function lit(s: string): string {
  if (/["\\]/.test(s)) throw new Error(`the case ${JSON.stringify(s)} needs an escape`);
  return `"${s}"`;
}

/**
 * One reducer writes every case with all three operands literal, into slot
 * `w<i>`; another reads the receiver, `from` and `to` from slots, so `to`
 * reaches the lowering as a value no literal pins. The third draws `to` from
 * `random()`, which answers differently each time it is read.
 */
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

type AppShape = {
  live: Record<string, unknown>;
  reducers: {
    name: string;
    apply: (live: object, payload: object) => { slots: Record<string, unknown> };
  }[];
};

const TMP_ROOT = resolve(__dirname, "test-tmp");
mkdirSync(TMP_ROOT, { recursive: true });

let app: AppShape;

// Writing a module to disk and importing it costs a real module load, which
// overruns the 5s default on a cold cache.
beforeAll(async () => {
  const result = compile(SOURCE, { runtimeSpecifier: "@kumikijs/runtime", exportApp: true });
  if (result.kind !== "ok")
    expect.fail(result.errors.map((e) => `${e.code} ${e.message}`).join("\n"));
  const file = join(mkdtempSync(join(TMP_ROOT, "text-replace-")), "app.mjs");
  writeFileSync(file, result.js);
  const mod: { default: AppShape } = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
  app = mod.default;
}, 30_000);

/** The slot writes of one run of reducer `name`, with the slots holding `live`. */
function run(name: string, live: Record<string, unknown>): Record<string, unknown> {
  Object.assign(app.live, live);
  const reducer = app.reducers.find((r) => r.name === name);
  if (!reducer) expect.fail(`the compiled module has no reducer named ${name}`);
  return reducer.apply({}, {}).slots;
}

/** Each case's result with every operand written as a literal. */
function literalResults(cases: Case[]): unknown[] {
  const slots = run("literals", {});
  return cases.map((c) => slots[`w${CASES.indexOf(c)}`]);
}

/** Each case's result with the receiver, `from` and `to` read from slots. */
function slotResults(cases: Case[]): unknown[] {
  return cases.map((c) => run("fromSlots", { src: c.recv, pat: c.from, rep: c.to }).held);
}

const outs = (cases: Case[]): string[] => cases.map((c) => c.out);

describe("Text.replace inserts `to` as written", () => {
  it("when `to` is a literal", () => {
    expect(literalResults(PATTERNS)).toEqual(outs(PATTERNS));
  });

  it("when `to` is read from a slot", () => {
    expect(slotResults(PATTERNS)).toEqual(outs(PATTERNS));
  });
});

describe("Text.replace replaces every occurrence of `from`, matched as plain text", () => {
  it("when `from` is a literal", () => {
    expect(literalResults(OCCURRENCES)).toEqual(outs(OCCURRENCES));
  });

  it("when `from` is read from a slot", () => {
    expect(slotResults(OCCURRENCES)).toEqual(outs(OCCURRENCES));
  });
});

describe("Text.replace evaluates `to` once", () => {
  it("and inserts that one value at every occurrence of `from`", () => {
    const drawn = String(run("once", {}).drawn);
    const parts = /^x(.+)y(.+)z$/.exec(drawn);
    expect(parts, `${JSON.stringify(drawn)} is not x<to>y<to>z`).not.toBeNull();
    expect(parts?.[1]).toBe(parts?.[2]);
  });
});
