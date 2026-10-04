// An `EffectId` is an opaque handle (stdlib.md §2.1.1.1), and rendering one is
// E0204 (errors.md). `compile()` refuses a page that does, so no build puts the
// runtime's representation of a handle on the screen. What a page shows
// instead — a Bool or a Text derived from comparing the handle with
// `EffectId.none` — is `features/209-effect-id-opaque`. The checker's cases,
// one per way a handle reaches text, are in
// `packages/compiler/test/effect-id-render.test.ts`.

import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const page = (shown: string) => `slot h : EffectId = EffectId.none
reducer go on=ui.click(Go) do= h := emit toast({kind: "info", text: "x", duration: None})
tile Go = button(text="go") {id: "go"}
tile P = column(Go, ${shown})
app M caps=[notification.show] routes={"/" -> P, "/404" -> P} init=[]
`;

const refusals = (shown: string) => {
  const r = compile(page(shown), { runtimeSpecifier: "./runtime.js" });
  return r.kind === "ok"
    ? []
    : r.errors.map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);
};

describe("a page that renders an EffectId does not build", () => {
  it("refuses text(h), heading(h) and h.show with the messages errors.md quotes", () => {
    expect(refusals("text(h), heading(h), text(h.show)")).toEqual([
      "E0204 4:26 text(...) cannot render EffectId — it is an opaque handle",
      "E0204 4:38 heading(...) cannot render EffectId — it is an opaque handle",
      "E0204 4:47 .show cannot render EffectId — it is an opaque handle",
    ]);
  });

  it("builds what the page derives from the handle instead", () => {
    // The other side of the rule: a comparison with the sentinel is defined on
    // a handle, and what it answers is an ordinary Bool to show.
    expect(
      refusals(
        'text(if h == EffectId.none then "idle" else "sent"), text((h != EffectId.none).show)',
      ),
    ).toEqual([]);
  });
});
