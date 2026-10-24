import { BUILTIN_EFFECTS, compile } from "@kumikijs/compiler";
import type { AppShape } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { mountApp } from "./helpers/dom.ts";

describe("an effect declared under a standard effect's name", () => {
  it("stops the build", () => {
    const r = compile(
      `slot lastId : EffectId = EffectId.none
effect log cap=http.get in=Text out=Result(Text, HttpError)
           policy=latest-per-key($1)
           map-request={url: "/api/" + $1, decode: Decoder.Text}
reducer go on=ui.click(B) do= lastId := emit log("x")
tile B = button(text="b", onClick=go)
tile Home = column(B, text(lastId.show))
app M caps=[http.get] routes={"/" -> Home, "/404" -> Home} init=[]
`,
      { runtimeSpecifier: "./runtime.js" },
    );
    expect(r.kind === "ok" ? [] : r.errors.map((e) => e.code)).toEqual(["E0234"]);
  });
});

describe("the names the checker reserves", () => {
  it("are exactly the effects the runtime registers at mount", () => {
    // The app declares no effect of its own, so every name on `app.effects` after mounting
    // is one the runtime put there.
    const app: AppShape = { slots: {}, caps: [], reducers: [], effects: {}, init: [], routes: [] };
    const { root, handle } = mountApp(app);
    try {
      expect(Object.keys(app.effects).sort()).toEqual([...BUILTIN_EFFECTS.keys()].sort());
    } finally {
      handle.dispose();
      root.remove();
    }
  });
});
