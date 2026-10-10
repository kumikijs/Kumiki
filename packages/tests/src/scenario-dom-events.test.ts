import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { freshRoot } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";
import { withApp } from "./helpers/source.ts";

const FOCUS_APP = withApp(`
slot focusedField : Text = ""
slot blurCount    : Int  = 0
slot draft        : Text = ""
reducer onFocus on=ui.focus(NameInput) do= focusedField := "name"
reducer onBlur  on=ui.blur(NameInput)  do= blurCount := blurCount + 1
tile NameInput = input(bind=draft, placeholder="x") {id: "name-input"}
tile App = column(NameInput, text(focusedField), text(blurCount.show))
`);

const KEY_APP = withApp(`
slot lastKey  : Text = ""
slot lastCode : Text = "unset"
slot hovers   : Int  = 0
reducer onKey
    on=ui.key(Field)
    do= lastKey  := $el.key
        lastCode := $el.code
reducer onHover on=ui.hover(Card)    do= hovers := hovers + 1
tile Field = input(placeholder="x") {id: "field"}
tile Card  = box(text("hover me")) {id: "card"}
tile App   = column(Field, Card, text(lastKey), text(hovers.show))
`);

const NESTED_APP = withApp(`
slot keyHits   : Int = 0
slot hoverHits : Int = 0
reducer onKey   on=ui.key(Decoy)   do= keyHits := keyHits + 1
reducer onHover on=ui.hover(Decoy) do= hoverHits := hoverHits + 1
tile Decoy = input(placeholder="decoy")
tile Inner = input(placeholder="x") {id: "inner"}
tile Outer = box(Inner) {id: "outer", onKeyDown: onKey, onMouseEnter: onHover}
tile App   = column(Outer, text(keyHits.show), text(hoverHits.show))
`);

describe("focus / blur / key / hover steps dispatch real DOM events", () => {
  it("fires the ui.focus reducer of the focused element", async () => {
    const report = await runScenario(await loadSource(FOCUS_APP), freshRoot(), {
      steps: [
        {
          do: { focus: "#name-input" },
          expect: { noErrors: true, state: { focusedField: "name" } },
        },
      ],
    });
    expect(report.ok, failureDetail(report)).toBe(true);
  });

  it("fires the ui.blur reducer once per blur", async () => {
    const report = await runScenario(await loadSource(FOCUS_APP), freshRoot(), {
      steps: [
        { do: { blur: "#name-input" }, expect: { noErrors: true, state: { blurCount: 1 } } },
        { do: { blur: "#name-input" }, expect: { state: { blurCount: 2 } } },
      ],
    });
    expect(report.ok, failureDetail(report)).toBe(true);
  });

  it("hands the pressed key to the reducer, and an empty code", async () => {
    const report = await runScenario(await loadSource(KEY_APP), freshRoot(), {
      steps: [
        {
          do: { key: "#field", value: "Enter" },
          expect: { noErrors: true, state: { lastKey: "Enter", lastCode: "" } },
        },
      ],
    });
    expect(report.ok, failureDetail(report)).toBe(true);
  });

  it("counts a mouseenter per hover", async () => {
    const report = await runScenario(await loadSource(KEY_APP), freshRoot(), {
      steps: [
        { do: { hover: "#card" }, expect: { noErrors: true, state: { hovers: 1 } } },
        { do: { hover: "#card" }, expect: { state: { hovers: 2 } } },
      ],
    });
    expect(report.ok, failureDetail(report)).toBe(true);
  });

  it("reaches a container's handler from a descendant for keydown, and not for mouseenter", async () => {
    const report = await runScenario(await loadSource(NESTED_APP), freshRoot(), {
      steps: [
        {
          label: "the container's own element answers both",
          do: { key: "#outer", value: "a" },
          expect: { noErrors: true, state: { keyHits: 1 } },
        },
        { do: { hover: "#outer" }, expect: { state: { hoverHits: 1 } } },
        {
          label: "from the child, the key press arrives and the hover does not",
          do: { key: "#inner", value: "b" },
          expect: { state: { keyHits: 2 } },
        },
        { do: { hover: "#inner" }, expect: { state: { hoverHits: 1 } } },
      ],
    });
    expect(report.ok, failureDetail(report)).toBe(true);
  });
});
