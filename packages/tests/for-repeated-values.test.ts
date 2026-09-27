// A `for` keys each tile it renders (runtime.md §10.3.10), and the keyed
// reconciler refuses two siblings with one key. The implicit key used to be
// `show(x)` alone, so a list holding one value twice — `[7, 3, 7]` — or two
// loops under one parent sharing a value keyed two siblings alike. The first
// paint worked; every later render, whatever caused it, panicked in reconcile
// and rebuilt the whole tree, replacing every element on the page, the
// `<input>` beside the list included.
//
// Each case mounts the real compiled program and re-renders it through the
// same DOM events a user causes.

import type { AppShape } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSource } from "./helpers/load.ts";

const program = (lists: string, body: string) => `
${lists}
slot n     : Int  = 0
slot draft : Text = ""
reducer tick on=ui.click(Tick) do= n := n + 1
tile Tick = button(text="tick")
tile App = column(Tick, input(bind=draft), text("n=" + n.show), ${body})
app A
  caps   = []
  routes = {"/" -> App, "/404" -> App}
  init   = []`;

let disposers: Array<() => void> = [];
afterEach(() => {
  for (const d of disposers) d();
  disposers = [];
  vi.restoreAllMocks();
});

async function mounted(src: string): Promise<{ root: HTMLElement; app: AppShape }> {
  const app = await loadSource(src);
  const root = document.createElement("div");
  document.body.appendChild(root);
  const handle = mount(app, root);
  disposers.push(() => {
    handle.dispose();
    root.remove();
  });
  return { root, app };
}

/** Every `console.error` line the runtime writes from here on. */
function errors(): string[] {
  const seen: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    seen.push(args.map(String).join(" "));
  });
  return seen;
}

function click(root: HTMLElement, text: string): void {
  const btn = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);
  if (!btn) throw new Error(`button "${text}" not found`);
  btn.click();
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const SCORES = `slot scores : List(Int) = [7, 3, 7]`;
const LOOP = `column(for s in scores text("score " + s.show))`;

describe("a for over a list that repeats a value", () => {
  it("re-renders without a reconcile panic", async () => {
    const { root } = await mounted(program(SCORES, LOOP));
    const seen = errors();
    click(root, "tick");
    expect(seen).toEqual([]);
    expect(root.textContent).toContain("n=1");
    expect(root.textContent?.match(/score 7/g)?.length).toBe(2);
  });

  it("keeps the input beside the list across keystrokes", async () => {
    const { root, app } = await mounted(program(SCORES, LOOP));
    const seen = errors();
    const input = root.querySelector("input") as HTMLInputElement;
    typeInto(input, "a");
    typeInto(input, "ab");
    expect(app.live?.draft).toBe("ab");
    expect(root.querySelector("input")).toBe(input);
    expect(input.isConnected).toBe(true);
    expect(seen).toEqual([]);
  });

  it("keeps each list item's element across an unrelated re-render", async () => {
    const { root } = await mounted(program(SCORES, LOOP));
    const before = Array.from(root.querySelectorAll("*")).filter((e) =>
      e.textContent?.startsWith("score "),
    );
    click(root, "tick");
    for (const el of before) expect(el.isConnected).toBe(true);
  });
});

describe("two for loops under one parent that share a value", () => {
  it("re-render without a reconcile panic", async () => {
    const lists = `slot evens : List(Int) = [2, 4]\nslot primes : List(Int) = [2, 3]`;
    const body = `column(for e in evens text("even " + e.show), for p in primes text("prime " + p.show))`;
    const { root } = await mounted(program(lists, body));
    const seen = errors();
    click(root, "tick");
    expect(seen).toEqual([]);
    expect(root.textContent).toContain("even 2");
    expect(root.textContent).toContain("prime 2");
  });
});

// What the keys are for (§10.3.10): a reorder moves the elements it already
// has. Pinned for distinct values, which the old key served, and for a
// repeated one.
describe("a keyed reorder", () => {
  it.each([
    ["distinct values", "[1, 2, 3]"],
    ["a repeated value", "[7, 3, 7]"],
  ])("reuses every element for %s", async (_what, init) => {
    const lists = `slot xs : List(Int) = ${init}\nreducer flip on=ui.click(Flip) do= xs := xs.reverse\ntile Flip = button(text="flip")`;
    const { root } = await mounted(
      program(lists, `Flip, column(for x in xs text("item " + x.show))`),
    );
    const seen = errors();
    const items = () =>
      Array.from(root.querySelectorAll("*")).filter(
        (e) => e.childElementCount === 0 && e.textContent?.startsWith("item "),
      );
    const before = items();
    click(root, "flip");
    const after = items();
    expect(seen).toEqual([]);
    expect(after.map((e) => e.textContent)).toEqual(before.map((e) => e.textContent).reverse());
    expect(new Set(after)).toEqual(new Set(before));
  });
});
