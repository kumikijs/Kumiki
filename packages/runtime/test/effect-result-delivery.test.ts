import type {
  AppShape,
  EffectResult,
  EffectSpec,
  EmitSpec,
  Episode,
  MountedApp,
  ReducerSpec,
} from "@kumikijs/runtime";
import { createEpisodeLogger, mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { captureConsole } from "./helpers/console.ts";
import { freshRoot } from "./helpers/dom.ts";
import { type LoggedMount, mountLogged } from "./helpers/episode-apps.ts";
import { unhandledRejections } from "./helpers/rejections.ts";
import { tick } from "./helpers/time.ts";

// What each reducer of `load` was handed, and every `PanicInfo` `app.error` was handed.
type Seen = {
  ok: unknown[];
  okAgain: unknown[];
  err: unknown[];
  status: unknown[];
  appErrors: unknown[];
};

// `save`'s key is read by the dispatcher when it takes the emit, after the reducer body that
// emitted it has returned, so a reducer that emits it throws past its body.
const SAVE: EmitSpec = { effect: "save", args: ["note"] };

const NO_KEY = "no key for this note";
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
  /** The page holds `Panel` once `note` has changed, and `tile.mount("Panel")` emits `save`. */
  panel?: boolean;
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
  if (opts.panel) {
    reducers.push({
      name: "panelShown",
      event: { kind: "lifecycle", name: 'tile.mount("Panel")' },
      apply: () => ({ slots: {}, emits: [SAVE] }),
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
      save: {
        name: "save",
        cap: "",
        policy: {
          kind: "latest-per-key",
          keyOf: () => {
            throw new Error(NO_KEY);
          },
        },
        invoke: async () => ({ kind: "ok", value: null }),
      },
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

/** Mount `app` with an episode logger, torn down when the test finishes. */
function mounted(app: AppShape): LoggedMount {
  const m = mountLogged(app);
  onTestFinished(m.dispose);
  return m;
}

/** Mount `app` and dispatch `start`, which launches `load`. */
function started(app: AppShape): LoggedMount {
  const m = mounted(app);
  m.dispatch("start", {});
  return m;
}

async function settled(seen: Seen): Promise<void> {
  const deadline = Date.now() + 2000;
  while (seen.ok.length + seen.err.length === 0 && Date.now() < deadline) await tick(5);
  // Long enough for a second result, had the request delivered one.
  await tick(30);
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

  // With an `app.error` reducer, its own render mounts `Panel` first, and that throw is its own.
  it("reports what the render after it throws in turn, and still runs the other reducers", async () => {
    const rejections = unhandledRejections();
    const { app, seen } = deliveryApp({
      answer: answerOk,
      throwingOn: "ok",
      secondOk: true,
      panel: true,
      appError: "none",
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

  it("still runs the other reducers when the episode logger cannot record the throw", async () => {
    captureConsole("warn");
    const rejections = unhandledRejections();
    const { app, seen } = deliveryApp({ answer: answerOk, throwingOn: "ok", secondOk: true });
    const logger = createEpisodeLogger();
    const root = freshRoot();
    const handle = mount(app, root, {
      episodeLogger: {
        ...logger,
        recordPanic: () => {
          throw new Error("episode sink offline");
        },
      },
    });
    onTestFinished(() => {
      handle.dispose();
      root.remove();
    });
    (app as MountedApp)._dispatch("start", {});
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
