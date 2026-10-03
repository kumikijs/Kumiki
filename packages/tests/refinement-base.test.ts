// A refinement written over a base it cannot test is a build error, not a slot
// that refuses every write.
//
// Every predicate's check is guarded by the shape it tests, and `one-of`'s is
// a strict `includes`, so each program below used to build and mount — and
// then discard every reducer batch that wrote the slot, because no value of
// its type passes. The generic ones did so only once a refinement on a generic
// alias began gating the slot. Each now fails to build with E0804, and the
// same program over the base the predicate tests mounts and takes the write.

import { check, lex, parse } from "@kumikijs/compiler";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSource } from "./helpers/load.ts";

/** A program whose one slot is typed `type`, starts at `init` and is set to `next`. */
const program = (defs: string, type: string, init: string, next: string): string => `
${defs}
slot v : ${type} = ${init}

reducer set on=ui.click(SetBtn) do= v := ${next}

tile SetBtn = button(text="set", onClick=set)
tile App = column(SetBtn)

app RefinementBase
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

type Case = {
  label: string;
  /** The program as it used to build: the predicate over a base it cannot test. */
  broken: string;
  /** The same program over the base the predicate does test. */
  fixed: string;
  /** What the fixed slot holds after the write. */
  written: unknown;
};

const NON_EMPTY = "type NonEmpty(T) = T where nonempty";

const CASES: Case[] = [
  {
    label: "a numeric predicate over Text",
    broken: program("", "Text where positive", `"a"`, `"b"`),
    fixed: program("", "Int where positive", "1", "2"),
    written: 2,
  },
  {
    label: "a text predicate applied through a generic",
    broken: program(NON_EMPTY, "NonEmpty(Int)", "1", "2"),
    fixed: program(NON_EMPTY, "NonEmpty(Text)", `"a"`, `"b"`),
    written: "b",
  },
  {
    label: "a generic applied behind an alias",
    broken: program(`${NON_EMPTY}\ntype N = NonEmpty(Int)`, "N", "1", "2"),
    fixed: program(`${NON_EMPTY}\ntype N = NonEmpty(Text)`, "N", `"a"`, `"b"`),
    written: "b",
  },
  {
    label: "a nominal generic",
    broken: program("type W(T) = nominal T where positive", "W(Text)", `"a"`, `"b"`),
    fixed: program("type W(T) = nominal T where positive", "W(Int)", "1", "2"),
    written: 2,
  },
  {
    label: "one-of listing numbers over Text",
    broken: program("", "Text where one-of(1, 2)", `"a"`, `"b"`),
    fixed: program("", `Text where one-of("a", "b")`, `"a"`, `"b"`),
    written: "b",
  },
];

let errors: string[];

beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("a refinement over a base it cannot test", () => {
  for (const c of CASES) {
    it(`is E0804 and nothing else: ${c.label}`, () => {
      expect(check(parse(lex(c.broken))).map((e) => e.code)).toEqual(["E0804"]);
    });

    it(`does not build: ${c.label}`, async () => {
      await expect(loadSource(c.broken)).rejects.toThrow(/E0804/);
    });

    it(`takes the write once written over the base it tests: ${c.label}`, async () => {
      expect(check(parse(lex(c.fixed)))).toEqual([]);
      const app = await loadSource(c.fixed);
      const root = document.createElement("div");
      document.body.appendChild(root);
      mount(app, root);

      root.querySelector("button")?.click();

      expect(app.live?.v).toBe(c.written);
      expect(errors).toEqual([]);
    });
  }
});
