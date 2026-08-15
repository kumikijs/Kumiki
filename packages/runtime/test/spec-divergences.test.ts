// Runtime-side halves of the divergences between `docs/spec/` and what the
// toolchain actually did. The compiler halves live in
// `packages/compiler/test/spec-divergences.test.ts`.

import type { AppShape, Episode, TileNode } from "@kumikijs/runtime";
import {
  _stdlib,
  createEpisodeLogger,
  inputPatchers,
  inputTiles,
  mount,
  renderToString,
} from "@kumikijs/runtime";
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

// runtime.md §10.4.3: `policy=queue` executes sequentially, FIFO. The
// dispatcher had no `queue` branch, so it fell through to the default and ran
// every emit in parallel — the one policy whose whole purpose is that it does
// not.
describe("policy=queue runs one at a time", () => {
  function makeQueueApp(): { app: AppShape; log: string[]; peak: () => number } {
    const log: string[] = [];
    let live = 0;
    let peak = 0;
    const app: AppShape = {
      slots: { n: { value: 0 } },
      caps: ["log.write"],
      effects: {
        work: {
          name: "work",
          cap: "log.write",
          policy: { kind: "queue" },
          invoke: async (input) => {
            live += 1;
            peak = Math.max(peak, live);
            log.push(`start ${String(input)}`);
            await new Promise((r) => setTimeout(r, 20));
            log.push(`end ${String(input)}`);
            live -= 1;
            return { kind: "ok", value: null };
          },
        },
      },
      init: [],
      reducers: [
        {
          name: "go",
          selector: { tile: "Go" },
          event: { kind: "ui", ev: "click" },
          apply: () => ({
            slots: {},
            emits: [
              { effect: "work", args: ["a"] },
              { effect: "work", args: ["b"] },
              { effect: "work", args: ["c"] },
            ],
          }),
        },
      ],
      root: (): TileNode => ({ kind: "column", children: [btn({ text: "go" })] }),
    };
    return { app, log, peak: () => peak };
  }

  it("never has two invocations in flight, and keeps the order they were emitted", async () => {
    const { app, log, peak } = makeQueueApp();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const { dispose } = mount(app, host);
    const dispatch = (app as unknown as { _dispatch: (n: string, el: object) => void })._dispatch;
    try {
      dispatch("go", {});
      // Three 20ms invocations back to back; wait for all of them plus slack.
      await new Promise((r) => setTimeout(r, 200));
      expect(peak()).toBe(1);
      expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
    } finally {
      dispose();
      host.remove();
    }
  });

  it("releases a queued launch that unmount cancelled", async () => {
    // Each queued entry claims its episode token when it is dispatched, so an
    // entry that never runs has to give it back — otherwise the episode that
    // emitted it waits for an effect-end that is never coming. The two entries
    // still waiting at unmount become `effect-cancel` steps; without the drain
    // they run after the mount is gone and land as two more `effect-end`s.
    const { app } = makeQueueApp();
    const logger = createEpisodeLogger();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const { dispose } = mount(app, host, { episodeLogger: logger });
    (app as unknown as { _dispatch: (n: string, el: object) => void })._dispatch("go", {});
    await new Promise((r) => setTimeout(r, 5));
    dispose();
    await new Promise((r) => setTimeout(r, 120));
    host.remove();
    const steps = logger.list().flatMap((e: Episode) => e.steps.map((st) => st.kind));
    expect(steps.filter((k) => k === "effect-cancel")).toHaveLength(2);
    expect(steps.filter((k) => k === "effect-end")).toHaveLength(1);
  });
});
