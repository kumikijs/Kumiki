import type { AppShape, MountedApp, ReducerSpec } from "@kumikijs/runtime";
import { mount, renderToString } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { captureConsole } from "./helpers/console.ts";
import { freshRoot } from "./helpers/dom.ts";
import { tick } from "./helpers/time.ts";

/** An app whose `track` effect always errs, since no provider is registered for its capability. */
function makeErringApp(withErrReducer: boolean): AppShape {
  const cap = "telemetry.track";
  return bareApp({
    slots: { failed: { value: false } },
    caps: [cap],
    effects: {
      track: {
        name: "track",
        cap,
        invoke: async (input, caps) => {
          const p = caps.provider(cap);
          if (!p) return { kind: "err", value: { message: "no provider" } };
          return p(input, caps);
        },
      },
    },
    reducers: [
      {
        name: "fire",
        event: { kind: "ui", ev: "click" },
        apply: () => ({ slots: {}, emits: [{ effect: "track", args: [{ name: "click" }] }] }),
      },
      ...(withErrReducer
        ? [
            {
              name: "onFail",
              event: { kind: "effect", effect: "track", outcome: "err" } as const,
              apply: () => ({ slots: { failed: true }, emits: [] }),
            },
          ]
        : []),
    ],
    root: () => ({ kind: "column", children: [] }),
  });
}

describe("an effect error no reducer handles", () => {
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

  it("is surfaced through console.error", async () => {
    const app = makeErringApp(false);
    mount(app, root);
    (app as MountedApp)._dispatch("fire", {});
    await tick(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('effect "track" returned an error');
    expect(errors[0]).toContain("no .err reducer");
  });

  it("stays silent once an .err reducer handles it", async () => {
    const app = makeErringApp(true);
    mount(app, root);
    (app as MountedApp)._dispatch("fire", {});
    await tick(0);
    expect(app.live?.failed).toBe(true);
    expect(errors).toEqual([]);
  });
});

/** Who takes the 503 `load` fails with at boot: nothing, or a reducer whose body does not apply. */
type Taker =
  | "nothing"
  | "a panicking .err reducer"
  | "a refused .err reducer"
  | "a panicking 5xx reducer";

const TAKER_PANICKED = "taker panicked";

function bootFailingApp(taker: Taker): AppShape {
  const panics = (): never => {
    throw new Error(TAKER_PANICKED);
  };
  const reducers: ReducerSpec[] = [];
  if (taker === "a panicking .err reducer" || taker === "a refused .err reducer") {
    reducers.push({
      name: "failed",
      event: { kind: "effect", effect: "load", outcome: "err" },
      apply:
        taker === "a refused .err reducer"
          ? () => ({ slots: { tries: 4 }, emits: [], rejected: [{ slot: "tries", value: 4 }] })
          : panics,
    });
  }
  if (taker === "a panicking 5xx reducer") {
    reducers.push({
      name: "serverDown",
      event: { kind: "lifecycle", name: "app.http-5xx" },
      apply: panics,
    });
  }
  return bareApp({
    slots: { tries: { value: 0 } },
    effects: {
      load: {
        name: "load",
        cap: "",
        invoke: async () => ({ kind: "err", value: { status: 503, message: "busy" } }),
      },
    },
    init: [{ effect: "load", args: [] }],
    reducers,
    ...(taker === "a panicking 5xx reducer" ? { http: { on5xx: "serverDown" } } : {}),
    root: () => ({ kind: "column", children: [] }),
  });
}

/** What a pass reported: its console errors, and where each panic it reported was. */
type Reported = { errors: string[]; panickedIn: string[] };

const PASSES: Record<"mount" | "server", (app: AppShape) => Promise<Reported>> = {
  mount: async (app) => {
    const errors = captureConsole("error");
    const root = freshRoot();
    const handle = mount(app, root);
    await tick(0);
    handle.dispose();
    root.remove();
    const panickedIn = errors.flatMap(
      (e) => /^\[kumiki\] (?:panic|error) in (.+?): /.exec(e)?.[1] ?? [],
    );
    return { errors, panickedIn };
  },
  server: async (app) => {
    const errors = captureConsole("error");
    const { bootstrapEpisode } = await renderToString(app);
    const panickedIn = bootstrapEpisode.steps.flatMap((s) =>
      s.kind === "panic" ? (s.location ?? []) : [],
    );
    return { errors, panickedIn };
  },
};

const NO_ERR_REDUCER = 'effect "load" returned an error with no .err reducer: busy';

describe.each(
  Object.keys(PASSES) as (keyof typeof PASSES)[],
)("on the %s pass, a boot error", (pass) => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("that nothing takes is reported as having no .err reducer", async () => {
    const { errors } = await PASSES[pass](bootFailingApp("nothing"));
    expect(errors.filter((e) => e.includes("no .err reducer"))).toEqual([
      `[kumiki] ${NO_ERR_REDUCER}`,
    ]);
  });

  it.each([
    ["a panicking .err reducer", ['reducer "failed"']],
    ["a refused .err reducer", []],
    ["a panicking 5xx reducer", ['reducer "serverDown"']],
  ] as const)("taken by %s is that reducer's, and only its panic is reported", async (taker, panickedIn) => {
    const reported = await PASSES[pass](bootFailingApp(taker));
    expect(reported.errors.filter((e) => e.includes("no .err reducer"))).toEqual([]);
    expect(reported.panickedIn).toEqual(panickedIn);
  });
});
