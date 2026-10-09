import type { AppShape, EffectSpec, EpisodeStep, userPanicInfo } from "@kumikijs/runtime";
import { createEpisodeLogger, mount, renderToString } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureConsole } from "./helpers/console.ts";
import { freshRoot } from "./helpers/dom.ts";

type PanicInfo = ReturnType<typeof userPanicInfo>;

/** The refused effect, and the `app.error` reducer that records the report. */
function makeApp(declared: string[]): { app: AppShape; seen: PanicInfo[]; ran: string[] } {
  const ran: string[] = [];
  const seen: PanicInfo[] = [];
  const save: EffectSpec = {
    name: "save",
    cap: "storage.write",
    invoke: async (input) => {
      ran.push(String(input));
      return { kind: "ok", value: "stored" };
    },
  };
  const app: AppShape = {
    slots: { saved: { value: "none" } },
    caps: declared,
    effects: { save },
    init: [{ effect: "save", args: ["draft"] }],
    reducers: [
      {
        name: "onError",
        event: { kind: "lifecycle", name: "app.error" },
        apply: (live, payload) => {
          seen.push(payload.$event as PanicInfo);
          return { slots: live, emits: [] };
        },
      },
    ],
    root: (): { kind: "text"; text: string } => ({ kind: "text", text: "ready" }),
  };
  return { app, seen, ran };
}

let errors: string[];
let warnings: string[];
let root: HTMLElement;

beforeEach(() => {
  errors = captureConsole("error");
  warnings = captureConsole("warn");
  root = freshRoot();
});

afterEach(() => {
  vi.restoreAllMocks();
  root.remove();
});

const panicSteps = (steps: readonly EpisodeStep[]): EpisodeStep[] =>
  steps.filter((s) => s.kind === "panic");

describe("a refused effect is reported to the app (live)", () => {
  it("fires app.error with the capability category", async () => {
    const { app, seen, ran } = makeApp([]);

    const { dispose } = mount(app, root);
    await vi.waitFor(() => expect(seen).toHaveLength(1));

    expect(ran).toEqual([]);
    const info = seen[0];
    expect(info?.category).toBe("capability");
    expect(info?.message).toBe(`capability "storage.write" is not declared in app.caps`);
    expect(info?.location).toBe(`effect "save"`);
    dispose();
  });

  it("reports on the channel the verification tiers watch", async () => {
    const { app, seen } = makeApp([]);

    const { dispose } = mount(app, root);
    await vi.waitFor(() => expect(seen).toHaveLength(1));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe(
      `[kumiki] panic in effect "save": capability "storage.write" is not declared in app.caps`,
    );
    expect(warnings).toEqual([]);
    dispose();
  });

  it("hands the $event no stack and no cause, because nothing threw", async () => {
    const { app, seen } = makeApp([]);

    const { dispose } = mount(app, root);
    await vi.waitFor(() => expect(seen).toHaveLength(1));

    expect(seen[0]?.cause).toEqual({ _tag: "None" });
    expect(seen[0]).not.toHaveProperty("stack");
    expect(errors[0]?.split("\n")).toHaveLength(1);
    dispose();
  });

  it("records a panic step when an episode is open, so a replay shows why nothing ran", async () => {
    const logger = createEpisodeLogger({ memoryMax: 10 });
    const { app, seen } = makeApp([]);
    app.init = [];
    app.reducers.push({
      name: "onStart",
      event: { kind: "lifecycle", name: "app.start" },
      apply: (live) => ({ slots: live, emits: [{ effect: "save", args: ["draft"] }] }),
    });

    const { dispose } = mount(app, root, { episodeLogger: logger });
    await vi.waitFor(() => expect(seen).toHaveLength(1));

    const eps = logger.list();
    const steps = eps.flatMap((e) => panicSteps(e.steps));
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      category: "capability",
      location: `effect "save"`,
      message: `capability "storage.write" is not declared in app.caps`,
    });
    // The id the `$event` carries names the episode that holds the step.
    const owner = eps.find((e) => panicSteps(e.steps).length > 0);
    expect(seen[0]?.["episode-id"]).toEqual({ _tag: "Some", _0: owner?.id });
    dispose();
  });

  it("records the panic on the episode that owns a deferred emit, not on none", async () => {
    const logger = createEpisodeLogger({ memoryMax: 10 });
    const { app, seen } = makeApp([]);
    const save = app.effects.save;
    if (!save) throw new Error("fixture lost its effect");
    save.policy = { kind: "queue" };
    app.init = [];
    app.reducers.push({
      name: "onStart",
      event: { kind: "lifecycle", name: "app.start" },
      apply: (live) => ({ slots: live, emits: [{ effect: "save", args: ["draft"] }] }),
    });

    const { dispose } = mount(app, root, { episodeLogger: logger });
    await vi.waitFor(() => expect(seen).toHaveLength(1));

    const eps = logger.list();
    const owner = eps.find((e) => panicSteps(e.steps).length > 0);
    expect(owner).toBeDefined();
    // Panic before cancel: the cancel settles the episode, so a step appended
    // after it lands on one already handed to `onEpisode`.
    expect(owner?.steps.map((s) => s.kind).slice(-2)).toEqual(["panic", "effect-cancel"]);
    expect(owner?.status).toBe("panic");
    expect(seen[0]?.["episode-id"]).toEqual({ _tag: "Some", _0: owner?.id });
    dispose();
  });

  it("still reports an init-time refusal, which no episode is open around", async () => {
    const logger = createEpisodeLogger({ memoryMax: 10 });
    const { app, seen } = makeApp([]);

    const { dispose } = mount(app, root, { episodeLogger: logger });
    await vi.waitFor(() => expect(seen).toHaveLength(1));

    expect(logger.list().flatMap((e) => panicSteps(e.steps))).toEqual([]);
    expect(seen[0]?.["episode-id"]).toEqual({ _tag: "None" });
    expect(errors).toHaveLength(1);
    expect(seen[0]?.category).toBe("capability");
    dispose();
  });

  it("does not re-enter app.error when the handler itself emits a refused effect", async () => {
    const { app, seen } = makeApp([]);
    const handler = app.reducers[0];
    if (!handler) throw new Error("fixture lost its handler");
    handler.apply = (live, payload) => {
      seen.push(payload.$event as PanicInfo);
      return { slots: live, emits: [{ effect: "save", args: ["again"] }] };
    };

    const { dispose } = mount(app, root);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    await vi.waitFor(() => expect(errors.length).toBeGreaterThanOrEqual(2));

    // Two refusals reported, one dispatch into `app.error`.
    expect(seen).toHaveLength(1);
    expect(errors).toHaveLength(2);
    dispose();
  });

  it("says nothing when the capability is declared", async () => {
    const { app, seen, ran } = makeApp(["storage.write"]);

    const { dispose } = mount(app, root);
    await vi.waitFor(() => expect(ran).toEqual(["draft"]));

    expect(seen).toEqual([]);
    expect(errors).toEqual([]);
    dispose();
  });

  it("leaves a presentation effect, whose cap is empty, alone", async () => {
    const { app, seen, ran } = makeApp([]);
    const save = app.effects.save;
    if (!save) throw new Error("fixture lost its effect");
    save.cap = "";

    const { dispose } = mount(app, root);
    await vi.waitFor(() => expect(ran).toEqual(["draft"]));

    expect(seen).toEqual([]);
    dispose();
  });
});

describe("a refused effect is reported to the log (SSR)", () => {
  it("records the same panic step the live path does", async () => {
    const { app, ran } = makeApp([]);

    const { snapshot } = await renderToString(app);

    expect(ran).toEqual([]);
    const steps = panicSteps(snapshot.bootstrap.steps);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      category: "capability",
      location: `effect "save"`,
      message: `capability "storage.write" is not declared in app.caps`,
    });
  });

  it("prints the same console line the live path prints", async () => {
    const { app } = makeApp([]);

    await renderToString(app);

    expect(errors).toEqual([
      `[kumiki] panic in effect "save": capability "storage.write" is not declared in app.caps`,
    ]);
    expect(warnings).toEqual([]);
  });

  it("fires no app.error, because the server pass has none to fire", async () => {
    const { app, seen } = makeApp([]);

    await renderToString(app);

    expect(seen).toEqual([]);
  });

  it("keeps the effect-start / effect-cancel pair around it, in the live path's order", async () => {
    const { app } = makeApp([]);

    const { snapshot } = await renderToString(app);

    expect(snapshot.bootstrap.steps.map((s) => s.kind)).toEqual([
      "effect-start",
      "panic",
      "effect-cancel",
    ]);
  });
});
