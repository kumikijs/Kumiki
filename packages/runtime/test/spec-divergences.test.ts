import type { AppShape, CapabilityRegistry, Episode, TileCtx, TileNode } from "@kumikijs/runtime";
import {
  _stdlib,
  createEpisodeLogger,
  inputPatchers,
  inputTiles,
  installToast,
  mount,
  renderToString,
  statusTiles,
} from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "./helpers/defined.ts";

const btn = (over: Partial<Extract<TileNode, { kind: "button" }>> = {}) =>
  ({ kind: "button", text: "go", ...over }) as Extract<TileNode, { kind: "button" }>;

// The recursion seam every renderer and patcher is handed. None of the tiles
// here has children, so reaching it means the tile started recursing.
const ctx: TileCtx = {
  render: () => {
    throw new Error("this tile has no children to render");
  },
};

function render(node: Extract<TileNode, { kind: "button" }>): HTMLButtonElement {
  const el = defined(inputTiles.button, "the button renderer")(node, ctx);
  if (!(el instanceof HTMLButtonElement)) throw new Error(`expected a <button>, got ${el.tagName}`);
  return el;
}

describe("button(type=…) reaches the DOM", () => {
  it("writes the type the node carries", () => {
    expect(render(btn({ type: "button" })).type).toBe("button");
    expect(render(btn({ type: "submit" })).type).toBe("submit");
  });

  it("leaves the HTML default alone when the node says nothing", () => {
    expect(render(btn()).hasAttribute("type")).toBe(false);
    expect(render(btn()).type).toBe("submit");
  });

  it("reconciles the type when a conditional swaps one button for another", () => {
    const el = render(btn({ type: "button" }));
    inputPatchers.button?.(el, btn({ type: "button" }), btn({ type: "submit" }), ctx);
    expect(el.getAttribute("type")).toBe("submit");
    inputPatchers.button?.(el, btn({ type: "submit" }), btn(), ctx);
    expect(el.hasAttribute("type")).toBe(false);
    inputPatchers.button?.(el, btn(), btn({ type: "reset" }), ctx);
    expect(el.getAttribute("type")).toBe("reset");
    // An empty string is "did not say", like the create path treats it.
    inputPatchers.button?.(el, btn({ type: "reset" }), btn({ type: "" }), ctx);
    expect(el.hasAttribute("type")).toBe(false);
  });

  it("serves the same type it hydrates to", async () => {
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
    const tags = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    expect(tags).toHaveLength(2);
    expect(tags.filter((t) => t.includes("type="))).toHaveLength(1);
  });
});

describe("Time.format honours its pattern", () => {
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
    expect(_stdlib.formatTime(at, "dd")).toBe(two(d.getDate()));
    expect(_stdlib.formatTime(at, "HH")).toBe(two(d.getHours()));
  });

  it("reads an instant that arrived as text", () => {
    const iso = "2026-08-14T21:05:09";
    const asDate = new Date(iso);
    expect(_stdlib.formatTime(iso, "yyyy-MM-dd HH:mm")).toBe(
      `${asDate.getFullYear()}-${two(asDate.getMonth() + 1)}-${two(asDate.getDate())} ${two(asDate.getHours())}:${two(asDate.getMinutes())}`,
    );
    expect(_stdlib.formatTime(` ${iso}\n`, "yyyy-MM-dd HH:mm")).toBe(
      _stdlib.formatTime(iso, "yyyy-MM-dd HH:mm"),
    );
    expect(_stdlib.formatTime(String(at), "yyyy")).toBe(_stdlib.formatTime(at, "yyyy"));
  });

  it("reads a date-only string on the same clock it renders", () => {
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

  it("is None for a date outside the calendar, which the platform rolls over", () => {
    // `new Date(2026, 1, 30)` is March 2nd and `Date.parse` does the same to a
    // datetime, so each of these used to be `Some` of a different day.
    for (const bad of [
      "2026-02-30",
      "2026-13-01",
      "2026-00-10",
      "2026-04-31",
      "2027-02-29",
      "2026-02-30T10:00",
      "2026-02-30 10:00",
      "2026-02-30Z",
      "2026-02-30t10:00",
      "+002026-02-30",
      "2026-2-30",
      "2026/02/30",
    ]) {
      expect(_stdlib.parseTime(bad)._tag, bad).toBe("None");
    }
  });

  it("still reads the last day of each month, and Feb 29th of a leap year", () => {
    for (const [text, y, m, d] of [
      ["2026-02-28", 2026, 1, 28],
      ["2028-02-29", 2028, 1, 29],
      ["2000-02-29", 2000, 1, 29],
      ["2026-12-31", 2026, 11, 31],
    ] as const) {
      expect(_stdlib.parseTime(text), text).toEqual({
        _tag: "Some",
        _0: new Date(y, m, d).getTime(),
      });
    }
  });

  it("reads a year below 100 as itself, not as 19xx", () => {
    // `new Date(50, 0, 1)` is 1950; the calendar check reads the year as
    // written, so the instant has to be that year too.
    for (const [text, year] of [
      ["0050-01-01", 50],
      ["0050-01-01T10:00", 50],
      ["0050-01-01 10:00", 50],
      ["0004-02-29 10:00", 4],
    ] as const) {
      const parsed = _stdlib.parseTime(text) as { _0: number };
      expect(new Date(parsed._0).getFullYear(), text).toBe(year);
    }
  });

  it("still reads a datetime on a boundary date", () => {
    for (const [text, y, m, d] of [
      ["2028-02-29T10:00", 2028, 1, 29],
      ["2026-02-28 10:00", 2026, 1, 28],
      ["2000-02-29T10:00", 2000, 1, 29],
      ["2026-12-31 10:00", 2026, 11, 31],
    ] as const) {
      expect(_stdlib.parseTime(text), text).toEqual({
        _tag: "Some",
        _0: new Date(y, m, d, 10).getTime(),
      });
    }
  });

  it("reads the ISO 8601 time part: seconds, a fraction, and a zone", () => {
    for (const [text, expected] of [
      ["2026-08-14T21:05", new Date(2026, 7, 14, 21, 5).getTime()],
      ["2026-08-14t21:05:09", new Date(2026, 7, 14, 21, 5, 9).getTime()],
      ["2026-08-14 21:05:09.5", new Date(2026, 7, 14, 21, 5, 9, 500).getTime()],
      ["2026-08-14T21:05:09.123456", new Date(2026, 7, 14, 21, 5, 9, 123).getTime()],
      ["2026-08-14Z", Date.UTC(2026, 7, 14)],
      ["2026-08-14T21:05Z", Date.UTC(2026, 7, 14, 21, 5)],
      ["2026-08-14T21:05:09.250z", Date.UTC(2026, 7, 14, 21, 5, 9, 250)],
      ["2026-08-14T21:05+09:00", Date.UTC(2026, 7, 14, 12, 5)],
      ["2026-08-14T21:05:09-07:30", Date.UTC(2026, 7, 15, 4, 35, 9)],
      // `Date.UTC(50, …)` would be 1950; the year is the one written.
      ["0050-01-01T10:00Z", new Date(Date.UTC(2000, 0, 1, 10)).setUTCFullYear(50)],
    ] as const) {
      expect(_stdlib.parseTime(text), text).toEqual({ _tag: "Some", _0: expected });
    }
  });

  it("is None for text that is not ISO 8601 YYYY-MM-DD with an optional time", () => {
    for (const bad of [
      "Aug 14 2026",
      "14 August 2026 10:00",
      "2026-08-14T",
      "2026-08-14T21",
      "2026-08-14T2:05",
      "2026-08-14T24:00",
      "2026-08-14T21:60",
      "2026-08-14T21:05:60",
      "2026-08-14T21:05:09.",
      "2026-08-14T21:05+0900",
      "2026-08-14T21:05+24:00",
      "2026-08-14T21:05 Z",
      "2026-08-14  21:05",
      "2026-08-14T21:05:09Z ",
      "+002026-08-14",
      "-000001-01-01",
      "12026-08-14",
      "2026-08",
      "2026",
    ]) {
      expect(_stdlib.parseTime(bad)._tag, bad).toBe("None");
    }
  });

  it("is None for surrounding blanks, as the other readings are", () => {
    for (const bad of [" 2026-02-28", "2026-02-28 ", "\t2026-02-28", " 2026-02-28T10:00"]) {
      expect(_stdlib.parseTime(bad)._tag, JSON.stringify(bad)).toBe("None");
    }
  });

  it("does not render a blank as the epoch", () => {
    for (const blank of [null, undefined, "", "   "]) {
      expect(_stdlib.formatTime(blank, "yyyy-MM-dd"), String(blank)).toContain("NaN");
    }
    expect(_stdlib.formatTime(0, "yyyy")).toBe(String(new Date(0).getFullYear()));
  });

  it("keeps MM and mm apart", () => {
    const nov = new Date(2026, 10, 3, 0, 45, 0).getTime();
    expect(_stdlib.formatTime(nov, "MM mm")).toBe("11 45");
  });

  it.skipIf(new Date().getTimezoneOffset() === 0)("renders the local day, not the UTC one", () => {
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

describe("policy=queue runs one at a time", () => {
  function makeQueueApp(): { app: AppShape; log: string[]; peak: () => number } {
    const log: string[] = [];
    let live = 0;
    let peak = 0;
    const app: AppShape = {
      slots: { n: { value: 0 } },
      caps: ["log.write", "http.cancel"],
      effects: {
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

describe("toast honours the record the spec documents", () => {
  const fire = async (input: unknown): Promise<void> => {
    // `overridableInvoke` asks the registry for a provider first; a host that
    // registered none still has to answer.
    const caps: CapabilityRegistry = { has: () => false, provider: () => undefined };
    const app: AppShape = { slots: {}, caps: [], reducers: [], effects: {}, init: [] };
    installToast(app, { navigate: () => {}, back: () => {} });
    await defined(app.effects.toast, "the installed toast effect").invoke(input, caps);
  };
  const banner = (): HTMLElement | null =>
    document.querySelector<HTMLElement>("[data-kumiki-toast]");

  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks the kind on the element rather than choosing an appearance", async () => {
    await fire({ kind: "success", text: "Saved" });
    expect(banner()?.dataset.level).toBe("success");
    expect(banner()?.textContent).toBe("Saved");
  });

  it("uses the per-kind default when the emitter says nothing", async () => {
    await fire({ kind: "warn", text: "Careful" });
    vi.advanceTimersByTime(3_001);
    expect(banner()).not.toBeNull();
    vi.advanceTimersByTime(2_000);
    expect(banner()).toBeNull();
  });

  it("leaves an error toast up until it is dismissed", async () => {
    await fire({ kind: "error", text: "Failed" });
    vi.advanceTimersByTime(600_000);
    expect(banner()).not.toBeNull();
  });

  it("takes zero as the emitter asking for no timer", async () => {
    await fire({ kind: "info", text: "Sticky", duration: { _tag: "Some", _0: 0 } });
    vi.advanceTimersByTime(600_000);
    expect(banner()).not.toBeNull();
  });

  it("treats a negative duration as no duration at all", async () => {
    await fire({ kind: "info", text: "Odd", duration: { _tag: "Some", _0: -1 } });
    vi.advanceTimersByTime(3_001);
    expect(banner()).toBeNull();
  });

  it("stays for the duration the emitter asked for", async () => {
    await fire({ kind: "info", text: "Slow", duration: { _tag: "Some", _0: 10_000 } });
    vi.advanceTimersByTime(3_000);
    expect(banner()).not.toBeNull();
    vi.advanceTimersByTime(7_001);
    expect(banner()).toBeNull();
  });

  it("falls back to the kind's default when the emitter says None", async () => {
    await fire({ kind: "info", text: "Quick", duration: { _tag: "None" } });
    vi.advanceTimersByTime(2_999);
    expect(banner()).not.toBeNull();
    vi.advanceTimersByTime(2);
    expect(banner()).toBeNull();
  });

  it("is announced: a toast is a live region", async () => {
    await fire({ kind: "error", text: "Failed" });
    expect(banner()?.getAttribute("role")).toBe("status");
    expect(banner()?.getAttribute("aria-live")).toBe("polite");
  });
});

describe("route.hash is the Option the type says it is", () => {
  const routeOf = (path: string): Record<string, unknown> => {
    const app: AppShape = {
      slots: { route: { value: null } },
      caps: [],
      reducers: [],
      effects: {},
      init: [],
      routes: [{ pattern: "/", tile: () => ({ kind: "page", children: [] }) }],
    };
    const target = document.createElement("div");
    const handle = mount(app, target, { router: "memory", initialPath: path });
    const route = app.live?.route as Record<string, unknown>;
    handle.dispose();
    return route;
  };

  it("carries Some(fragment) when the location has one", () => {
    expect(routeOf("/#section").hash).toEqual({ _tag: "Some", _0: "section" });
  });

  it("carries None when it does not", () => {
    expect(routeOf("/").hash).toEqual({ _tag: "None" });
  });
});

describe("the announced regions §7.8 promises", () => {
  const toastNode = (): Extract<TileNode, { kind: "toast" }> => ({ kind: "toast", text: "hi" });
  const errorNode = (): Extract<TileNode, { kind: "error" }> => ({
    kind: "error",
    field: "email",
  });

  it("announces the toast tile politely", () => {
    const el = defined(statusTiles.toast, "the toast renderer")(toastNode(), ctx);
    expect(el.getAttribute("role")).toBe("status");
    expect(el.getAttribute("aria-live")).toBe("polite");
  });

  it("announces the error tile assertively — it is why the user stopped", () => {
    const el = defined(statusTiles.error, "the error renderer")(errorNode(), ctx);
    expect(el.getAttribute("role")).toBe("alert");
    expect(el.getAttribute("aria-live")).toBe("assertive");
  });

  it("serves the same attributes rather than adding them on hydration", async () => {
    const { html } = await renderToString(
      {
        slots: {},
        caps: [],
        reducers: [],
        effects: {},
        init: [],
        routes: [{ pattern: "/", tile: () => ({ kind: "page", children: [toastNode()] }) }],
      } as unknown as AppShape,
      { route: "/" },
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });
});
