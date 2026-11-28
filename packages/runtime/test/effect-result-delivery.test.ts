import type {
  AppShape,
  EffectResult,
  EffectSpec,
  EmitSpec,
  Episode,
  EpisodeLogger,
  MountedApp,
  ReducerSpec,
} from "@kumikijs/runtime";
import { createEpisodeLogger } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { bareApp, keylessEffect } from "./helpers/app.ts";
import { captureConsole } from "./helpers/console.ts";
import { defined } from "./helpers/defined.ts";
import {
  type LoggedMount,
  mountLogged,
  SINK_DOWN,
  throwingLogger,
} from "./helpers/episode-apps.ts";
import { tick } from "./helpers/time.ts";

// What each reducer of `load` was handed, and every `PanicInfo` `app.error` was handed.
type Seen = {
  ok: unknown[];
  okAgain: unknown[];
  err: unknown[];
  status: unknown[];
  appErrors: unknown[];
};

const saveOf = (what: string): EmitSpec => ({ effect: "save", args: [what] });
const noKeyFor = (what: unknown): string => `no key for ${String(what)}`;
const SAVE = saveOf("note");
const NO_KEY = noKeyFor("note");
const GAVE_UP = "loaded gave up";

type DeliveryOptions = {
  answer: () => Promise<EffectResult>;
  /** The outcome whose reducer also emits `save`. */
  throwingOn?: "ok" | "err";
  /** `loaded` panics in its body, after it has noted what it was handed. */
  panicking?: boolean;
  /** A second `.ok` reducer, after the first. */
  secondOk?: boolean;
  /** Whether there is an `app.error` reducer, and whether it emits `save` as well. */
  appError?: "none" | "records" | "emits-save";
  /** An `app.http` 5xx reducer, which emits `save`. */
  on5xx?: boolean;
  /** The page holds `Panel` once `note` has changed, and `tile.mount("Panel")` emits these. */
  panel?: EmitSpec[];
  errText?: EffectSpec["errText"];
  fromInit?: boolean;
};

// `loaded` writes what it was handed into `note`, which the page shows.
function deliveryApp(opts: DeliveryOptions): { app: AppShape; seen: Seen } {
  const seen: Seen = { ok: [], okAgain: [], err: [], status: [], appErrors: [] };
  const emitsOn = (outcome: "ok" | "err"): EmitSpec[] =>
    opts.throwingOn === outcome ? [SAVE] : [];
  const reducers: ReducerSpec[] = [
    {
      name: "start",
      event: { kind: "ui", ev: "click" },
      apply: () => ({ slots: {}, emits: [{ effect: "load", args: ["note"] }] }),
    },
    {
      name: "loaded",
      event: { kind: "effect", effect: "load", outcome: "ok" },
      apply: (_live, payload) => {
        seen.ok.push(payload.$1);
        if (opts.panicking) throw new Error(GAVE_UP);
        return { slots: { note: payload.$1 }, emits: emitsOn("ok") };
      },
    },
    {
      name: "failed",
      event: { kind: "effect", effect: "load", outcome: "err" },
      apply: (_live, payload) => {
        seen.err.push(payload.$1);
        return { slots: {}, emits: emitsOn("err") };
      },
    },
  ];
  if (opts.appError !== "none") {
    reducers.push({
      name: "onError",
      event: { kind: "lifecycle", name: "app.error" },
      apply: (_live, payload) => {
        seen.appErrors.push(payload.$event);
        return { slots: {}, emits: opts.appError === "emits-save" ? [SAVE] : [] };
      },
    });
  }
  if (opts.secondOk) {
    reducers.push({
      name: "loadedAgain",
      event: { kind: "effect", effect: "load", outcome: "ok" },
      apply: (_live, payload) => {
        seen.okAgain.push(payload.$1);
        return { slots: {}, emits: [] };
      },
    });
  }
  if (opts.on5xx) {
    reducers.push({
      name: "serverDown",
      event: { kind: "lifecycle", name: "server.down" },
      apply: (_live, payload) => {
        seen.status.push(payload.$1);
        return { slots: {}, emits: [SAVE] };
      },
    });
  }
  const panel = opts.panel;
  if (panel) {
    reducers.push({
      name: "panelShown",
      event: { kind: "lifecycle", name: 'tile.mount("Panel")' },
      apply: () => ({ slots: {}, emits: panel }),
    });
  }
  const note = (): string => `note=${String((app as MountedApp).live?.note)}`;
  const app: AppShape = bareApp({
    slots: { note: { value: "stale" } },
    caps: ["storage.read"],
    effects: {
      load: {
        name: "load",
        cap: "storage.read",
        invoke: () => opts.answer(),
        ...(opts.errText ? { errText: opts.errText } : {}),
      },
      save: keylessEffect("save", (what) => new Error(noKeyFor(what))),
    },
    init: opts.fromInit ? [{ effect: "load", args: ["note"] }] : [],
    reducers,
    ...(opts.on5xx ? { http: { on5xx: "serverDown" } } : {}),
    root: () =>
      opts.panel && (app as MountedApp).live?.note !== "stale"
        ? { kind: "column", props: { _tile: "Panel" }, children: [{ kind: "text", text: note() }] }
        : { kind: "text", text: note() },
  });
  return { app, seen };
}

/** The `_errText` helper a compiled effect on a capability that fails with `Text` carries. */
function errText(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Error) return String(v);
  const message = (v as { message?: unknown } | null)?.message;
  if (typeof message === "string") return message;
  return JSON.stringify(v) ?? String(v);
}

const answerOk = async (): Promise<EffectResult> => ({ kind: "ok", value: "hello" });
const answerErr = async (): Promise<EffectResult> => ({ kind: "err", value: "disk gone" });
const answer5xx = async (): Promise<EffectResult> => ({
  kind: "err",
  value: { status: 503, message: "down" },
});
const throwing = async (): Promise<EffectResult> => {
  throw new Error("disk gone");
};

/** Mount `app` with `logger`, or a plain episode logger, torn down when the test finishes. */
function mounted(app: AppShape, logger?: EpisodeLogger): LoggedMount {
  const m = mountLogged(app, logger);
  onTestFinished(m.dispose);
  return m;
}

/** Mount `app` and dispatch `start`, which launches `load`. */
function started(app: AppShape, logger?: EpisodeLogger): LoggedMount {
  const m = mounted(app, logger);
  m.dispatch("start", {});
  return m;
}

async function settled(seen: Seen): Promise<void> {
  const deadline = Date.now() + 2000;
  while (seen.ok.length + seen.err.length === 0 && Date.now() < deadline) await tick(5);
  // Long enough for a second result, had the request delivered one.
  await tick(30);
}

// The process the tests run in, which the runtime's own types leave out: the runtime targets a
// browser.
type HostProcess = {
  on(event: "unhandledRejection", listener: (reason: unknown) => void): void;
  off(event: "unhandledRejection", listener: (reason: unknown) => void): void;
};

/** Every promise rejection that nothing handles while the test runs. */
function unhandledRejections(): unknown[] {
  const host = defined((globalThis as { process?: HostProcess }).process, "the test's process");
  const seen: unknown[] = [];
  const note = (reason: unknown): void => {
    seen.push(reason);
  };
  host.on("unhandledRejection", note);
  onTestFinished(() => {
    host.off("unhandledRejection", note);
  });
  return seen;
}

describe("a request whose result delivery throws past a reducer body", () => {
  let errors: string[];
  beforeEach(() => {
    errors = captureConsole("error");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each<[string, DeliveryOptions["answer"], "ok" | "err", "ok" | "err", string]>([
    [".ok", answerOk, "ok", "err", "hello"],
    [".err", answerErr, "err", "ok", "disk gone"],
  ])("delivers its %s once, and not the other", async (_, answer, got, other, value) => {
    const { app, seen } = deliveryApp({ answer, throwingOn: got });
    started(app);
    await settled(seen);
    expect(seen[got]).toEqual([value]);
    expect(seen[other]).toEqual([]);
  });

  it("reports the throw as an error of the app, under category effect", async () => {
    const { app, seen } = deliveryApp({ answer: answerOk, throwingOn: "ok" });
    started(app);
    await settled(seen);
    expect(seen.appErrors).toEqual([
      expect.objectContaining({
        message: NO_KEY,
        location: 'effect "load"',
        category: "effect",
      }),
    ]);
    const reported = errors.filter((line) => line.includes('effect "load"'));
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain(`[kumiki] error in effect "load": ${NO_KEY}`);
  });

  it("records it on the result's episode, beside that request's one effect-end", async () => {
    const { app, seen } = deliveryApp({ answer: answerOk, throwingOn: "ok" });
    const { logger } = started(app);
    await settled(seen);
    const ep = episodeWithEnd(logger.list(), "load");
    expect(ep.steps.filter((s) => s.kind === "effect-end" && s.name === "load")).toHaveLength(1);
    expect(ep.steps.find((s) => s.kind === "panic")).toMatchObject({
      message: NO_KEY,
      location: 'effect "load"',
      category: "effect",
    });
    expect(ep.status).toBe("panic");
    expect(seen.appErrors).toEqual([
      expect.objectContaining({ "episode-id": { _tag: "Some", _0: ep.id } }),
    ]);
  });

  it("records it on the episode its result opens, for a request app.init launched", async () => {
    const { app, seen } = deliveryApp({ answer: answerOk, throwingOn: "ok", fromInit: true });
    const { logger } = mounted(app);
    await settled(seen);
    const ep = logger.list().find((e) => e.trigger.kind === "effect.ok");
    expect(ep?.steps.find((s) => s.kind === "panic")).toMatchObject({
      location: 'effect "load"',
      category: "effect",
    });
    expect(seen.appErrors).toEqual([
      expect.objectContaining({ "episode-id": { _tag: "Some", _0: ep?.id } }),
    ]);
  });

  it("still runs the effect's other reducers on that result, as after a panic in a body", async () => {
    const { app, seen } = deliveryApp({ answer: answerOk, throwingOn: "ok", secondOk: true });
    started(app);
    await settled(seen);
    expect(seen.ok).toEqual(["hello"]);
    expect(seen.okAgain).toEqual(["hello"]);
    expect(seen.err).toEqual([]);
  });

  it("renders what the reducer wrote before the throw, with no app.error reducer", async () => {
    const { app, seen } = deliveryApp({ answer: answerOk, throwingOn: "ok", appError: "none" });
    const { root } = started(app);
    await settled(seen);
    expect((app as MountedApp).live?.note).toBe("hello");
    expect(root.textContent).toBe("note=hello");
    expect(errors.filter((line) => line.includes('effect "load"'))).toHaveLength(1);
  });

  // `loaded`'s own render mounts `Panel`, so what `tile.mount("Panel")` throws there is reported
  // under the effect too, before any `app.error` reducer runs.
  it.each<[string, "none" | "records"]>([
    ["with no app.error reducer", "none"],
    ["with an app.error reducer", "records"],
  ])("reports what the render after it throws in turn, and still runs the other reducers, %s", async (_, appError) => {
    const rejections = unhandledRejections();
    const { app, seen } = deliveryApp({
      answer: answerOk,
      throwingOn: "ok",
      secondOk: true,
      panel: [SAVE],
      appError,
    });
    const { root, logger } = started(app);
    await settled(seen);
    const panics = episodeWithEnd(logger.list(), "load").steps.filter((s) => s.kind === "panic");
    expect(panics).toEqual([
      expect.objectContaining({ message: NO_KEY, location: 'effect "load"', category: "effect" }),
      expect.objectContaining({ message: NO_KEY, location: 'effect "load"', category: "effect" }),
    ]);
    expect(errors.filter((line) => line.includes('effect "load"'))).toHaveLength(2);
    expect(seen.okAgain).toEqual(["hello"]);
    expect(root.textContent).toBe("note=hello");
    expect(rejections).toEqual([]);
  });

  it("reports each throw of a tile.mount reducer the render after it runs, one by one", async () => {
    const { app, seen } = deliveryApp({
      answer: answerOk,
      throwingOn: "ok",
      panel: [saveOf("a"), saveOf("b")],
      appError: "records",
    });
    started(app);
    await settled(seen);
    const messages = [NO_KEY, noKeyFor("a"), noKeyFor("b")];
    expect(seen.appErrors).toEqual(
      messages.map((message) =>
        expect.objectContaining({ message, location: 'effect "load"', category: "effect" }),
      ),
    );
    expect(errors.filter((line) => line.includes('effect "load"'))).toEqual(
      messages.map((message) =>
        expect.stringContaining(`[kumiki] error in effect "load": ${message}`),
      ),
    );
  });

  it("reports a throw while the logger closes the result's episode, and still runs the other reducers", async () => {
    captureConsole("warn");
    const rejections = unhandledRejections();
    const { app, seen } = deliveryApp({
      answer: answerOk,
      secondOk: true,
      fromInit: true,
      appError: "none",
    });
    mounted(
      app,
      throwingLogger("endTrigger", () => seen.ok.length > 0),
    );
    await settled(seen);
    expect(seen.okAgain).toEqual(["hello"]);
    expect(errors.filter((line) => line.includes('effect "load"'))).toEqual([
      expect.stringContaining(`[kumiki] error in effect "load": ${SINK_DOWN}`),
      expect.stringContaining(`[kumiki] error in effect "load": ${SINK_DOWN}`),
    ]);
    expect(rejections).toEqual([]);
  });

  it("still runs the other reducers when the episode logger cannot record the throw", async () => {
    captureConsole("warn");
    const rejections = unhandledRejections();
    const { app, seen } = deliveryApp({ answer: answerOk, throwingOn: "ok", secondOk: true });
    started(app, {
      ...createEpisodeLogger(),
      recordPanic: () => {
        throw new Error(SINK_DOWN);
      },
    });
    await settled(seen);
    expect(seen.appErrors).toEqual([
      expect.objectContaining({ location: 'effect "load"', category: "effect" }),
    ]);
    expect(seen.okAgain).toEqual(["hello"]);
    expect(rejections).toEqual([]);
  });

  it("reports a throw past the app.http 5xx reducer the same way", async () => {
    const rejections = unhandledRejections();
    const { app, seen } = deliveryApp({ answer: answer5xx, on5xx: true });
    started(app);
    await settled(seen);
    expect(seen.status).toEqual([{ status: 503, message: "down" }]);
    expect(seen.appErrors).toEqual([
      expect.objectContaining({
        message: NO_KEY,
        location: 'effect "load"',
        category: "effect",
      }),
    ]);
    expect(rejections).toEqual([]);
  });
});

describe("a panic inside the body of a reducer an effect's result runs", () => {
  let errors: string[];
  beforeEach(() => {
    errors = captureConsole("error");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stays a reducer panic, reported once and not under category effect", async () => {
    const { app, seen } = deliveryApp({ answer: answerOk, panicking: true, secondOk: true });
    started(app);
    await settled(seen);
    expect(seen.appErrors).toEqual([
      expect.objectContaining({
        message: GAVE_UP,
        location: 'reducer "loaded"',
        category: "reducer",
      }),
    ]);
    expect(seen.okAgain).toEqual(["hello"]);
    expect(errors.filter((line) => line.includes('effect "load"'))).toEqual([]);
  });

  it("does not run app.error again when that reducer's emit throws, and the other reducers still run", async () => {
    const rejections = unhandledRejections();
    const { app, seen } = deliveryApp({
      answer: answerOk,
      panicking: true,
      secondOk: true,
      appError: "emits-save",
    });
    const { logger } = started(app);
    await settled(seen);
    expect(seen.appErrors).toEqual([
      expect.objectContaining({ location: 'reducer "loaded"', category: "reducer" }),
    ]);
    expect(seen.okAgain).toEqual(["hello"]);
    expect(rejections).toEqual([]);
    expect(errors.filter((line) => line.includes('reducer "onError"'))).toEqual([
      expect.stringContaining(`[kumiki] error in reducer "onError": ${NO_KEY}`),
    ]);
    const panics = episodeWithEnd(logger.list(), "load").steps.filter((s) => s.kind === "panic");
    expect(panics).toEqual([
      expect.objectContaining({ location: 'reducer "loaded"', category: "reducer" }),
      expect.objectContaining({ location: 'reducer "onError"', category: "reducer" }),
    ]);
  });
});

describe("an invoke that throws", () => {
  beforeEach(() => {
    captureConsole("error");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each<[string, EffectSpec["errText"], unknown]>([
    ["fails with Text, hands its one .err the Text", errText, "Error: disk gone"],
    [
      "fails with anything else, hands its one .err {message} with the thrown value's text",
      undefined,
      { message: "Error: disk gone" },
    ],
  ])("on an effect that %s", async (_, text, delivered) => {
    const { app, seen } = deliveryApp({ answer: throwing, ...(text ? { errText: text } : {}) });
    started(app);
    await settled(seen);
    expect(seen.err).toEqual([delivered]);
  });
});

describe("an invoke that returns no result", () => {
  beforeEach(() => {
    captureConsole("error");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delivers one .err, as a throwing invoke does", async () => {
    const answerNothing = (async () => undefined) as unknown as () => Promise<EffectResult>;
    const { app, seen } = deliveryApp({ answer: answerNothing });
    started(app);
    await settled(seen);
    expect(seen.err).toHaveLength(1);
    expect(seen.ok).toEqual([]);
  });
});

/** The one episode in `eps` holding an `effect-end` for `effect`. */
function episodeWithEnd(eps: Episode[], effect: string): Episode {
  const found = eps.filter((e) =>
    e.steps.some((s) => s.kind === "effect-end" && s.name === effect),
  );
  expect(found).toHaveLength(1);
  return found[0] as Episode;
}
