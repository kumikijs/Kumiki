import type { AppShape, EpisodeLogEntry, ReplayEvent, SlotMeta, TileNode } from "@kumikijs/runtime";
import { _stdlibTest, replayEpisodes } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { defined } from "./helpers/defined.ts";
import { mountLogged, replayableApp, replayInto } from "./helpers/episode-apps.ts";

afterEach(() => {
  document.body.replaceChildren();
});

function fire(el: Element, type: string): void {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

function control<E extends Element>(root: HTMLElement, selector: string): E {
  return defined(root.querySelector<E>(selector), `a control matching ${selector}`);
}

/** Give the text control `selector` matches `text`, as typing does, and fire its `input`. */
function typeInto(root: HTMLElement, selector: string, text: string): void {
  const el = control<HTMLInputElement>(root, selector);
  el.value = text;
  fire(el, "input");
}

/** Tick the box or radio `selector` matches and fire its `change`. */
function tick(root: HTMLElement, selector: string): void {
  const el = control<HTMLInputElement>(root, selector);
  el.checked = true;
  fire(el, "change");
}

/** Mount `app` with a logger, let `drive` work its controls, and return the log as JSON reads it back. */
function record(app: AppShape, drive: (root: HTMLElement) => void): EpisodeLogEntry[] {
  const { logger, root, dispose } = mountLogged(app);
  try {
    drive(root);
  } finally {
    dispose();
  }
  return JSON.parse(JSON.stringify(logger.list())) as EpisodeLogEntry[];
}

/** `slot v` holding `from`, and `node`, bound to it, as the whole page. */
function boundTo(from: unknown, node: TileNode, meta: Omit<SlotMeta, "value"> = {}): AppShape {
  return bareApp({ slots: { v: { value: from, ...meta } }, root: () => node });
}

type Writer = {
  node: TileNode;
  from: unknown;
  to: unknown;
  event: "ui.input" | "ui.change";
  drive: (root: HTMLElement) => void;
};

const WRITERS: [string, Writer][] = [
  [
    "input",
    {
      node: { kind: "input", bind: "v" },
      from: "",
      to: "milk",
      event: "ui.input",
      drive: (root) => typeInto(root, "input", "milk"),
    },
  ],
  [
    "textarea",
    {
      node: { kind: "textarea", bind: "v" },
      from: "",
      to: "milk",
      event: "ui.input",
      drive: (root) => typeInto(root, "textarea", "milk"),
    },
  ],
  [
    "editable",
    {
      node: { kind: "editable", text: "", bind: "v" },
      from: "",
      to: "milk",
      event: "ui.input",
      drive: (root) => {
        const el = control<HTMLElement>(root, "[contenteditable]");
        el.textContent = "milk";
        fire(el, "input");
      },
    },
  ],
  [
    "slider",
    {
      node: { kind: "slider", min: 0, max: 10, bind: "v" },
      from: 0,
      to: 7,
      event: "ui.input",
      drive: (root) => typeInto(root, "input", "7"),
    },
  ],
  [
    "select",
    {
      node: {
        kind: "select",
        value: "a",
        options: [
          { label: "A", value: "a" },
          { label: "B", value: "b" },
        ],
        bind: "v",
      },
      from: "a",
      to: "b",
      event: "ui.change",
      drive: (root) => {
        const sel = control<HTMLSelectElement>(root, "select");
        sel.selectedIndex = 1;
        fire(sel, "change");
      },
    },
  ],
  [
    "check",
    {
      node: { kind: "check", checked: false, bind: "v" },
      from: false,
      to: true,
      event: "ui.change",
      drive: (root) => tick(root, "input"),
    },
  ],
  [
    "switch",
    {
      node: { kind: "switch", checked: false, bind: "v" },
      from: false,
      to: true,
      event: "ui.change",
      drive: (root) => tick(root, "input"),
    },
  ],
  [
    "radio",
    {
      node: { kind: "radio", group: "g", value: "b", bind: "v" },
      from: "a",
      to: "b",
      event: "ui.change",
      drive: (root) => tick(root, "input"),
    },
  ],
];

describe("a write a bound control makes", () => {
  it.each(WRITERS)("is journalled from a %s as an episode that replays to it", (_, w) => {
    const app = boundTo(w.from, w.node);
    const log = record(app, w.drive);
    expect(app.live?.v).toEqual(w.to);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      trigger: { kind: w.event, target: "v" },
      steps: [
        {
          kind: "bind",
          slot: "v",
          value: w.to,
          "slot-diffs": [{ name: "v", before: w.from, after: w.to }],
        },
      ],
      status: "completed",
    });
    expect(log[0]?.steps).toHaveLength(1);
    const replayed = replayableApp({ slots: { v: { value: w.from } } });
    expect(replayInto(replayed, log).finalSlots).toEqual({ v: w.to });
  });

  it("through a path records the path, the value written there, and the whole slot", () => {
    const form = { title: "", body: "kept" };
    const app = bareApp({
      slots: { form: { value: form } },
      root: () => ({ kind: "input", bind: "form", bindPath: ["title"] }),
    });
    const log = record(app, (root) => typeInto(root, "input", "milk"));
    expect(log).toMatchObject([
      {
        trigger: { kind: "ui.input", target: "form.title" },
        steps: [
          {
            kind: "bind",
            slot: "form",
            path: ["title"],
            value: "milk",
            "slot-diffs": [{ name: "form", before: form, after: { title: "milk", body: "kept" } }],
          },
        ],
      },
    ]);
  });

  const INT: NonNullable<Extract<TileNode, { kind: "input" }>["parse"]> = {
    as: "Int",
    read: (text) => (/^\d+$/.test(text) ? { _tag: "Some", _0: Number(text) } : { _tag: "None" }),
  };

  it.each([
    [
      "its refinement refuses",
      boundTo("ok", { kind: "input", bind: "v" }, { refine: (x) => String(x).length <= 3 }),
    ],
    ["its field cannot read", boundTo(0, { kind: "input", bind: "v", parse: INT })],
  ])("that %s is not journalled", (_, app) => {
    const before = app.slots.v?.value;
    const log = record(app, (root) => typeInto(root, "input", "milk"));
    expect(app.live?.v).toEqual(before);
    expect(log).toEqual([]);
  });

  it("to a volatile slot lands, and the log carries nothing of it", () => {
    const app = boundTo("", { kind: "input", bind: "v" }, { volatile: true });
    const log = record(app, (root) => typeInto(root, "input", "hunter2"));
    expect(app.live?.v).toBe("hunter2");
    expect(log).toEqual([]);
  });
});

/** An episode holding one `bind` step, as the live runtime writes it. */
function bindEpisode(
  id: string,
  step: { slot: string; path?: unknown[]; value: unknown; before: unknown; after: unknown },
): EpisodeLogEntry {
  const { slot, path, value, before, after } = step;
  return {
    id,
    trigger: { kind: "ui.input", target: slot },
    steps: [
      {
        kind: "bind",
        slot,
        ...(path ? { path } : {}),
        value,
        "slot-diffs": [{ name: slot, before, after }],
      } as EpisodeLogEntry["steps"][number],
    ],
    status: "completed",
  };
}

function eventsOf(app: ReturnType<typeof replayableApp>, log: EpisodeLogEntry[]) {
  const events: ReplayEvent[] = [];
  const report = replayInto(app, log, (ev) => {
    events.push(ev);
    return "continue";
  });
  return { report, binds: events.filter((ev) => ev.kind === "bind") };
}

describe("replaying a journalled bind write", () => {
  it("writes the value at its path, over what the replayed reducers left in the slot", () => {
    const app = replayableApp({
      slots: { form: { value: { title: "", body: "" } } },
      reducers: [
        {
          name: "setBody",
          event: { kind: "ui", ev: "click" },
          apply: (s) => ({
            slots: { form: { ...(s.form as Record<string, unknown>), body: "new" } },
            emits: [],
          }),
        },
      ],
    });
    // Recorded against a program whose `setBody` wrote "old".
    const log: EpisodeLogEntry[] = [
      {
        id: "ep_1",
        trigger: { kind: "ui.click", target: "BodyBtn" },
        steps: [
          {
            kind: "reducer",
            name: "setBody",
            "slot-diffs": [
              { name: "form", before: { title: "", body: "" }, after: { title: "", body: "old" } },
            ],
          },
        ],
        status: "completed",
      },
      bindEpisode("ep_2", {
        slot: "form",
        path: ["title"],
        value: "milk",
        before: { title: "", body: "old" },
        after: { title: "milk", body: "old" },
      }),
    ];
    const { report, binds } = eventsOf(app, log);
    expect(report.finalSlots).toEqual({ form: { title: "milk", body: "new" } });
    expect(binds).toMatchObject([
      {
        name: "form.title",
        value: "milk",
        slotDiffs: [
          {
            name: "form",
            before: { title: "", body: "new" },
            after: { title: "milk", body: "new" },
          },
        ],
      },
    ]);
  });

  it("that the program now refuses leaves the slot, and says so", () => {
    const app = replayableApp({
      slots: { v: { value: "ok", refine: (x) => String(x).length <= 3 } },
    });
    const log = [bindEpisode("ep_1", { slot: "v", value: "milk", before: "ok", after: "milk" })];
    const { report, binds } = eventsOf(app, log);
    expect(report.finalSlots).toEqual({ v: "ok" });
    expect(report.panics).toEqual([]);
    expect(binds).toMatchObject([{ name: "v", value: "milk", slotDiffs: [], refused: true }]);
  });

  it("whose path the replayed slot no longer has is a panic, not a throw", () => {
    const app = replayableApp({ slots: { rows: { value: [] } } });
    const log = [
      bindEpisode("ep_1", {
        slot: "rows",
        path: [{ at: 2 }, "title"],
        value: "x",
        before: [],
        after: [],
      }),
    ];
    const { report } = eventsOf(app, log);
    expect(report.panics).toMatchObject([
      {
        episodeId: "ep_1",
        message: expect.stringContaining("Index 2"),
        location: 'bind "rows[2].title"',
      },
    ]);
    expect(report.finalSlots).toEqual({ rows: [] });
  });

  it("is a step `--until-step` counts", () => {
    const app = replayableApp({ slots: { v: { value: "" }, w: { value: "" } } });
    const report = replayEpisodes({
      app: { live: app.live, slots: app.slots, reducers: app.reducers, effects: app.effects },
      episodes: [
        bindEpisode("ep_1", { slot: "v", value: "a", before: "", after: "a" }),
        bindEpisode("ep_2", { slot: "w", value: "b", before: "", after: "b" }),
      ],
      mocks: {},
      observer: () => "continue",
      untilStep: 1,
    });
    expect(report.stoppedAt).toBe(1);
    expect(report.finalSlots).toEqual({ v: "a", w: "" });
  });
});

describe("an episode-test's `slots-equal: from-log` over a log that ends with a bind write", () => {
  const log = [bindEpisode("ep_1", { slot: "v", value: "eggs", before: "", after: "eggs" })];
  const run = (meta: Omit<SlotMeta, "value">) => {
    const app = replayableApp({ slots: { v: { value: "", ...meta } } });
    return _stdlibTest.runEpisodeTest({
      name: "ends-typing",
      app: { live: app.live, slots: app.slots, reducers: app.reducers, effects: app.effects },
      episodes: log,
      mocks: {},
      expect: { slotsEqual: "from-log", noPanics: true },
    });
  };

  it("holds when the program takes the write", () => {
    expect(run({})).toEqual({ name: "ends-typing", pass: true });
  });

  it("fails at the slot when the program now refuses it", () => {
    expect(run({ refine: (x) => String(x).length <= 3 })).toMatchObject({
      pass: false,
      diffAt: "slots.v",
      leaf: { expected: "eggs", actual: "" },
    });
  });
});
