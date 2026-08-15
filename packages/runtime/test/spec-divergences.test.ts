// Runtime-side halves of the divergences between `docs/spec/` and what the
// toolchain actually did. The compiler halves live in
// `packages/compiler/test/spec-divergences.test.ts`.

import type { AppShape, TileNode } from "@kumikijs/runtime";
import { _stdlib, inputPatchers, inputTiles, renderToString } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

const btn = (over: Partial<Extract<TileNode, { kind: "button" }>> = {}) =>
  ({ kind: "button", text: "go", ...over }) as Extract<TileNode, { kind: "button" }>;

function render(node: Extract<TileNode, { kind: "button" }>): HTMLButtonElement {
  return inputTiles.button?.(node, () => null) as HTMLButtonElement;
}

// forms.md §5.2.2: `button(type="submit")` submits the form it is in. The
// renderer never read the field, so the attribute was never written and the
// browser's default decided for every button.
describe("button(type=…) reaches the DOM", () => {
  it("writes the type the node carries", () => {
    expect(render(btn({ type: "button" })).type).toBe("button");
    expect(render(btn({ type: "submit" })).type).toBe("submit");
  });

  it("leaves the HTML default alone when the node says nothing", () => {
    // `submit` is what a `<button>` with no type does inside a form. The tile
    // that did not ask for a type gets that, not a type this renderer chose.
    expect(render(btn()).hasAttribute("type")).toBe(false);
    expect(render(btn()).type).toBe("submit");
  });

  it("reconciles the type when a conditional swaps one button for another", () => {
    const el = render(btn({ type: "button" }));
    inputPatchers.button?.(el, btn({ type: "button" }), btn({ type: "submit" }));
    expect(el.type).toBe("submit");
    // …and back: the node that stops saying returns to the default rather than
    // keeping whatever the previous render happened to set.
    inputPatchers.button?.(el, btn({ type: "submit" }), btn());
    expect(el.type).toBe("submit");
    inputPatchers.button?.(el, btn(), btn({ type: "reset" }));
    expect(el.type).toBe("reset");
  });

  it("serves the same type it hydrates to", async () => {
    // The SSR renderer wrote `type="button"` on every button, so the served
    // HTML refused to submit and the hydrated page accepted — the one
    // divergence a user sees as "it works on the second click".
    const app: AppShape = {
      slots: {},
      caps: [],
      effects: {},
      init: [],
      reducers: [],
      root: (): TileNode => ({
        kind: "column",
        children: [btn({ type: "submit", text: "send" }), btn({ text: "plain" })],
      }),
    };
    const { html } = await renderToString(app, {});
    expect(html).toContain('type="submit"');
    expect(html).not.toContain('type="button"');
  });
});

// stdlib.md §2.2.8: `format(pattern) : Text`. The pattern was ignored — the
// codegen produced the ISO date whatever was asked for, so an app that wrote
// "yyyy-MM-dd HH:mm" rendered a date with no time, in UTC.
describe("Time.format honours its pattern", () => {
  // Expectations are derived from the same instant through `Date`'s own
  // getters, never written out: this suite runs in JST locally and UTC in CI,
  // and a hardcoded string would pin whichever one wrote it.
  const at = new Date(2026, 7, 14, 21, 5, 9).getTime();
  const two = (n: number) => String(n).padStart(2, "0");
  const d = new Date(at);

  it("substitutes each field the spec names", () => {
    expect(_stdlib.formatTime(at, "yyyy-MM-dd HH:mm")).toBe(
      `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`,
    );
    expect(_stdlib.formatTime(at, "ss")).toBe(two(d.getSeconds()));
  });

  it("copies through anything that is not a token", () => {
    expect(_stdlib.formatTime(at, "on dd/MM/yyyy at HH:mm:ss")).toBe(
      `on ${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} at ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`,
    );
    expect(_stdlib.formatTime(at, "")).toBe("");
  });

  it("reads the instant in local time", () => {
    // The rendered day is the reader's day. Formatting UTC fields would show
    // yesterday to everyone whose evening is the previous UTC day.
    expect(_stdlib.formatTime(at, "dd")).toBe(two(d.getDate()));
    expect(_stdlib.formatTime(at, "HH")).toBe(two(d.getHours()));
  });

  it("does not re-scan what it just substituted", () => {
    // A month of `11` next to a `mm` token, or a year whose digits form one:
    // replacing token by token would let the output of one match the next.
    const nov = new Date(2026, 10, 3, 0, 0, 0).getTime();
    expect(_stdlib.formatTime(nov, "MMmm")).toBe("1100");
  });
});
