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
import { createEpisodeLogger, mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { captureConsole } from "./helpers/console.ts";
import { freshRoot } from "./helpers/dom.ts";
import { tick } from "./helpers/time.ts";

// What each reducer of `load` was handed, and every `PanicInfo` `app.error` was handed.
type Seen = { ok: unknown[]; okAgain: unknown[]; err: unknown[]; appErrors: unknown[] };

// `save`'s key is read by the dispatcher when it takes the emit, after the reducer body that
// emitted it has returned, so a reducer that emits it throws past its body.
const SAVE: EmitSpec = { effect: "save", args: ["note"] };

const NO_KEY = "no key for this note";

function deliveryApp(opts: {
  answer: () => Promise<EffectResult>;
  /** The outcome whose reducer also emits `save`. */
  throwingOn?: "ok" | "err";
  /** A second `.ok` reducer, after the first. */
  secondOk?: boolean;
  errText?: EffectSpec["errText"];
  fromInit?: boolean;
}): { app: AppShape; seen: Seen } {
  const seen: Seen = { ok: [], okAgain: [], err: [], appErrors: [] };
  const recorder =
    (into: unknown[], outcome: "ok" | "err"): ReducerSpec["apply"] =>
    (_live, payload) => {
      into.push(payload.$1);
      return { slots: {}, emits: opts.throwingOn === outcome ? [SAVE] : [] };
    };
  const reducers: ReducerSpec[] = [
    {
      name: "start",
      event: { kind: "ui", ev: "click" },
      apply: () => ({ slots: {}, emits: [{ effect: "load", args: ["note"] }] }),
    },
    {
      name: "loaded",
      event: { kind: "effect", effect: "load", outcome: "ok" },
      apply: recorder(seen.ok, "ok"),
    },
    {
      name: "failed",
      event: { kind: "effect", effect: "load", outcome: "err" },
      apply: recorder(seen.err, "err"),
    },
    {
      name: "onError",
      event: { kind: "lifecycle", name: "app.error" },
      apply: (_live, payload) => {
        seen.appErrors.push(payload.$event);
        return { slots: {}, emits: [] };
      },
    },
  ];
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
  const app = bareApp({
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
    root: () => ({ kind: "column", children: [] }),
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
const throwing = async (): Promise<EffectResult> => {
  throw new Error("disk gone");
};

async function settled(seen: Seen): Promise<void> {
  const deadline = Date.now() + 2000;
  while (seen.ok.length + seen.err.length === 0 && Date.now() < deadline) await tick(5);
  // Long enough for a second result, had the request delivered one.
  await tick(30);
}

describe("a request whose result delivery throws past a reducer body", () => {
  let root: HTMLElement;
  let errors: string[];
  beforeEach(() => {
    root = freshRoot();
    errors = captureConsole("error");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    root.remove();
  });

  const start = (app: AppShape, logger?: EpisodeLogger): void => {
    mount(app, root, logger ? { episodeLogger: logger } : {});
    (app as MountedApp)._dispatch("start", {});
  };

  it("delivers its .ok once, and no .err after it", async () => {
    const { app, seen } = deliveryApp({ answer: answerOk, throwingOn: "ok" });
    start(app);
    await settled(seen);
    expect(seen.ok).toEqual(["hello"]);
    expect(seen.err).toEqual([]);
  });

  it("delivers its .err once", async () => {
    const { app, seen } = deliveryApp({ answer: answerErr, throwingOn: "err" });
    start(app);
    await settled(seen);
    expect(seen.err).toEqual(["disk gone"]);
    expect(seen.ok).toEqual([]);
  });

  it("reports the throw as an error of the app, under category effect", async () => {
    const { app, seen } = deliveryApp({ answer: answerOk, throwingOn: "ok" });
    start(app);
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
    const logger = createEpisodeLogger();
    start(app, logger);
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
    const logger = createEpisodeLogger();
    mount(app, root, { episodeLogger: logger });
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
    start(app);
    await settled(seen);
    expect(seen.ok).toEqual(["hello"]);
    expect(seen.okAgain).toEqual(["hello"]);
    expect(seen.err).toEqual([]);
  });
});

describe("an invoke that throws", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = freshRoot();
    captureConsole("error");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    root.remove();
  });

  it("on an effect that fails with Text, hands its one .err the Text", async () => {
    const { app, seen } = deliveryApp({ answer: throwing, errText });
    mount(app, root);
    (app as MountedApp)._dispatch("start", {});
    await settled(seen);
    expect(seen.err).toEqual(["Error: disk gone"]);
  });

  it("on any other effect, hands its one .err {message} with the thrown value's text", async () => {
    const { app, seen } = deliveryApp({ answer: throwing });
    mount(app, root);
    (app as MountedApp)._dispatch("start", {});
    await settled(seen);
    expect(seen.err).toEqual([{ message: "Error: disk gone" }]);
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
