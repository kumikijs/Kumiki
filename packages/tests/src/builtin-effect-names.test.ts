import { BUILTIN_EFFECTS } from "@kumikijs/compiler";
import type { AppShape } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { withMounted } from "./helpers/dom.ts";

describe("the names the checker reserves", () => {
  it("are exactly the effects the runtime registers at mount", async () => {
    // The app declares no effect of its own, so every name on `app.effects` after mounting
    // is one the runtime put there.
    const app: AppShape = { slots: {}, caps: [], reducers: [], effects: {}, init: [], routes: [] };
    const registered = await withMounted(app, async () => Object.keys(app.effects).sort());
    expect(registered).toEqual([...BUILTIN_EFFECTS.keys()].sort());
  });
});
