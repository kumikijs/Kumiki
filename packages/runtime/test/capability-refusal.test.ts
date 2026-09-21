// #366: `runtime.md` §10.4.2 defines the capability check in two clauses —
//
//   Checks whether each effect's `cap` is included in `app.caps`. A violation
//   is not executed and is notified to `app.error`.
//
// — and only the first was enforced. A violation reached `console.warn` and
// stopped: no `app.error` reducer ran, no `panic` step landed, and neither
// `smoke` nor `scenario` watches that channel, so an app whose only effect was
// refused mounted, rendered and passed.
//
// `ssr-capability.test.ts` holds both passes to the first clause. This file
// holds both to the second, in one place, because the two drifting apart is
// what #283 and this issue each found once already.
//
// The `AppShape`s are built by hand because that is the only way to reach it:
// the compiler rejects an emit whose capability is undeclared (E0301), so
// there is no `.kumiki` that reproduces this and no corpus example that could.
// The reachable cases are a host-built shape and a `caps` array edited after
// codegen.

import type { AppShape, EffectSpec, EpisodeStep, userPanicInfo } from "@kumikijs/runtime";
import { createEpisodeLogger, mount, renderToString } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
let root: HTMLElement;

beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
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

    const steps = logger.list().flatMap((e) => panicSteps(e.steps));
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      category: "capability",
      location: `effect "save"`,
      message: `capability "storage.write" is not declared in app.caps`,
    });
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

    expect(errors).toHaveLength(1);
    expect(seen[0]?.category).toBe("capability");
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
  });

  it("keeps the effect-start / effect-cancel pair beside it", async () => {
    // The two records say different things and both are load-bearing: the pair
    // is "this emit did not run" (§10.5.1 reads an unpaired start as that, not
    // as truncation), and the panic step is "it was refused, and why".
    const { app } = makeApp([]);

    const { snapshot } = await renderToString(app);

    const kinds = snapshot.bootstrap.steps.map((s) => s.kind);
    expect(kinds).toContain("effect-start");
    expect(kinds).toContain("effect-cancel");
    expect(kinds).toContain("panic");
  });
});
