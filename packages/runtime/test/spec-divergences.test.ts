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
    expect(el.getAttribute("type")).toBe("submit");
    // …and back: a node that stops saying loses the attribute, which is what
    // `create` produces for the same node. Asserted on the attribute because
    // `el.type` reads "submit" whether it is absent or explicit — the property
    // cannot tell the two apart, and the two render differently on the server.
    inputPatchers.button?.(el, btn({ type: "submit" }), btn());
    expect(el.hasAttribute("type")).toBe(false);
    inputPatchers.button?.(el, btn(), btn({ type: "reset" }));
    expect(el.getAttribute("type")).toBe("reset");
    // An empty string is "did not say", like the create path treats it.
    inputPatchers.button?.(el, btn({ type: "reset" }), btn({ type: "" }));
    expect(el.hasAttribute("type")).toBe(false);
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
    // The typeless button carries no type AT ALL — `?? "submit"` here would
    // keep the assertion above green while reintroducing the divergence in the
    // other direction, since the client renderer leaves the attribute off.
    const tags = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    expect(tags).toHaveLength(2);
    expect(tags.filter((t) => t.includes("type="))).toHaveLength(1);
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

  it("reads an instant that arrived as text", () => {
    // The compiler only ever produces a number here, but a `Time` field filled
    // from a JSON payload — or from storage written by a build whose
    // `Time.parse` kept the string — holds text. The old formatter handled
    // those (it went through `new Date`), and dropping that would turn a date
    // into `NaN-NaN-NaN` on exactly the paths no example covers.
    const iso = "2026-08-14T21:05:09";
    const asDate = new Date(iso);
    expect(_stdlib.formatTime(iso, "yyyy-MM-dd HH:mm")).toBe(
      `${asDate.getFullYear()}-${two(asDate.getMonth() + 1)}-${two(asDate.getDate())} ${two(asDate.getHours())}:${two(asDate.getMinutes())}`,
    );
    // A numeric string is the millisecond number it spells.
    expect(_stdlib.formatTime(String(at), "yyyy")).toBe(_stdlib.formatTime(at, "yyyy"));
  });

  it("reads a date-only string on the same clock it renders", () => {
    // `Date.parse("2026-08-14")` is UTC midnight, and the fields come back
    // local — so west of Greenwich the day a `type="date"` input produced came
    // back as the day before. The two halves have to agree on which clock a
    // zone-less string is on.
    const parsed = _stdlib.parseTime("2026-08-14");
    expect(parsed._tag).toBe("Some");
    expect((parsed as { _0: number })._0).toBe(new Date(2026, 7, 14).getTime());
    expect(_stdlib.formatTime((parsed as { _0: number })._0, "yyyy-MM-dd")).toBe("2026-08-14");
  });

  it("still reads a full datetime the way the platform does", () => {
    const iso = "2026-08-14T21:05:09";
    expect((_stdlib.parseTime(iso) as { _0: number })._0).toBe(new Date(iso).getTime());
  });

  it("is None for text that names no instant", () => {
    for (const bad of ["", "   ", "nonsense"]) {
      expect(_stdlib.parseTime(bad)._tag, bad).toBe("None");
    }
  });

  it("does not render a blank as the epoch", () => {
    // `Number(null)` and `Number("")` are both 0, so a numeric-first read shows
    // 1970-01-01 for a field that is simply absent — a date that looks real.
    for (const blank of [null, undefined, "", "   "]) {
      expect(_stdlib.formatTime(blank, "yyyy-MM-dd"), String(blank)).toContain("NaN");
    }
    // …and a real 0 is still the epoch, because that is what it means.
    expect(_stdlib.formatTime(0, "yyyy")).toBe(String(new Date(0).getFullYear()));
  });

  it("keeps MM and mm apart", () => {
    // The pattern language is case-sensitive, and the two tokens differ only
    // by case: a lookup that lowercased would render the month as the minute.
    const nov = new Date(2026, 10, 3, 0, 45, 0).getTime();
    expect(_stdlib.formatTime(nov, "MM mm")).toBe("11 45");
  });

  // Whether the fields are local or UTC is only observable where the two
  // differ, so this says nothing at offset 0. The suite pins `TZ` (see
  // `vitest.config.ts`) precisely so it does not skip itself — the guard stays
  // for anyone running this file in a different zone.
  it.skipIf(new Date().getTimezoneOffset() === 0)("renders the local day, not the UTC one", () => {
    // An evening instant: west of Greenwich — where this suite is pinned — the
    // same moment is already the next day in UTC.
    const evening = new Date(2026, 7, 14, 21, 0, 0);
    const local = evening.getTime();
    expect(_stdlib.formatTime(local, "dd HH")).toBe(
      `${two(evening.getDate())} ${two(evening.getHours())}`,
    );
    expect(_stdlib.formatTime(local, "dd HH")).not.toBe(
      `${two(evening.getUTCDate())} ${two(evening.getUTCHours())}`,
    );
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
      caps: ["log.write", "http.cancel"],
      effects: {
        // The dispatcher never invokes a `http.cancel` effect — it reads the
        // id out of the emit and releases what is holding it.
        cancel: {
          name: "cancel",
          cap: "http.cancel",
          invoke: async () => ({ kind: "ok", value: null }),
        },
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
        {
          name: "kill",
          selector: { tile: "Kill" },
          event: { kind: "ui", ev: "click" },
          // Every `work` emit here shares the key `_`, so this id is the queue.
          apply: () => ({ slots: {}, emits: [{ effect: "cancel", args: ["work:_"] }] }),
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

  it("releases a queued launch that http.cancel cancelled", async () => {
    // `dispose()` is not the only path that ends a pending launch. Cancelling
    // by id aborts what is in flight and drops a pending debounce timer; a
    // queued entry is the same debt — without this it runs after the user
    // pressed Cancel, on an episode the log already recorded a cancel for.
    const { app, log } = makeQueueApp();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const { dispose } = mount(app, host);
    const dispatch = (app as unknown as { _dispatch: (n: string, el: object) => void })._dispatch;
    try {
      dispatch("go", {});
      await new Promise((r) => setTimeout(r, 5));
      dispatch("kill", {});
      await new Promise((r) => setTimeout(r, 120));
      // `a` was already running when the cancel landed; `b` and `c` never do.
      expect(log.filter((l) => l.startsWith("start"))).toEqual(["start a"]);
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
