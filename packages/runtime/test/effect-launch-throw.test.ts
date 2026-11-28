import type {
  AppShape,
  EffectResult,
  EffectSpec,
  EmitSpec,
  Episode,
  EpisodeLogger,
  EpisodeLoggerOptions,
  MountedApp,
  ReducerSpec,
} from "@kumikijs/runtime";
import { createEpisodeLogger, mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { captureConsole } from "./helpers/console.ts";
import { freshRoot } from "./helpers/dom.ts";
import { unhandledRejections } from "./helpers/rejections.ts";
import { tick } from "./helpers/time.ts";

const SINK_DOWN = "episode sink offline";

/** Where the host's episode logger throws. */
type ThrowSite =
  /** Recording a request's `effect-start`. */
  | "effect-start"
  /** Recording a request's `effect-end`, before its reducers run. */
  | "effect-end"
  /** The call `recordEffectEnd` hands back, which closes the result's scope after its reducers. */
  | "result-scope";

/**
 * A logger that throws at `site` for the requests numbered in `failing` (1 is the first one to
 * reach `site`), and the ids of the episodes `beginTrigger` opened, oldest first.
 */
function throwingLogger(
  site: ThrowSite,
  failing: readonly number[],
): { logger: EpisodeLogger; opened: string[] } {
  const base = createEpisodeLogger();
  const opened: string[] = [];
  let reached = 0;
  const fails = (): boolean => failing.includes(++reached);
  const logger: EpisodeLogger = {
    ...base,
    beginTrigger(t) {
      const id = base.beginTrigger(t);
      opened.push(id);
      return id;
    },
    recordEffectStart(name, args) {
      if (site === "effect-start" && fails()) throw new Error(SINK_DOWN);
      return base.recordEffectStart(name, args);
    },
    recordEffectEnd(token, name, result, value) {
      if (site === "effect-end" && fails()) throw new Error(SINK_DOWN);
      if (site !== "result-scope") return base.recordEffectEnd(token, name, result, value);
      const throws = fails();
      const exit = base.recordEffectEnd(token, name, result, value);
      return () => {
        exit();
        if (throws) throw new Error(SINK_DOWN);
      };
    },
  };
  return { logger, opened };
}

/** A hook of the built-in logger that a host hands each episode once it commits. */
type CommitHook = "onCommit" | "onEpisode";

/**
 * The built-in logger, whose `hook` throws once, as it is handed the first episode a click began,
 * and the ids of the episodes it opened, oldest first. The commit rethrows what the hook threw.
 */
function hookThrowingOnce(hook: CommitHook): { logger: EpisodeLogger; opened: string[] } {
  let thrown = false;
  const handed = (ep: Episode): void => {
    if (thrown || ep.trigger.kind !== "ui.click") return;
    thrown = true;
    throw new Error(SINK_DOWN);
  };
  const opts: EpisodeLoggerOptions = { [hook]: handed };
  const base = createEpisodeLogger(opts);
  const opened: string[] = [];
  const logger: EpisodeLogger = {
    ...base,
    beginTrigger(t) {
      const id = base.beginTrigger(t);
      opened.push(id);
      return id;
    },
  };
  return { logger, opened };
}

type Seen = { ok: unknown[]; appErrors: Record<string, unknown>[] };

/**
 * `send` emits `load` once for each of `inputs`, under `policy`, and `loaded` notes what each
 * `.ok` hands it. `app.error` notes every `PanicInfo`, and with `resend` emits `inputs` again.
 * `load` needs `storage.read`, which the app declares unless `caps` leaves it out.
 */
function sendApp(
  policy: EffectSpec["policy"],
  inputs: readonly string[],
  { caps = ["storage.read"], resend = false }: { caps?: readonly string[]; resend?: boolean } = {},
): { app: AppShape; seen: Seen } {
  const seen: Seen = { ok: [], appErrors: [] };
  const loads = (): EmitSpec[] => inputs.map((i) => ({ effect: "load", args: [i] }));
  const app = bareApp({
    caps: [...caps],
    effects: {
      load: {
        name: "load",
        cap: "storage.read",
        ...(policy ? { policy } : {}),
        invoke: async (input): Promise<EffectResult> => ({ kind: "ok", value: input }),
      },
    },
    reducers: [
      {
        name: "send",
        event: { kind: "ui", ev: "click" },
        apply: () => ({ slots: {}, emits: loads() }),
      },
      {
        name: "loaded",
        event: { kind: "effect", effect: "load", outcome: "ok" },
        apply: (_live, payload) => {
          seen.ok.push(payload.$1);
          return { slots: {}, emits: [] };
        },
      },
      {
        name: "onError",
        event: { kind: "lifecycle", name: "app.error" },
        apply: (_live, payload) => {
          seen.appErrors.push(payload.$event as Record<string, unknown>);
          return { slots: {}, emits: resend ? loads() : [] };
        },
      },
    ],
    root: () => ({ kind: "text", text: "" }),
  });
  return { app, seen };
}

/** Mount `app` under `logger`, torn down when the test finishes. */
function mounted(app: AppShape, logger: EpisodeLogger): void {
  const root = freshRoot();
  const handle = mount(app, root, { episodeLogger: logger });
  onTestFinished(() => {
    handle.dispose();
    root.remove();
  });
}

/** Mount `app` under `logger`, and click `send` `clicks` times. */
function sent(app: AppShape, logger: EpisodeLogger, clicks = 1): void {
  mounted(app, logger);
  for (let i = 0; i < clicks; i++) (app as MountedApp)._dispatch("send", {});
}

/** A reducer a click dispatches, which emits `emits`. */
const onClick = (name: string, emits: EmitSpec[]): ReducerSpec => ({
  name,
  event: { kind: "ui", ev: "click" },
  apply: () => ({ slots: {}, emits }),
});

/**
 * `sendFirst` and `sendSecond` emit `load` under `policy`, with `r1` and `r2` as input and id, and
 * `cancelFirst` and `cancelSecond` cancel them. What `.ok` and `app.error` hand over is noted as
 * in `sendApp`.
 */
function releaseApp(policy: EffectSpec["policy"]): { app: AppShape; seen: Seen } {
  const seen: Seen = { ok: [], appErrors: [] };
  const load = (id: string): EmitSpec => ({ effect: "load", args: [id], id });
  const app = bareApp({
    caps: ["storage.read", "http.cancel"],
    effects: {
      load: {
        name: "load",
        cap: "storage.read",
        ...(policy ? { policy } : {}),
        invoke: async (input): Promise<EffectResult> => ({ kind: "ok", value: input }),
      },
      stop: {
        name: "stop",
        cap: "http.cancel",
        invoke: async () => ({ kind: "ok", value: null }),
      },
    },
    reducers: [
      onClick("sendFirst", [load("r1")]),
      onClick("sendSecond", [load("r2")]),
      onClick("cancelFirst", [{ effect: "stop", args: ["r1"] }]),
      onClick("cancelSecond", [{ effect: "stop", args: ["r2"] }]),
      {
        name: "loaded",
        event: { kind: "effect", effect: "load", outcome: "ok" },
        apply: (_live, payload) => {
          seen.ok.push(payload.$1);
          return { slots: {}, emits: [] };
        },
      },
      {
        name: "onError",
        event: { kind: "lifecycle", name: "app.error" },
        apply: (_live, payload) => {
          seen.appErrors.push(payload.$event as Record<string, unknown>);
          return { slots: {}, emits: [] };
        },
      },
    ],
    root: () => ({ kind: "text", text: "" }),
  });
  return { app, seen };
}

// Long enough for every request, deferred ones included, to have settled.
const settled = (): Promise<void> => tick(40);

const POLICIES: [string, EffectSpec["policy"]][] = [
  ["the default policy", undefined],
  ["once", { kind: "once" }],
  ["throttle", { kind: "throttle", ms: 1 }],
  ["latest", { kind: "latest" }],
  ["latest-per-key", { kind: "latest-per-key", keyOf: (input) => String(input) }],
  ["debounce", { kind: "debounce", ms: 1 }],
  ["queue", { kind: "queue" }],
];

/** Each policy at each of `sites`. */
const atSites = (sites: readonly ThrowSite[]): [string, ThrowSite, EffectSpec["policy"]][] =>
  POLICIES.flatMap(([name, policy]) =>
    sites.map((site): [string, ThrowSite, EffectSpec["policy"]] => [name, site, policy]),
  );

const some = (id: string | undefined) => ({ _tag: "Some", _0: id });
const NONE = { _tag: "None" };

/** The `[kumiki]` lines among what reached `console.error`. */
const reports = (errors: readonly string[]): string[] =>
  errors.filter((line) => line.startsWith("[kumiki]"));

/** Every `panic` step among the episodes `logger` has committed. */
const panicSteps = (logger: EpisodeLogger) =>
  logger.list().flatMap((ep) => ep.steps.filter((step) => step.kind === "panic"));

describe("a throw past an effect's launch, outside the reducers its result runs", () => {
  let errors: string[];
  beforeEach(() => {
    errors = captureConsole("error");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(
    atSites(["effect-start", "effect-end", "result-scope"]),
  )("under %s, from the logger at %s, is reported once as an error of the app", async (_, site, policy) => {
    const rejections = unhandledRejections();
    const { app, seen } = sendApp(policy, ["a"]);
    sent(app, throwingLogger(site, [1]).logger);
    await settled();
    expect(seen.appErrors).toEqual([
      expect.objectContaining({
        message: SINK_DOWN,
        location: 'effect "load"',
        category: "effect",
      }),
    ]);
    expect(reports(errors)).toEqual([
      expect.stringContaining(`[kumiki] error in effect "load": ${SINK_DOWN}`),
    ]);
    expect(rejections).toEqual([]);
  });

  it.each(
    POLICIES,
  )("under %s, from the logger at effect-start, never runs the request's invoke", async (_, policy) => {
    const { app, seen } = sendApp(policy, ["a"]);
    const invoke = vi.spyOn(app.effects.load as EffectSpec, "invoke");
    sent(app, throwingLogger("effect-start", [1]).logger);
    await settled();
    expect(invoke).not.toHaveBeenCalled();
    expect(seen.ok).toEqual([]);
  });

  it.each(
    POLICIES,
  )("under %s, from the logger at effect-start, leaves the input to a later click's emit", async (_, policy) => {
    const { app, seen } = sendApp(policy, ["a"]);
    sent(app, throwingLogger("effect-start", [1]).logger);
    await settled();
    (app as MountedApp)._dispatch("send", {});
    await settled();
    expect(seen.ok).toEqual(["a"]);
  });

  it.each(
    POLICIES,
  )("under %s, from the logger at effect-end, runs no .ok reducer for the request", async (_, policy) => {
    const { app, seen } = sendApp(policy, ["a"]);
    sent(app, throwingLogger("effect-end", [1]).logger);
    await settled();
    expect(seen.ok).toEqual([]);
  });

  it.each(
    atSites(["effect-start", "effect-end"]),
  )("under %s, from the logger at %s, names the episode that claimed the request", async (_, site, policy) => {
    const { app, seen } = sendApp(policy, ["a"]);
    const { logger, opened } = throwingLogger(site, [1]);
    sent(app, logger);
    await settled();
    expect(seen.appErrors).toEqual([expect.objectContaining({ "episode-id": some(opened[0]) })]);
  });

  it.each(
    POLICIES,
  )("under %s, from the logger at effect-start, records the panic step on the click's episode", async (_, policy) => {
    const { app } = sendApp(policy, ["a"]);
    const { logger, opened } = throwingLogger("effect-start", [1]);
    sent(app, logger);
    await settled();
    const click = logger.list().find((ep) => ep.id === opened[0]);
    expect(click?.steps.filter((step) => step.kind === "panic")).toEqual([
      expect.objectContaining({
        message: SINK_DOWN,
        location: 'effect "load"',
        category: "effect",
      }),
    ]);
  });

  // Closing the scope commits the episode, so by the time the throw is caught the episode it
  // would name has been handed over.
  it.each(
    POLICIES,
  )("under %s, from the logger at result-scope, names no episode and records no panic step", async (_, policy) => {
    const { app, seen } = sendApp(policy, ["a"]);
    const { logger } = throwingLogger("result-scope", [1]);
    sent(app, logger);
    await settled();
    expect(seen.appErrors).toEqual([expect.objectContaining({ "episode-id": NONE })]);
    expect(panicSteps(logger)).toEqual([]);
  });

  it.each([
    "effect-end",
    "result-scope",
  ] as const)("under queue, from the logger at %s, is reported for an entry another follows", async (site) => {
    const rejections = unhandledRejections();
    const { app, seen } = sendApp({ kind: "queue" }, ["a", "b", "c"]);
    sent(app, throwingLogger(site, [1, 2]).logger);
    await settled();
    expect(seen.appErrors.map((e) => e.location)).toEqual(['effect "load"', 'effect "load"']);
    expect(reports(errors)).toHaveLength(2);
    expect(rejections).toEqual([]);
  });

  it("under queue, from the logger at effect-start, still queues the entries after it", async () => {
    const rejections = unhandledRejections();
    const { app, seen } = sendApp({ kind: "queue" }, ["a", "b", "c"]);
    sent(app, throwingLogger("effect-start", [1]).logger);
    await settled();
    expect(seen.ok).toEqual(["b", "c"]);
    expect(reports(errors)).toHaveLength(1);
    expect(rejections).toEqual([]);
  });

  // `send`'s second emit replaces the first one's window, and then throws as it is recorded.
  // `resend` emits under the id that threw, and `cancel` names the request it replaced.
  it("under debounce, from the logger at effect-start, leaves nothing a cancel of the replaced request reaches", async () => {
    const ok: unknown[] = [];
    const load = (input: string, id: string) => ({ effect: "load", args: [input], id });
    const app = bareApp({
      caps: ["storage.read", "http.cancel"],
      effects: {
        load: {
          name: "load",
          cap: "storage.read",
          policy: { kind: "debounce", ms: 1 },
          invoke: async (input): Promise<EffectResult> => ({ kind: "ok", value: input }),
        },
        stop: {
          name: "stop",
          cap: "http.cancel",
          invoke: async () => ({ kind: "ok", value: null }),
        },
      },
      reducers: [
        onClick("send", [load("a", "first"), load("b", "second")]),
        onClick("resend", [load("c", "second")]),
        onClick("cancel", [{ effect: "stop", args: ["first"] }]),
        {
          name: "loaded",
          event: { kind: "effect", effect: "load", outcome: "ok" },
          apply: (_live, payload) => {
            ok.push(payload.$1);
            return { slots: {}, emits: [] };
          },
        },
      ],
      root: () => ({ kind: "text", text: "" }),
    });
    sent(app, throwingLogger("effect-start", [2]).logger);
    (app as MountedApp)._dispatch("resend", {});
    (app as MountedApp)._dispatch("cancel", {});
    await settled();
    expect(ok).toEqual(["c"]);
  });

  it("under queue, still runs the entries behind the one that threw", async () => {
    const { app, seen } = sendApp({ kind: "queue" }, ["a", "b", "c"]);
    sent(app, throwingLogger("result-scope", [1]).logger);
    await settled();
    expect(seen.ok).toEqual(["a", "b", "c"]);
  });
});

// A step of `ONCE_CASES`: a reducer to dispatch, or a wait for every request to settle.
const WAIT = Symbol("wait");

describe("under once, what spends an input", () => {
  beforeEach(() => {
    captureConsole("error");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Each case: where the logger throws and for which requests, the steps, and the inputs whose
  // invoke runs.
  const ONCE_CASES: [string, ThrowSite, number[], (string | typeof WAIT)[], string[]][] = [
    [
      "a request that threw at effect-start does not, so the input's next emit launches",
      "effect-start",
      [1],
      ["sendFirst", WAIT, "sendFirst", WAIT, "sendFirst", "sendSecond"],
      ["r1", "r2"],
    ],
    [
      "a request that threw at effect-start does not, even when the next emit is in the same turn",
      "effect-start",
      [1],
      ["sendFirst", "sendFirst"],
      ["r1"],
    ],
    [
      "a request that threw at effect-start spends no other input",
      "effect-start",
      [2],
      ["sendFirst", WAIT, "sendSecond", WAIT, "sendSecond", "sendFirst"],
      ["r1", "r2"],
    ],
    [
      "a request that threw at effect-end does, since it ran",
      "effect-end",
      [1],
      ["sendFirst", WAIT, "sendFirst"],
      ["r1"],
    ],
    ["a request that ran does", "effect-start", [], ["sendFirst", WAIT, "sendFirst"], ["r1"]],
    ["a request in flight does", "effect-start", [], ["sendFirst", "sendFirst"], ["r1"]],
    [
      "a request a cancel reached does",
      "effect-start",
      [],
      ["sendFirst", "cancelFirst", WAIT, "sendFirst"],
      ["r1"],
    ],
  ];

  it.each(ONCE_CASES)("%s", async (_, site, failing, steps, ran) => {
    const { app } = releaseApp({ kind: "once" });
    const invoke = vi.spyOn(app.effects.load as EffectSpec, "invoke");
    mounted(app, throwingLogger(site, failing).logger);
    for (const step of steps) {
      if (step === WAIT) await settled();
      else (app as MountedApp)._dispatch(step, {});
    }
    await settled();
    expect(invoke.mock.calls.map(([input]) => input)).toEqual(ran);
  });

  it("a request the capability check refused does", async () => {
    const { app, seen } = sendApp({ kind: "once" }, ["a"], { caps: [] });
    sent(app, throwingLogger("effect-start", []).logger);
    await settled();
    (app as MountedApp)._dispatch("send", {});
    await settled();
    expect(seen.appErrors).toEqual([expect.objectContaining({ category: "capability" })]);
  });

  // The input is given back before the throw is reported, so an `app.error` reducer that emits it
  // again launches it.
  it("an app.error reducer's emit of the input that threw at effect-start launches it", async () => {
    const { app, seen } = sendApp({ kind: "once" }, ["a"], { resend: true });
    sent(app, throwingLogger("effect-start", [1]).logger);
    await settled();
    expect(seen.appErrors).toHaveLength(1);
    expect(seen.ok).toEqual(["a"]);
  });
});

describe("a throw from the built-in logger's hook, as a request's episode commits", () => {
  let errors: string[];
  beforeEach(() => {
    errors = captureConsole("error");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const cases = (["onCommit", "onEpisode"] as const).flatMap((hook) =>
    (
      [
        ["the default policy", undefined],
        ["queue", { kind: "queue" }],
      ] as [string, EffectSpec["policy"]][]
    ).map(([name, policy]): [CommitHook, string, EffectSpec["policy"]] => [hook, name, policy]),
  );

  it.each(
    cases,
  )("from %s, under %s, is reported once with no episode, and the next click's request still runs", async (hook, _, policy) => {
    const rejections = unhandledRejections();
    const { logger } = hookThrowingOnce(hook);
    const { app, seen } = sendApp(policy, ["a"]);
    sent(app, logger, 2);
    await settled();
    expect(seen.appErrors).toEqual([
      expect.objectContaining({
        message: SINK_DOWN,
        location: 'effect "load"',
        category: "effect",
        "episode-id": NONE,
      }),
    ]);
    expect(seen.ok).toEqual(["a", "a"]);
    expect(reports(errors)).toEqual([
      expect.stringContaining(`[kumiki] error in effect "load": ${SINK_DOWN}`),
    ]);
    expect(panicSteps(logger)).toEqual([]);
    expect(rejections).toEqual([]);
  });

  // The capability check refuses each queue entry as it starts, and the cancel that releases the
  // entry's `effect-start` commits its click's episode.
  it("from onEpisode, as a refused queue entry's episode commits, is reported beside the refusals", async () => {
    const rejections = unhandledRejections();
    const { app, seen } = sendApp({ kind: "queue" }, ["a"], { caps: [] });
    const { logger, opened } = hookThrowingOnce("onEpisode");
    sent(app, logger, 3);
    await settled();
    expect(seen.appErrors).toEqual([
      expect.objectContaining({ category: "capability", "episode-id": some(opened[0]) }),
      expect.objectContaining({ category: "effect", message: SINK_DOWN, "episode-id": NONE }),
      expect.objectContaining({ category: "capability", "episode-id": some(opened[1]) }),
      expect.objectContaining({ category: "capability", "episode-id": some(opened[2]) }),
    ]);
    expect(reports(errors)).toHaveLength(4);
    expect(rejections).toEqual([]);
  });
});

describe("a throw from the built-in logger's hook, as a dispatch releases a request a policy deferred", () => {
  let errors: string[];
  beforeEach(() => {
    errors = captureConsole("error");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const DEBOUNCE: EffectSpec["policy"] = { kind: "debounce", ms: 1 };
  const QUEUE: EffectSpec["policy"] = { kind: "queue" };
  const REPLACE = ["sendFirst", "sendSecond"];
  const CANCEL_TIMER = ["sendFirst", "cancelFirst"];
  const CANCEL_ENTRY = ["sendFirst", "sendSecond", "cancelSecond"];

  // Each case: the hook, the site, the reducers dispatched in order, the inputs whose `.ok` runs,
  // and the step whose episode the report names. The release commits the episode that claimed the
  // request, so the report goes on the episode of the dispatch that released it. Under `onEpisode`
  // the queued entry's episode is handed over only after the one before it, which waits on the
  // entry ahead, so the hook throws as that entry's result scope closes, with no episode to name.
  const RELEASES: [CommitHook, string, EffectSpec["policy"], string[], string[], number?][] = [
    ["onCommit", "a debounce replaces a pending timer", DEBOUNCE, REPLACE, ["r2"], 1],
    ["onEpisode", "a debounce replaces a pending timer", DEBOUNCE, REPLACE, ["r2"], 1],
    ["onCommit", "an http.cancel clears a pending debounce timer", DEBOUNCE, CANCEL_TIMER, [], 1],
    ["onEpisode", "an http.cancel clears a pending debounce timer", DEBOUNCE, CANCEL_TIMER, [], 1],
    ["onCommit", "an http.cancel removes a queued entry", QUEUE, CANCEL_ENTRY, ["r1"], 2],
    ["onEpisode", "an http.cancel removes a queued entry", QUEUE, CANCEL_ENTRY, ["r1"]],
  ];

  it.each(
    RELEASES,
  )("from %s, as %s, escapes no dispatch and is reported once", async (hook, _, policy, steps, ok, reportedOn) => {
    const rejections = unhandledRejections();
    const { app, seen } = releaseApp(policy);
    const { logger, opened } = hookThrowingOnce(hook);
    mounted(app, logger);
    const escaped: unknown[] = [];
    for (const step of steps) {
      try {
        (app as MountedApp)._dispatch(step, {});
      } catch (e) {
        escaped.push(e);
      }
    }
    await settled();
    const named = reportedOn === undefined ? undefined : opened[reportedOn];
    expect(escaped).toEqual([]);
    expect(seen.ok).toEqual(ok);
    expect(seen.appErrors).toEqual([
      expect.objectContaining({
        message: SINK_DOWN,
        location: 'effect "load"',
        category: "effect",
        "episode-id": named === undefined ? NONE : some(named),
      }),
    ]);
    expect(reports(errors)).toEqual([
      expect.stringContaining(`[kumiki] error in effect "load": ${SINK_DOWN}`),
    ]);
    const withPanic = logger.list().filter((ep) => ep.steps.some((s) => s.kind === "panic"));
    expect(withPanic.map((ep) => ep.id)).toEqual(named === undefined ? [] : [named]);
    expect(rejections).toEqual([]);
  });
});

/** How the logger throws, once, as it records a request's `effect-end`. */
type EndThrow =
  /** A host's logger, before it hands the step to the built-in one. */
  | "from a host's logger before the built-in records it"
  /** The built-in logger itself, whose clock throws as it stamps the step. */
  | "from the built-in logger's clock"
  /** A host's logger, once the built-in has recorded it, so the scope it handed back is lost. */
  | "from a host's logger after the built-in records it";

/**
 * The built-in logger with an `onEpisode` hook that notes each episode it is handed and then
 * runs `hook`, thrown at once as a request's `effect-end` is recorded, as `how` says. Also the
 * ids of the episodes it opened, oldest first.
 */
function endThrowingOnce(
  how: EndThrow,
  hook: (ep: Episode) => void = () => {},
): { logger: EpisodeLogger; opened: string[]; handed: string[] } {
  let thrown = false;
  const throwOnce = (): void => {
    if (thrown) return;
    thrown = true;
    throw new Error(SINK_DOWN);
  };
  let stamping = false;
  const handed: string[] = [];
  const base = createEpisodeLogger({
    now: () => {
      if (stamping) throwOnce();
      return Date.now();
    },
    onEpisode: (ep) => {
      handed.push(ep.id);
      hook(ep);
    },
  });
  const opened: string[] = [];
  const logger: EpisodeLogger = {
    ...base,
    beginTrigger(t) {
      const id = base.beginTrigger(t);
      opened.push(id);
      return id;
    },
    recordEffectEnd(token, name, result, value) {
      if (how === "from a host's logger before the built-in records it") throwOnce();
      stamping = how === "from the built-in logger's clock";
      try {
        const exit = base.recordEffectEnd(token, name, result, value);
        if (how === "from a host's logger after the built-in records it") throwOnce();
        return exit;
      } finally {
        stamping = false;
      }
    },
  };
  return { logger, opened, handed };
}

/** `sendApp` with one `load` of `a`, mounted under `logger`: click `send`, then `other`. */
function sentThenOther(policy: EffectSpec["policy"], logger: EpisodeLogger): Seen {
  const { app, seen } = sendApp(policy, ["a"]);
  app.reducers.push(onClick("other", []));
  sent(app, logger);
  (app as MountedApp)._dispatch("other", {});
  return seen;
}

describe("a throw as the logger records a request's effect-end", () => {
  let errors: string[];
  beforeEach(() => {
    errors = captureConsole("error");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // With the `effect-end` not recorded, the claim is released as a dropped launch's is. Recorded,
  // it pairs the `effect-start`, and the `app.error` reducer runs inside the scope it opened.
  const ENDS: [EndThrow, string[]][] = [
    [
      "from a host's logger before the built-in records it",
      ["reducer", "effect-start", "panic", "effect-cancel"],
    ],
    ["from the built-in logger's clock", ["reducer", "effect-start", "panic", "effect-cancel"]],
    [
      "from a host's logger after the built-in records it",
      ["reducer", "effect-start", "effect-end", "panic", "reducer"],
    ],
  ];
  const cases = POLICIES.flatMap(([name, policy]) =>
    ENDS.map(([how, steps]): [string, EndThrow, EffectSpec["policy"], string[]] => [
      name,
      how,
      policy,
      steps,
    ]),
  );

  it.each(
    cases,
  )("under %s, %s, commits the click's episode and hands over every episode in order", async (_, how, policy, steps) => {
    const rejections = unhandledRejections();
    const { logger, opened, handed } = endThrowingOnce(how);
    const seen = sentThenOther(policy, logger);
    await settled();
    expect(handed).toEqual(opened);
    const click = logger.list().find((ep) => ep.id === opened[0]);
    expect(click?.status).toBe("panic");
    expect(click?.steps.map((step) => step.kind)).toEqual(steps);
    expect(seen.ok).toEqual([]);
    expect(seen.appErrors).toEqual([
      expect.objectContaining({
        message: SINK_DOWN,
        location: 'effect "load"',
        category: "effect",
        "episode-id": some(opened[0]),
      }),
    ]);
    expect(reports(errors)).toEqual([
      expect.stringContaining(`[kumiki] error in effect "load": ${SINK_DOWN}`),
    ]);
    expect(rejections).toEqual([]);
  });

  it("names the effect in the effect-cancel that releases the claim", async () => {
    const { logger, opened } = endThrowingOnce("from the built-in logger's clock");
    sentThenOther(undefined, logger);
    await settled();
    const click = logger.list().find((ep) => ep.id === opened[0]);
    expect(click?.steps.at(-1)).toEqual(
      expect.objectContaining({ kind: "effect-cancel", targetId: "load" }),
    );
  });

  // The release commits the click's episode, which hands it to `onEpisode`; by then the episode
  // is stored, so this second throw names no episode.
  it("reports a throw from the hook, as the release commits the episode, with no episode", async () => {
    const rejections = unhandledRejections();
    let hookThrew = false;
    const { logger, opened, handed } = endThrowingOnce(
      "from a host's logger before the built-in records it",
      (ep) => {
        if (hookThrew || ep.trigger.kind !== "ui.click") return;
        hookThrew = true;
        throw new Error("hook offline");
      },
    );
    const seen = sentThenOther(undefined, logger);
    await settled();
    expect(seen.appErrors).toEqual([
      expect.objectContaining({ message: SINK_DOWN, "episode-id": some(opened[0]) }),
      expect.objectContaining({
        message: "hook offline",
        location: 'effect "load"',
        category: "effect",
        "episode-id": NONE,
      }),
    ]);
    expect(reports(errors)).toHaveLength(2);
    expect(handed).toEqual(opened);
    expect(rejections).toEqual([]);
  });
});
