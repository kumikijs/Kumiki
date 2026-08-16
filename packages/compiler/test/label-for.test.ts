// A `label {for: …}` that names no id (E0705).
//
// `for` is the whole of what makes a label a label: it is what focuses the
// control when the label is clicked and what gives the field its accessible
// name. A `for` pointing at nothing reads, in source, exactly like one that
// works — and two of the corpus apps had five such labels between them.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

function codes(source: string, strictA11y = true): string[] {
  return check(parse(lex(source)), { strictA11y }).map((e) => e.code);
}

function program(body: string): string {
  return `slot draft : Text = ""

tile Probe = ${body}

app P
    caps   = []
    routes = {"/" -> Probe, "/404" -> Probe}
    init   = []
`;
}

describe("E0705 label-for (#251)", () => {
  it("reports a for that names no id in the program", () => {
    expect(codes(program('column(label(text="Name") {for: "name"})'))).toContain("E0705");
  });

  it("accepts a for whose id is declared as an argument", () => {
    const src = program('column(label(text="Name") {for: "name"}, input(id="name", bind=draft))');
    expect(codes(src)).not.toContain("E0705");
  });

  it("accepts a for whose id is declared in a props block", () => {
    const src = program('column(label(text="Name") {for: "name"}, input(bind=draft) {id: "name"})');
    expect(codes(src)).not.toContain("E0705");
  });

  it("resolves across definitions, not only within one tile", () => {
    const src = `slot draft : Text = ""

tile Field = input(id="name", bind=draft)
tile Probe = column(label(text="Name") {for: "name"}, Field)

app P
    caps   = []
    routes = {"/" -> Probe, "/404" -> Probe}
    init   = []
`;
    expect(codes(src)).not.toContain("E0705");
  });

  it("finds the id inside a conditional or a loop", () => {
    const src = program(
      'column(label(text="Name") {for: "name"}, when(true, input(id="name", bind=draft)))',
    );
    expect(codes(src)).not.toContain("E0705");
  });

  it("reports the argument form too — it reaches the DOM the same way", () => {
    expect(codes(program('column(label(text="Name", for="nope"))'))).toContain("E0705");
  });

  it("resolves against an id written as an argument or a prop, either way", () => {
    const src = program('column(label(text="Name", for="name"), input(bind=draft) {id: "name"})');
    expect(codes(src)).not.toContain("E0705");
  });

  it("says nothing about a for that is not a literal", () => {
    const src = program('column(label(text="Name") {for: "row-" + draft})');
    expect(codes(src)).not.toContain("E0705");
  });

  it("reports a literal for against a computed id, and says so on purpose", () => {
    // One literal name cannot address a control per row. The fix is to build
    // the `for` the same way the id is built, which the check then skips.
    const computed = program(
      'column(label(text="Name") {for: "row-1"}, input(bind=draft) {id: "row-" + draft})',
    );
    expect(codes(computed)).toContain("E0705");
    const both = program(
      'column(label(text="Name") {for: "row-" + draft}, input(bind=draft) {id: "row-" + draft})',
    );
    expect(codes(both)).not.toContain("E0705");
  });

  it("stays quiet without the opt-in", () => {
    expect(codes(program('column(label(text="Name") {for: "name"})'), false)).not.toContain(
      "E0705",
    );
  });
});
