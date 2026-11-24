import type {
  AppShape,
  EffectResult,
  EpisodeLogEntry,
  MountedApp,
  ReducerSpec,
  ReplayEvent,
  SlotMeta,
  TileNode,
} from "@kumikijs/runtime";
import { _stdlibTest, mount, replayEpisodes } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { bareApp, lifecycleReducer } from "./helpers/app.ts";
import { control, fire, freshRoot, tickBox, typeInto } from "./helpers/dom.ts";
import {
  recordDriven,
  recordingLogger,
  replayableApp,
  replayInto,
} from "./helpers/episode-apps.ts";
import { tick } from "./helpers/time.ts";

afterEach(() => {
  document.body.replaceChildren();
});

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
      drive: (root) => typeInto(control<HTMLInputElement>(root, "input"), "milk"),
    },
  ],
  [
    "textarea",
    {
      node: { kind: "textarea", bind: "v" },
      from: "",
      to: "milk",
      event: "ui.input",
      drive: (root) => typeInto(control<HTMLTextAreaElement>(root, "textarea"), "milk"),
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
      drive: (root) => typeInto(control<HTMLInputElement>(root, "input"), "7"),
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
      drive: (root) => tickBox(control<HTMLInputElement>(root, "input")),
    },
  ],
  [
    "switch",
    {
      node: { kind: "switch", checked: false, bind: "v" },
      from: false,
      to: true,
      event: "ui.change",
      drive: (root) => tickBox(control<HTMLInputElement>(root, "input")),
    },
  ],
  [
    "radio",
    {
      node: { kind: "radio", group: "g", value: "b", bind: "v" },
      from: "a",
      to: "b",
      event: "ui.change",
      drive: (root) => tickBox(control<HTMLInputElement>(root, "input")),
    },
  ],
];

describe("a write a bound control makes", () => {
  it.each(WRITERS)("is journalled from a %s as an episode that replays to it", (_, w) => {
    const app = boundTo(w.from, w.node);
    const log = recordDriven(app, ({ root }) => w.drive(root));
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
    const log = recordDriven(app, ({ root }) =>
      typeInto(control<HTMLInputElement>(root, "input"), "milk"),
    );
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
    const log = recordDriven(app, ({ root }) =>
      typeInto(control<HTMLInputElement>(root, "input"), "milk"),
    );
    expect(app.live?.v).toEqual(before);
    expect(log).toEqual([]);
  });

  it("to a volatile slot lands, and the log carries nothing of it", () => {
    const app = boundTo("", { kind: "input", bind: "v" }, { volatile: true });
    const log = recordDriven(app, ({ root }) =>
      typeInto(control<HTMLInputElement>(root, "input"), "hunter2"),
    );
    expect(app.live?.v).toBe("hunter2");
    expect(log).toEqual([]);
  });
});

describe("a journalled bind write and the episodes around it", () => {
  /** `draft`, bound to an input, and `save`, whose `slowSave` waits until `answer` is called. */
  function savingForm() {
    const pending: ((r: EffectResult) => void)[] = [];
    const app = bareApp({
      slots: { draft: { value: "" } },
      caps: ["http.post"],
      effects: {
        slowSave: {
          name: "slowSave",
          cap: "http.post",
          invoke: () => new Promise<EffectResult>((resolve) => pending.push(resolve)),
        },
      },
      reducers: [
        {
          name: "save",
          event: { kind: "ui", ev: "click" },
          apply: () => ({ slots: {}, emits: [{ effect: "slowSave", args: [null] }] }),
        },
        {
          name: "saved",
          event: { kind: "effect", effect: "slowSave", outcome: "ok" },
          apply: () => ({ slots: {}, emits: [] }),
        },
      ],
      root: () => ({ kind: "input", bind: "draft" }),
    });
    return { app, answer: () => pending.shift()?.({ kind: "ok", value: null }) };
  }

  // The hook `kumiki run --episode-log` and the dev server write the log through.
  it("reaches onEpisode, after an episode begun before it that commits later", async () => {
    const { app, answer } = savingForm();
    const { logger, handedOver } = recordingLogger();
    const root = freshRoot();
    const mounted = mount(app, root, { episodeLogger: logger });
    try {
      (app as MountedApp)._dispatch("save", {});
      typeInto(control<HTMLInputElement>(root, "input"), "milk");
      // Held back: the save is still waiting on its effect, and it began first.
      expect(handedOver).toEqual([]);
      answer();
      await tick(0);
      expect(handedOver.map((ep) => ep.steps[0]?.kind)).toEqual(["reducer", "bind"]);
      expect(handedOver[1]?.steps).toMatchObject([{ kind: "bind", slot: "draft", value: "milk" }]);
    } finally {
      mounted.dispose();
    }
  });

  it("lands and renders even when a hook it is handed to throws", () => {
    const app: AppShape = bareApp({ slots: { v: { value: "" } } });
    app.root = () => ({
      kind: "column",
      children: [
        { kind: "input", bind: "v" },
        { kind: "text", text: `shown: ${String(app.live?.v)}` },
      ],
    });
    const { logger } = recordingLogger(() => {
      throw new Error("the hook failed");
    });
    const root = freshRoot();
    const mounted = mount(app, root, { episodeLogger: logger });
    try {
      const input = control<HTMLInputElement>(root, "input");
      input.value = "milk";
      try {
        fire(input, "input");
      } catch {
        // Whether a listener's throw reaches the dispatcher is the DOM's to say, not the write's.
      }
      expect(app.live?.v).toBe("milk");
      expect(root.textContent).toContain("shown: milk");
      expect(logger.list()).toMatchObject([{ steps: [{ kind: "bind", value: "milk" }] }]);
    } finally {
      mounted.dispose();
    }
  });

  it("commits before the render it causes, so a tile.mount that render fires comes after it", () => {
    const app: AppShape = bareApp({
      slots: { v: { value: "" } },
      reducers: [lifecycleReducer('tile.mount("Hint")', (s) => ({ slots: s, emits: [] }))],
    });
    app.root = () => ({
      kind: "column",
      children: [
        { kind: "input", bind: "v" },
        ...(app.live?.v
          ? [{ kind: "box", children: [], props: { _tile: "Hint" } } as TileNode]
          : []),
      ],
    });
    const log = recordDriven(app, ({ root }) =>
      typeInto(control<HTMLInputElement>(root, "input"), "milk"),
    );
    expect(log.map((ep) => ep.steps[0]?.kind)).toEqual(["bind", "reducer"]);
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
  return { report, events, binds: events.filter((ev) => ev.kind === "bind") };
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
    const { report, events, binds } = eventsOf(app, log);
    expect(report.finalSlots).toEqual({ form: { title: "milk", body: "new" } });
    // The write changed the slot, so a signal-update follows it, as one follows a reducer.
    expect(events.filter((ev) => ev.episodeId === "ep_2").map((ev) => ev.kind)).toEqual([
      "episode-start",
      "bind",
      "signal-update",
      "episode-end",
    ]);
    expect(
      events.find((ev) => ev.kind === "signal-update" && ev.episodeId === "ep_2"),
    ).toMatchObject({ dirty: ["form"] });
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
    const { report, events, binds } = eventsOf(app, log);
    expect(report.finalSlots).toEqual({ v: "ok" });
    expect(report.panics).toEqual([]);
    expect(binds).toMatchObject([{ name: "v", value: "milk", slotDiffs: [], refused: true }]);
    expect(events.map((ev) => ev.kind)).not.toContain("signal-update");
  });

  it.each<[string, unknown, unknown[], string, string]>([
    ["an index past a List's end", [], [{ at: 2 }, "title"], "Index 2", "rows[2].title"],
    ["a key its Map lacks", {}, [{ at: "k" }, "title"], 'Key "k"', 'rows["k"].title'],
    ["the payload of a None", { _tag: "None" }, [{ get: true }, "title"], "None", "rows.get.title"],
  ])("whose path reaches %s is a panic, and writes nothing", (_, held, path, says, label) => {
    const app = replayableApp({ slots: { rows: { value: held } } });
    const log = [
      bindEpisode("ep_1", { slot: "rows", path, value: "x", before: held, after: held }),
    ];
    const { report, binds } = eventsOf(app, log);
    expect(report.panics).toMatchObject([
      {
        episodeId: "ep_1",
        message: expect.stringContaining(says),
        location: `bind "${label}"`,
        category: "bind",
      },
    ]);
    expect(binds).toEqual([]);
    expect(report.finalSlots).toEqual({ rows: held });
  });

  it("lets out a throw that is no panic, as a live write would", () => {
    const held = Object.defineProperty({}, "title", {
      enumerable: true,
      get: () => {
        throw new Error("the getter failed");
      },
    });
    const app = replayableApp({ slots: { form: { value: held } } });
    const log = [
      bindEpisode("ep_1", { slot: "form", path: ["title"], value: "x", before: {}, after: {} }),
    ];
    expect(() => eventsOf(app, log)).toThrow("the getter failed");
  });

  it("is a step `--until-step` counts", () => {
    const app = replayableApp({ slots: { v: { value: "" }, w: { value: "" } } });
    const seen: ReplayEvent[] = [];
    const report = replayEpisodes({
      app: { live: app.live, slots: app.slots, reducers: app.reducers, effects: app.effects },
      episodes: [
        bindEpisode("ep_1", { slot: "v", value: "a", before: "", after: "a" }),
        bindEpisode("ep_2", { slot: "w", value: "b", before: "", after: "b" }),
      ],
      mocks: {},
      observer: (ev) => {
        seen.push(ev);
        return "continue";
      },
      untilStep: 1,
    });
    expect(report.stoppedAt).toBe(1);
    // Step 1 is the write itself, not the signal-update after it.
    expect(seen.map((ev) => ev.kind)).toEqual(["episode-start", "bind"]);
    expect(report.finalSlots).toEqual({ v: "a", w: "" });
  });

  const MIXED: EpisodeLogEntry = {
    id: "ep_1",
    trigger: { kind: "ui.click", target: "Btn" },
    steps: [
      { kind: "reducer", name: "clear", "slot-diffs": [] },
      { kind: "bind", slot: "draft", value: "milk" },
    ],
    status: "completed",
  };

  it.each<[string, Record<string, SlotMeta>, EpisodeLogEntry, string]>([
    [
      "names a slot the program does not declare",
      { title: { value: "" } },
      bindEpisode("ep_1", { slot: "draft", value: "milk", before: "", after: "milk" }),
      'no slot named "draft"',
    ],
    [
      "names a slot the program declares by a close name",
      { drafts: { value: "" } },
      bindEpisode("ep_1", { slot: "draft", value: "milk", before: "", after: "milk" }),
      'no slot named "draft" — did you mean "drafts"?',
    ],
    [
      "names no slot",
      { draft: { value: "" } },
      {
        id: "ep_1",
        trigger: { kind: "ui.input", target: "draft" },
        steps: [{ kind: "bind", value: "milk" } as EpisodeLogEntry["steps"][number]],
        status: "completed",
      },
      "bind step 1 has no slot",
    ],
    [
      "shares its episode with a reducer step",
      { draft: { value: "" } },
      MIXED,
      "bind step 2 shares its episode with a reducer step",
    ],
  ])("that %s is not replayed, and writes nothing", (_, slots, ep, message) => {
    const clear: ReducerSpec = {
      name: "clear",
      event: { kind: "ui", ev: "click" },
      apply: () => ({ slots: { draft: "cleared" }, emits: [] }),
    };
    const app = replayableApp({ slots, reducers: [clear] });
    const { report, events } = eventsOf(app, [ep]);
    expect(report.entryReducersMissing).toEqual([{ episodeId: "ep_1", message }]);
    expect(report.replayed).toBe(0);
    expect(events.map((ev) => ev.kind)).toEqual(["episode-start", "episode-end"]);
    // No key the program lacks: the same keys a replay of nothing leaves.
    const untouched = replayableApp({ slots });
    replayInto(untouched, []);
    expect(Object.keys(app.live)).toEqual(Object.keys(untouched.live));
    expect(report.finalSlots).toEqual(Object.fromEntries(Object.keys(slots).map((k) => [k, ""])));
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

  it("fails on the episode when the program no longer declares the slot", () => {
    const app = replayableApp({ slots: { title: { value: "" } } });
    expect(
      _stdlibTest.runEpisodeTest({
        name: "ends-typing",
        app: { live: app.live, slots: app.slots, reducers: app.reducers, effects: app.effects },
        episodes: log,
        mocks: {},
        expect: { slotsEqual: "from-log", noPanics: true },
      }),
    ).toMatchObject({ pass: false, diffAt: "episodes" });
  });

  it("fails at the slot when the program now refuses it", () => {
    expect(run({ refine: (x) => String(x).length <= 3 })).toMatchObject({
      pass: false,
      diffAt: "slots.v",
      leaf: { expected: "eggs", actual: "" },
    });
  });
});
