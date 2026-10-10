import { describe, expect, it } from "vitest";
import { checkSource } from "./helpers/diagnostics.ts";

describe("http.cancel + EffectId", () => {
  const CANCEL_PREAMBLE = `
    slot id : EffectId = EffectId.none
    effect search cap=http.get
                  in=Text
                  out=Result(Text, HttpError)
                  policy=latest
    effect cancel cap=http.cancel in=EffectId out=Unit
  `;

  it("accepts EffectId slot init = EffectId.none and let id = emit search(...)", () => {
    const src = `
      ${CANCEL_PREAMBLE}
      reducer go on=ui.click(Btn) do= let h = emit search("q")
                                     id := h
      reducer cancelIt on=ui.click(Cancel) do= emit cancel(id)
                                              id := EffectId.none
      tile Btn = button(text="go", onClick=go)
      tile Cancel = button(text="cancel", onClick=cancelIt)
      tile App = column(Btn, Cancel)
      app A caps=[http.get, http.cancel] routes={"/" -> App, "/404" -> App} init=[]
    `;
    expect(checkSource(src)).toEqual([]);
  });

  it("rejects cap=http.cancel with in≠EffectId or out≠Unit (E0303)", () => {
    const src = `
      slot s : Text = ""
      effect cancel cap=http.cancel in=Text out=Unit
      tile App = text(s)
      app A caps=[http.cancel] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0303" && e.kind === "invalid-cancel-target")).toBe(true);
  });

  it("rejects emit cancel(non-EffectId) with E0202 emit-arg-type-mismatch", () => {
    const src = `
      slot s : Text = "abc"
      effect cancel cap=http.cancel in=EffectId out=Unit
      reducer go on=ui.click(B) do= emit cancel(s)
      tile B = button(text="x", onClick=go)
      tile App = column(B, text(s))
      app A caps=[http.cancel] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0202" && e.kind === "emit-arg-type-mismatch")).toBe(
      true,
    );
  });

  it("rejects arithmetic on EffectId (E0204 effect-id-misuse)", () => {
    const src = `
      slot id : EffectId = EffectId.none
      slot tag : Text = ""
      reducer go on=ui.click(B) do= tag := id + "x"
      tile B = button(text="go", onClick=go)
      tile App = column(B)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0204" && e.kind === "effect-id-misuse")).toBe(true);
  });

  it("accepts == / != comparison on EffectId", () => {
    const src = `
      slot id : EffectId = EffectId.none
      slot active : Bool = false
      reducer go on=ui.click(B) do= active := (id != EffectId.none)
      tile B = button(text="go", onClick=go)
      tile App = column(B)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    expect(checkSource(src)).toEqual([]);
  });

  it("rejects cap=http.cancel with a policy (E0303)", () => {
    const src = `
      effect cancel cap=http.cancel
                    in=EffectId out=Unit
                    policy=debounce(200ms)
      tile App = text("x")
      app A caps=[http.cancel] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(
      errors.some(
        (e) =>
          e.code === "E0303" &&
          e.kind === "invalid-cancel-target" &&
          /cannot declare a policy/.test(e.message),
      ),
    ).toBe(true);
  });

  it("rejects cap=http.cancel with retry (E0303)", () => {
    const src = `
      effect cancel cap=http.cancel
                    in=EffectId out=Unit
                    retry=linear(3, 100ms)
      tile App = text("x")
      app A caps=[http.cancel] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(
      errors.some(
        (e) =>
          e.code === "E0303" &&
          e.kind === "invalid-cancel-target" &&
          /cannot declare retry/.test(e.message),
      ),
    ).toBe(true);
  });

  it("rejects cap=http.cancel with map-request (E0303)", () => {
    const src = `
      effect cancel cap=http.cancel
                    in=EffectId out=Unit
                    map-request={url: "/cancel"}
      tile App = text("x")
      app A caps=[http.cancel] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(
      errors.some(
        (e) =>
          e.code === "E0303" &&
          e.kind === "invalid-cancel-target" &&
          /cannot declare map-request/.test(e.message),
      ),
    ).toBe(true);
  });

  it("rejects emit X(...) used as an expression outside a reducer (E0305)", () => {
    const src = `
      effect search cap=http.get in=Text out=Result(Text, HttpError)
      fn f() -> EffectId = emit search("q")
      tile App = text("x")
      app A caps=[http.get] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0305")).toBe(true);
  });
});
