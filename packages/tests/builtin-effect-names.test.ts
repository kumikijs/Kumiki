// The standard effects' names (stdlib.md §2.6) are one list on both sides of
// the build. The runtime registers each of them on `app.effects` at mount,
// writing over whatever codegen put under that name, so a program's own effect
// declared as `log` would never run: its emits would reach the built-in. The
// checker refuses that declaration (E0234) by the same list, `BUILTIN_EFFECTS`,
// whose keys are typed by the runtime's `BuiltinEffectName`.
//
// The checker's cases, one per name, are in
// `packages/compiler/test/reserved-effect-name.test.ts`.

import { BUILTIN_EFFECTS, compile } from "@kumikijs/compiler";
import { type AppShape, mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

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
    // `mount` from the package entry carries every installer: `log` in core,
    // the navigation four and `scroll-to` with routing, `toast` and `confirm`
    // from their modules. The app declares no effect of its own, so every name
    // on `app.effects` afterwards is one the runtime put there.
    const app: AppShape = { slots: {}, caps: [], reducers: [], effects: {}, init: [], routes: [] };
    const root = document.createElement("div");
    document.body.appendChild(root);
    const { dispose } = mount(app, root);
    try {
      expect(Object.keys(app.effects).sort()).toEqual([...BUILTIN_EFFECTS.keys()].sort());
    } finally {
      dispose();
      root.remove();
    }
  });
});
