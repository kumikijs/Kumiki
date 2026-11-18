import type {
  AppShape,
  EffectResult,
  EffectSpec,
  EpisodeLogger,
  MountedApp,
} from "@kumikijs/runtime";
import { createEpisodeLogger, mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { captureConsole } from "./helpers/console.ts";
import { freshRoot } from "./helpers/dom.ts";
import { unhandledRejections } from "./helpers/rejections.ts";
import { tick } from "./helpers/time.ts";

const SINK_DOWN = "episode sink offline";

/** Where the host's episode logger throws, the first time it is asked to record it. */
type ThrowSite =
  /** Recording a request's `effect-end`, before its reducers run. */
  | "effect-end"
  /** The call `recordEffectEnd` hands back, which closes the result's scope after its reducers. */
  | "result-scope"
  /** Recording a request's `effect-start`. */
  | "effect-start";

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

type Seen = { ok: unknown[]; appErrors: Record<string, unknown>[] };

/**
 * `send` emits `load` once for each of `inputs`, under `policy`, and `loaded` notes what each
 * `.ok` hands it. `app.error` notes every `PanicInfo`.
 */
function sendApp(
  policy: EffectSpec["policy"],
  inputs: readonly string[],
): { app: AppShape; seen: Seen } {
  const seen: Seen = { ok: [], appErrors: [] };
  const app = bareApp({
    caps: ["storage.read"],
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
        apply: () => ({ slots: {}, emits: inputs.map((i) => ({ effect: "load", args: [i] })) }),
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
          return { slots: {}, emits: [] };
        },
      },
    ],
    root: () => ({ kind: "text", text: "" }),
  });
  return { app, seen };
}

/** Mount `app` under `logger`, torn down when the test finishes, and click `send`. */
function sent(app: AppShape, logger: EpisodeLogger): void {
  const root = freshRoot();
  const handle = mount(app, root, { episodeLogger: logger });
  onTestFinished(() => {
    handle.dispose();
    root.remove();
  });
  (app as MountedApp)._dispatch("send", {});
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

const AFTER_RESULT: ThrowSite[] = ["effect-end", "result-scope"];

describe("a throw past an effect's launch, outside the reducers its result runs", () => {
  let errors: string[];
  beforeEach(() => {
    errors = captureConsole("error");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const cases = POLICIES.flatMap(([name, policy]) =>
    AFTER_RESULT.map((site): [string, ThrowSite, EffectSpec["policy"]] => [name, site, policy]),
  );

  it.each(
    cases,
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
    expect(errors.filter((line) => line.includes('effect "load"'))).toEqual([
      expect.stringContaining(`[kumiki] error in effect "load": ${SINK_DOWN}`),
    ]);
    expect(rejections).toEqual([]);
  });

  it("under the default policy, from the logger at effect-start, is reported the same way", async () => {
    const rejections = unhandledRejections();
    const { app, seen } = sendApp(undefined, ["a"]);
    sent(app, throwingLogger("effect-start", [1]).logger);
    await settled();
    expect(seen.appErrors).toEqual([
      expect.objectContaining({
        message: SINK_DOWN,
        location: 'effect "load"',
        category: "effect",
      }),
    ]);
    expect(errors.filter((line) => line.includes('effect "load"'))).toHaveLength(1);
    expect(rejections).toEqual([]);
  });

  it.each(
    AFTER_RESULT,
  )("under queue, from the logger at %s, is reported for an entry another follows", async (site) => {
    const rejections = unhandledRejections();
    const { app, seen } = sendApp({ kind: "queue" }, ["a", "b", "c"]);
    sent(app, throwingLogger(site, [1, 2]).logger);
    await settled();
    expect(seen.appErrors.map((e) => e.location)).toEqual(['effect "load"', 'effect "load"']);
    expect(errors.filter((line) => line.includes('effect "load"'))).toHaveLength(2);
    expect(rejections).toEqual([]);
  });

  it("under queue, still runs the entries behind the one that threw", async () => {
    const { app, seen } = sendApp({ kind: "queue" }, ["a", "b", "c"]);
    sent(app, throwingLogger("result-scope", [1]).logger);
    await settled();
    expect(seen.ok).toEqual(["a", "b", "c"]);
  });

  it.each<[string, EffectSpec["policy"]]>([
    ["the default policy", undefined],
    ["queue", { kind: "queue" }],
  ])("under %s, names the episode that claimed the request as its episode-id", async (_, policy) => {
    const { app, seen } = sendApp(policy, ["a"]);
    const { logger, opened } = throwingLogger("effect-end", [1]);
    sent(app, logger);
    await settled();
    const [click] = opened;
    expect(seen.appErrors).toEqual([
      expect.objectContaining({ "episode-id": { _tag: "Some", _0: click } }),
    ]);
  });
});
