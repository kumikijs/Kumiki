// The emits the dispatcher cannot run, held on both paths, in one file: one
// whose capability `app.caps` does not declare (§10.4.2's second clause — a
// refused effect "is notified to `app.error`"), and one naming no effect in
// `app.effects` at all (§10.4.1). `ssr-capability.test.ts` holds both passes
// to the *first* clause of §10.4.2 (a refusal does not run); this is its
// sibling, kept together because the two paths drifting apart is what #283
// and #366 each found once already.
//
// The `AppShape`s are built by hand because that is the only way to reach
// either: the compiler rejects an emit whose capability is undeclared (E0301)
// and one whose effect is undefined (E0104), so there is no `.kumiki` that
// reproduces them and no corpus example that could. The reachable cases are a
// host-built shape, and a `caps` array or an `effects` map edited after
// codegen.

import type { AppShape, EffectSpec, EmitSpec, EpisodeStep, userPanicInfo } from "@kumikijs/runtime";
import { createEpisodeLogger, mount, renderToString } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STANDARD_EFFECTS } from "../src/ssr.ts";

/**
 * The `$event` an `app.error` reducer is handed. Taken off the one builder
 * rather than re-declared, so a field added there shows up here.
 */
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
  errors = [];
  warnings = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });
  root = document.createElement("div");
  document.body.appendChild(root);
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

    // The first clause still holds: refused means not executed.
    expect(ran).toEqual([]);
    const info = seen[0];
    expect(info?.category).toBe("capability");
    // The message names both halves of the question a reader has — which
    // capability, and that `app.caps` is where it was looked for.
    expect(info?.message).toBe(`capability "storage.write" is not declared in app.caps`);
    expect(info?.location).toBe(`effect "save"`);
    dispose();
  });

  it("reports on the channel the verification tiers watch", async () => {
    // The whole shape of the bug: `console.warn` is a channel `smoke` and
    // `scenario` do not patch, so the app passed. Both patch `console.error`.
    const { app, seen } = makeApp([]);

    const { dispose } = mount(app, root);
    await vi.waitFor(() => expect(seen).toHaveLength(1));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe(
      `[kumiki] panic in effect "save": capability "storage.write" is not declared in app.caps`,
    );
    // And nothing on the channel it used to take, so a reader cannot be left
    // thinking the refusal is reported twice.
    expect(warnings).toEqual([]);
    dispose();
  });

  it("hands the $event no stack and no cause, because nothing threw", async () => {
    // §10.4.2 promises this in as many words. `cause` is `Option(Text)` on the
    // user-facing shape, so the absence has to read as `None` rather than as a
    // missing key — a program doing `$event.cause.get-or("")` must see "".
    const { app, seen } = makeApp([]);

    const { dispose } = mount(app, root);
    await vi.waitFor(() => expect(seen).toHaveLength(1));

    expect(seen[0]?.cause).toEqual({ _tag: "None" });
    expect(seen[0]).not.toHaveProperty("stack");
    // The console line is the header alone — no stack continuation lines.
    expect(errors[0]?.split("\n")).toHaveLength(1);
    dispose();
  });

  it("records a panic step when an episode is open, so a replay shows why nothing ran", async () => {
    const logger = createEpisodeLogger({ memoryMax: 10 });
    const { app, seen } = makeApp([]);
    // Emitted from a reducer rather than from `app.init`, so a dispatch
    // episode is open around the refusal — `recordPanic` attaches to the
    // episode in focus, and `app.init` runs before any is opened.
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
    // The join: the id the `$event` carries names the episode that holds the
    // step, which is the whole point of shipping an id at all (§7.2.3).
    const owner = eps.find((e) => panicSteps(e.steps).length > 0);
    expect(seen[0]?.["episode-id"]).toEqual({ _tag: "Some", _0: owner?.id });
    dispose();
  });

  it("records the panic on the episode that owns a deferred emit, not on none", async () => {
    // A deferred policy launches from a timer (debounce) or a promise tail
    // (queue), by which point `endTrigger` has balanced out and nothing is in
    // focus. The token claimed at dispatch time is the only thing that can
    // still name the owning episode; without it the refusal fell out of the
    // log entirely and the episode read exactly like a replaced timer —
    // `effect-start`, `effect-cancel`, nothing else.
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
    // `app.init` emits are dispatched before the first episode opens, so the
    // `panic` step has nowhere to attach — §10.5.1 says as much about the live
    // path. The other two channels are what make the refusal visible anyway,
    // which is the point of reporting to more than one.
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
    // `inPanicHandler` is the only thing between an `app.error` reducer that
    // trips the same gate and an unbounded recursion. The refusal is still
    // reported on the console each time round — it is the dispatch back into
    // the app that stops.
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
  // The server pass has no `app.error` to fire — a reducer panic there is a
  // `panic` step and nothing more — so the refusal is held to that same rule
  // rather than inventing a second one. What the two passes must agree on is
  // the record: same message, same location, same category.
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
    // Not an omission: a reducer panic on this pass is a `panic` step and
    // nothing more, and the refusal is held to that same rule rather than
    // inventing a second one for it (§10.4.2). The fixture registers an
    // `app.error` reducer, so this would catch one being dispatched.
    const { app, seen } = makeApp([]);

    await renderToString(app);

    expect(seen).toEqual([]);
  });

  it("keeps the effect-start / effect-cancel pair around it, in the live path's order", async () => {
    // The two records say different things and both are load-bearing: the pair
    // is "this emit did not run" (§10.5.1 reads an unpaired start as that, not
    // as truncation), and the panic step is "it was refused, and why". The
    // order is the live path's, because there the cancel settles the episode
    // and a step after it would land on one already committed.
    const { app } = makeApp([]);

    const { snapshot } = await renderToString(app);

    expect(snapshot.bootstrap.steps.map((s) => s.kind)).toEqual([
      "effect-start",
      "panic",
      "effect-cancel",
    ]);
  });
});

/** `save` misspelled: an emit naming no effect in `app.effects`. */
const TYPO = { effect: "sve", args: ["draft"] } satisfies EmitSpec;
const TYPO_MESSAGE = `effect "sve" is not declared in app.effects`;
const TYPO_LINE = `[kumiki] panic in effect "sve": ${TYPO_MESSAGE}`;

/**
 * The kinds of an episode's steps, less the `signal-update`s each render adds:
 * the order of the reducers, effects and panics is what these cases read.
 */
const stepKinds = (steps: readonly EpisodeStep[] = []): string[] =>
  steps.map((s) => s.kind).filter((k) => k !== "signal-update");

/**
 * {@link makeApp} with its capability declared, so `save` runs wherever it is
 * emitted, and with `emits` coming out of an `app.start` reducer rather than
 * out of `app.init` — so a dispatch episode is open around them.
 */
function emitOnStart(emits: EmitSpec[]): ReturnType<typeof makeApp> {
  const made = makeApp(["storage.write"]);
  made.app.init = [];
  made.app.reducers.push({
    name: "onStart",
    event: { kind: "lifecycle", name: "app.start" },
    apply: (live) => ({ slots: live, emits }),
  });
  return made;
}

describe("an emit naming no effect is reported to the app (live)", () => {
  // Synchronously, unlike the refusal above: the dispatcher looks the name up
  // the moment the emit reaches it, before any policy could defer anything —
  // a policy is a property of an effect, and there is no effect to read one
  // off.
  it("fires app.error with the effect category", () => {
    const { app, seen } = emitOnStart([TYPO]);

    const { dispose } = mount(app, root);

    expect(seen).toEqual([
      {
        message: TYPO_MESSAGE,
        location: `effect "sve"`,
        "episode-id": { _tag: "None" },
        cause: { _tag: "None" },
        category: "effect",
      },
    ]);
    dispose();
  });

  it("reports on the channel the verification tiers watch, in the same header", () => {
    const { app } = emitOnStart([TYPO]);

    const { dispose } = mount(app, root);

    // One line: nothing was thrown, so there is no stack to continue it with.
    expect(errors).toEqual([TYPO_LINE]);
    expect(warnings).toEqual([]);
    dispose();
  });

  it("leaves the emits beside it to run", async () => {
    const { app, seen, ran } = emitOnStart([TYPO, { effect: "save", args: ["draft"] }]);

    const { dispose } = mount(app, root);
    await vi.waitFor(() => expect(ran).toEqual(["draft"]));

    expect(seen.map((s) => s.location)).toEqual([`effect "sve"`]);
    dispose();
  });

  it("records a panic step on the episode the emit came from, and no effect-start", () => {
    const logger = createEpisodeLogger({ memoryMax: 10 });
    const { app, seen } = emitOnStart([TYPO]);

    const { dispose } = mount(app, root, { episodeLogger: logger });

    const owner = logger.list().find((e) => panicSteps(e.steps).length > 0);
    expect(owner?.trigger).toMatchObject({ kind: "lifecycle", target: "app.start" });
    // The emitting reducer, the report, then the `app.error` reducer joining
    // the same episode. No `effect-start` and no `effect-cancel`: nothing was
    // claimed, so there is nothing to release.
    expect(stepKinds(owner?.steps)).toEqual(["reducer", "panic", "reducer"]);
    const step = panicSteps(owner?.steps ?? [])[0];
    expect(step).toMatchObject({
      category: "effect",
      location: `effect "sve"`,
      message: TYPO_MESSAGE,
    });
    expect(step).not.toHaveProperty("stack");
    expect(owner?.status).toBe("panic");
    expect(seen[0]?.["episode-id"]).toEqual({ _tag: "Some", _0: owner?.id });
    dispose();
  });

  it("records the panic on the episode a deferred effect's result reopens", async () => {
    // A queued effect launches from a promise tail, after the episode that
    // emitted it closed. Its `.ok` reducer runs with that episode back in
    // focus, so an emit from there belongs to it — the step lands there, and
    // `episode-id` names it, rather than an episode of its own or none.
    const logger = createEpisodeLogger({ memoryMax: 10 });
    const { app, seen } = emitOnStart([{ effect: "save", args: ["draft"] }]);
    const save = app.effects.save;
    if (!save) throw new Error("fixture lost its effect");
    save.policy = { kind: "queue" };
    app.reducers.push({
      name: "onSaved",
      event: { kind: "effect", effect: "save", outcome: "ok" },
      apply: (live) => ({ slots: live, emits: [TYPO] }),
    });

    const { dispose } = mount(app, root, { episodeLogger: logger });
    await vi.waitFor(() => expect(seen).toHaveLength(1));

    const owner = logger.list().find((e) => panicSteps(e.steps).length > 0);
    expect(owner?.trigger).toMatchObject({ kind: "lifecycle", target: "app.start" });
    expect(stepKinds(owner?.steps)).toEqual([
      "reducer",
      "effect-start",
      "effect-end",
      "reducer",
      "panic",
      "reducer",
    ]);
    expect(seen[0]?.["episode-id"]).toEqual({ _tag: "Some", _0: owner?.id });
    dispose();
  });

  it("still reports an init-time emit, which no episode is open around", () => {
    const logger = createEpisodeLogger({ memoryMax: 10 });
    const { app, seen } = makeApp(["storage.write"]);
    app.init = [TYPO];

    const { dispose } = mount(app, root, { episodeLogger: logger });

    // The answer the refusal above gets at the same moment: no episode to hold
    // the step, so the console and `app.error` are the whole report.
    expect(logger.list().flatMap((e) => panicSteps(e.steps))).toEqual([]);
    expect(errors).toEqual([TYPO_LINE]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.category).toBe("effect");
    expect(seen[0]?.["episode-id"]).toEqual({ _tag: "None" });
    dispose();
  });

  it("does not re-enter app.error when the handler itself emits it", () => {
    const { app, seen } = makeApp(["storage.write"]);
    app.init = [TYPO];
    const handler = app.reducers[0];
    if (!handler) throw new Error("fixture lost its handler");
    handler.apply = (live, payload) => {
      seen.push(payload.$event as PanicInfo);
      return { slots: live, emits: [TYPO] };
    };

    const { dispose } = mount(app, root);

    // Two reports, one dispatch into `app.error`.
    expect(errors).toEqual([TYPO_LINE, TYPO_LINE]);
    expect(seen).toHaveLength(1);
    dispose();
  });

  it("runs a standard effect, which the mount installs before anything dispatches", async () => {
    // The program declares no `log`; the mount registers it, so the name is a
    // key of `app.effects` by the time `app.start` emits it.
    const logged: unknown[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args[1]);
    });
    const entry = { level: "info", message: "boot", data: {} };
    const { app, seen } = emitOnStart([{ effect: "log", args: [entry] }]);
    app.caps = ["log.write"];

    const { dispose } = mount(app, root);
    await vi.waitFor(() => expect(logged).toEqual([entry]));

    expect(errors).toEqual([]);
    expect(seen).toEqual([]);
    dispose();
  });

  it("says nothing for an http.cancel naming an id nothing is running under", () => {
    // The effect is known and only the id it is handed is not: cancellation's
    // idempotent no-op (http.md §6.4), not an emit the dispatcher cannot run.
    const { app, seen } = emitOnStart([{ effect: "cancel", args: ["save:_"] }]);
    app.caps = ["storage.write", "http.cancel"];
    app.effects.cancel = {
      name: "cancel",
      cap: "http.cancel",
      invoke: async () => ({ kind: "ok", value: null }),
    };

    const { dispose } = mount(app, root);

    expect(errors).toEqual([]);
    expect(seen).toEqual([]);
    dispose();
  });
});

describe("an emit naming no effect is reported to the log (SSR)", () => {
  it("records the panic step the live path does, with no effect-start / effect-cancel pair", async () => {
    const { app, seen } = makeApp(["storage.write"]);
    app.init = [TYPO];

    const { snapshot } = await renderToString(app);

    // A refused capability is bracketed by a start and a cancel, because the
    // pass has an effect to claim a start for. Here it has none, so the step
    // is the whole record — and with no start claimed, nothing is left
    // pending to keep the bootstrap episode from committing.
    expect(snapshot.bootstrap.steps.map((s) => s.kind)).toEqual(["panic"]);
    expect(snapshot.bootstrap.steps[0]).toMatchObject({
      category: "effect",
      location: `effect "sve"`,
      message: TYPO_MESSAGE,
    });
    expect(snapshot.bootstrap.status).toBe("panic");
    // The server pass has no `app.error` to fire, here as for the refusal.
    expect(seen).toEqual([]);
  });

  it("prints the same console line the live path prints", async () => {
    const { app } = makeApp(["storage.write"]);
    app.init = [TYPO];

    await renderToString(app);

    expect(errors).toEqual([TYPO_LINE]);
    expect(warnings).toEqual([]);
  });

  it("leaves the init emits beside it to run", async () => {
    const { app, ran } = makeApp(["storage.write"]);
    app.init = [TYPO, { effect: "save", args: ["draft"] }];

    const { snapshot } = await renderToString(app);

    expect(ran).toEqual(["draft"]);
    expect(snapshot.bootstrap.steps.map((s) => s.kind)).toEqual([
      "panic",
      "effect-start",
      "effect-end",
    ]);
  });

  it("skips a standard effect, which names an effect the pass does not run", async () => {
    // The pass installs no standard effect, so each of these finds no entry in
    // `app.effects` — and each is one a compiled program may emit from
    // `app.init`. Reporting them would put a panic on the console of every
    // server render of a valid program, and ship its bootstrap as `"panic"`.
    const { app } = makeApp([]);
    app.effects = {};
    app.init = [
      { effect: "log", args: [{ level: "info", message: "boot", data: {} }] },
      { effect: "toast", args: [{ kind: "info", text: "hi" }] },
      { effect: "navigate", args: [{ path: "/next", params: {}, query: {} }] },
    ];

    const { snapshot } = await renderToString(app);

    expect(errors).toEqual([]);
    expect(snapshot.bootstrap.steps).toEqual([]);
    expect(snapshot.bootstrap.status).toBe("completed");
  });

  it("knows every standard effect a mount installs as one", () => {
    // The pass's list against the installers: a mount through the full entry
    // registers every standard effect onto an app that declares none.
    const { app } = makeApp([]);
    app.effects = {};
    app.init = [];

    const { dispose } = mount(app, root);

    expect(Object.keys(app.effects).sort()).toEqual([...STANDARD_EFFECTS].sort());
    dispose();
  });
});
