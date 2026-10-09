import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

function freshRoot(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

const CASES: ReadonlyArray<[label: string, type: string, value: string, empty: boolean]> = [
  ["an empty Map", "Map(Text, Int)", "{}", true],
  ["a non-empty Map", "Map(Text, Int)", '{"a": 1}', false],
  ["an empty List", "List(Int)", "[]", true],
  ["a non-empty List", "List(Int)", "[1]", false],
  ["an empty Text", "Text", '""', true],
  ["a non-empty Text", "Text", '"abc"', false],
];

const SPELLINGS = ["v.is-empty", "v.is-empty()"] as const;

const program = (
  type: string,
  value: string,
  empty: boolean,
): string => `slot v : ${type} = ${value}
slot bare : Bool = ${!empty}
slot paren : Bool = ${!empty}
reducer read on=app.start do=
    bare := ${SPELLINGS[0]}
    paren := ${SPELLINGS[1]}
tile App = column(text("x"))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

describe("x.is-empty and x.is-empty() are one member", () => {
  it.each(
    CASES,
  )("both spellings answer the same, right answer on %s", async (_l, type, value, empty) => {
    const shape = await loadSource(program(type, value, empty));
    const report = await runScenario(shape, freshRoot(), {
      steps: [{ expect: { noErrors: true, state: { bare: empty, paren: empty } } }],
    });
    expect(report.steps.flatMap((s) => s.failures)).toEqual([]);
  });
});
