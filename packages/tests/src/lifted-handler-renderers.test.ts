import { BUILTIN_TILES, UI_LIFTS, type UiLift } from "@kumikijs/compiler";
import { type AppShape, mount, type TileNode } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { freshRoot } from "./helpers/dom.ts";

// The compiler's rows say which renderers call a handler, and W0212, W0213 and the codegen gate
// all read them; only mounting the renderers can show that the rows still say what they do.

function rowOf(ev: string): UiLift & { readonly tiles: ReadonlySet<string> } {
  const lift = UI_LIFTS.find((l) => l.ev === ev);
  if (lift?.tiles == null) throw new Error(`no row lifts ui.${ev} to a set of tiles`);
  return { ...lift, tiles: lift.tiles };
}

/** A user's click, which also toggles a checkbox or a radio and fires its `change`. */
const click = (el: HTMLElement) => el.click();
const input = (el: HTMLElement) => el.dispatchEvent(new Event("input", { bubbles: true }));

/** How many times `kind`'s renderer calls `handler` when `fire` reaches every element it renders. */
function callsOn(kind: string, handler: string, fire: (el: HTMLElement) => void): number {
  let calls = 0;
  const node = {
    kind,
    text: "x",
    children: [{ kind: "text", text: "child" }],
    props: { [handler]: () => calls++ },
  } as TileNode;
  const app: AppShape = {
    slots: {},
    caps: [],
    effects: {},
    init: [],
    reducers: [],
    root: () => node,
  };
  const root = freshRoot();
  const { dispose } = mount(app, root);
  try {
    const rendered = [...root.querySelectorAll<HTMLElement>("*")];
    expect(rendered.length, `what a ${kind} renders`).toBeGreaterThan(0);
    for (const el of rendered) fire(el);
    return calls;
  } finally {
    dispose();
    root.remove();
  }
}

describe("the click row", () => {
  const { tiles, handler } = rowOf("click");
  const leftOut = [...BUILTIN_TILES].filter((k) => !tiles.has(k)).sort();

  it.each(leftOut)("leaves out a %s, whose renderer never calls onClick", (kind) => {
    expect(callsOn(kind, handler, click)).toBe(0);
  });

  it.each([...tiles].sort())("lifts to a %s, whose renderer calls onClick", (kind) => {
    expect(callsOn(kind, handler, click)).toBeGreaterThan(0);
  });
});

describe("the input row", () => {
  const { tiles, handler, firesUnheard } = rowOf("input");

  it.each(
    Object.keys(firesUnheard ?? {}).sort(),
  )("records a %s, whose renderer never calls onInput", (kind) => {
    expect(callsOn(kind, handler, input)).toBe(0);
  });

  it.each([...tiles].sort())("lifts to a %s, whose renderer calls onInput", (kind) => {
    expect(callsOn(kind, handler, input)).toBeGreaterThan(0);
  });
});
