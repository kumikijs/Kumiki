// Emitted JS must never depend on what a Kumiki author happened to name
// something. Two hazards live here:
//
//   1. a Kumiki identifier that is a JS reserved word (`new`, `class`, …)
//      lands in a binding position and produces source that cannot be parsed;
//   2. a Kumiki identifier that looks like a runtime internal (`_live`, `_s`,
//      …) shadows it, which does NOT throw — it silently computes wrong values.
//
// Both used to pass check + build, so these tests assert on the emitted module
// actually loading and its reducers computing the right next state, not just
// on the source text.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { check, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { jsBinding } from "../src/codegen/context.ts";

const TMP_ROOT = resolve(__dirname, "test-tmp");
mkdirSync(TMP_ROOT, { recursive: true });

type ReducerShape = {
  name: string;
  apply: (
    live: Record<string, unknown>,
    payload: Record<string, unknown>,
  ) => { slots: Record<string, unknown> };
};
type GeneratedApp = { live: Record<string, unknown>; reducers: ReducerShape[] };

/** Compile, load the emitted module, and hand back a fresh app instance. */
async function build(src: string): Promise<{ js: string; app: GeneratedApp }> {
  const result = compile(src, { runtimeSpecifier: "@kumikijs/runtime", exportApp: true });
  if (result.kind !== "ok") {
    expect.fail(result.errors.map((e) => `${e.code} ${e.message}`).join("\n"));
  }
  const dir = mkdtempSync(join(TMP_ROOT, "ident-"));
  const file = join(dir, "app.mjs");
  writeFileSync(file, result.js);
  // A reserved word in a binding position makes this import throw at parse time.
  const mod: { createApp: () => GeneratedApp } = await import(
    `${pathToFileURL(file).href}?t=${Date.now()}`
  );
  return { js: result.js, app: mod.createApp() };
}

/** Run one reducer and return the slot patch it produced. */
function fire(app: GeneratedApp, name: string): Record<string, unknown> {
  const reducer = app.reducers.find((r) => r.name === name);
  if (!reducer) expect.fail(`no reducer named ${name}`);
  return reducer.apply(app.live, {}).slots;
}

const APP_TAIL = `
  tile Btn = button(text="go", onClick=go)
  tile App = column(Btn, text(count.show))
  app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

describe("jsBinding", () => {
  it("escapes JS reserved words", () => {
    for (const word of ["new", "class", "typeof", "var", "function", "await"]) {
      expect(jsBinding(word)).not.toBe(word);
    }
    // …while leaving ordinary names alone, so the emitted output stays readable.
    expect(jsBinding("count")).toBe("count");
    expect(jsBinding("format-date")).toBe("format_date");
  });

  it("keeps user names out of the runtime's underscore namespace", () => {
    for (const internal of ["_s", "_live", "_next", "_children", "_wk", "_payload", "_d_1"]) {
      expect(jsBinding(internal)).not.toBe(internal);
      // No user name may map onto `_` followed by anything the runtime emits.
      expect(/^_[^$]/.test(jsBinding(internal))).toBe(false);
    }
  });

  it("is injective, so two distinct Kumiki names never share a JS name", () => {
    const names = ["a-b", "a_b", "a-b-c", "a_b_c", "a_b-c", "a-b_c", "new", "new_", "_new"];
    expect(new Set(names.map(jsBinding)).size).toBe(names.length);
  });

  it("leaves the compiler-owned $-prefixed binds on their existing mapping", () => {
    expect(jsBinding("$1")).toBe("_d_1");
    expect(jsBinding("$event")).toBe("_d_event");
  });
});

describe("JS reserved words in binding positions", () => {
  it("compiles a `let` named after a JS reserved word", async () => {
    const { app } = await build(`
      slot count : Int = 0
      reducer go on=ui.click(Btn)
        do= let new = count + 1
            count := new
      ${APP_TAIL}
    `);
    expect(fire(app, "go").count).toBe(1);
  });

  it("compiles a fn parameter named after a JS reserved word", async () => {
    const { app } = await build(`
      slot count : Int = 0
      fn bump(class: Int) -> Int = class + 1
      reducer go on=ui.click(Btn) do= count := bump(count)
      ${APP_TAIL}
    `);
    expect(fire(app, "go").count).toBe(1);
  });

  it("compiles a `for` bind named after a JS reserved word", async () => {
    const { app } = await build(`
      slot count : Int = 0
      slot xs : List(Int) = [1, 2, 3]
      reducer go on=ui.click(Btn)
        do= for var in xs { count := count + var }
      ${APP_TAIL}
    `);
    expect(fire(app, "go").count).toBe(6);
  });
});

describe("kebab-case names in binding positions", () => {
  // genFn used to emit parameter names verbatim while the body referenced them
  // through jsName, so a hyphenated parameter produced both invalid JS and a
  // declaration/use mismatch.
  it("keeps a hyphenated fn parameter consistent between declaration and use", async () => {
    const { js, app } = await build(`
      slot count : Int = 0
      fn add-one(raw-value: Int) -> Int = raw-value + 1
      reducer go on=ui.click(Btn) do= count := add-one(count)
      ${APP_TAIL}
    `);
    expect(js).not.toContain("raw-value");
    expect(fire(app, "go").count).toBe(1);
  });
});

describe("runtime-internal names used as Kumiki identifiers", () => {
  it("does not let a loop bind shadow the live slot map", async () => {
    const { js, app } = await build(`
      slot count : Int = 42
      slot items : List(Text) = ["a", "b"]
      slot joined : Text = ""
      reducer go on=ui.click(Btn)
        do= for _live in items { joined := joined + _live + "/" + count.show }
      ${APP_TAIL}
    `);
    expect(js).not.toMatch(/for \(const _live of/);
    expect(fire(app, "go").joined).toBe("a/42b/42");
  });

  it("does not let a fn parameter shadow the stdlib handle", async () => {
    const { app } = await build(`
      slot count : Int = 1
      fn twice(_s: Int) -> Int = _s + _s
      reducer go on=ui.click(Btn) do= count := twice(count)
      ${APP_TAIL}
    `);
    expect(fire(app, "go").count).toBe(2);
  });
});

describe("runtime-managed slot names", () => {
  // `route` is maintained by the runtime (docs/spec/routing.md §3.2). Codegen
  // reads it straight from the live map, so a user slot of the same name is
  // silently discarded and renders "[object Object]".
  it("reports a diagnostic instead of silently overwriting `route`", () => {
    const errors = check(
      parse(
        lex(`
          slot route : Text = "hello"
          tile App = column(text(route))
          app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
        `),
      ),
    );
    const found = errors.find((e) => e.code === "E0115");
    expect(found?.kind).toBe("reserved-slot-name");
  });
});
