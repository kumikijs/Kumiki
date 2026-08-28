// The capability check is a runtime gate, not only a compile-time one. Spec
// runtime.md §10.4.2, in full:
//
//   Checks whether each effect's `cap` is included in `app.caps`. A violation
//   is not executed and is notified to `app.error`.
//
// The live dispatcher's `launch` applies the first sentence; the SSR pass did
// not, so an effect the client refuses to run still ran on the server — a
// request issued from the prerender and never again after hydration. These
// tests hold the two passes to that first sentence. The second — the report to
// `app.error` — is implemented on neither path, and is not what this file
// pins: a violation reaches `console.warn` and stops there.
//
// The `AppShape`s are built by hand because that is the only way to reach the
// hole: the compiler rejects an emit whose capability is undeclared (E0301),
// so the reachable cases are a host-built shape and a `caps` array edited
// after codegen.

import type { AppShape, CapabilityProvider, EffectSpec } from "@kumikijs/runtime";
import { createEpisodeLogger, hydrate, renderToString } from "@kumikijs/runtime";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Built = {
  app: AppShape;
  /** Called once per effect the SSR pass actually invoked, in order. */
  ran: string[];
};

/**
 * The `invoke` shape codegen emits: consult the host provider for this
 * capability, fall back to the built-in implementation. Written out here
 * because a fixture that ignores `caps` would pass a gate placed anywhere at
 * all, including below this seam.
 */
function makeInvoke(cap: string, ran: string[], value: unknown): EffectSpec["invoke"] {
  return async (input, caps) => {
    const provider = caps.provider(cap);
    if (provider) return await provider(input, caps);
    ran.push(`${String(value)}:${String(input)}`);
    return { kind: "ok", value };
  };
}

/**
 * An app whose single `init` emit is `save`, plus the reducer that writes
 * `saved` when it succeeds. `cap` and `app.caps` are the two knobs each test
 * turns; everything else is held constant so a difference in outcome is a
 * difference in the gate.
 */
function makeApp(cap: string, declared: string[]): Built {
  const ran: string[] = [];
  const save: EffectSpec = { name: "save", cap, invoke: makeInvoke(cap, ran, "stored") };
  const app: AppShape = {
    slots: { saved: { value: "none" } },
    caps: declared,
    effects: { save },
    init: [{ effect: "save", args: ["draft"] }],
    reducers: [
      {
        name: "onSaved",
        event: { kind: "effect", effect: "save", outcome: "ok" },
        apply: (_live, payload) => ({ slots: { saved: payload.$1 as string }, emits: [] }),
      },
    ],
    root: (): { kind: "text"; text: string } => ({
      kind: "text",
      text: `saved: ${String(app.live?.saved ?? "none")}`,
    }),
  };
  return { app, ran };
}

let warnings: string[];

beforeEach(() => {
  warnings = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("the SSR pass gates an effect on its capability", () => {
  it("does not invoke an effect whose capability is not in app.caps", async () => {
    const { app, ran } = makeApp("storage.write", []);

    const { html, snapshot } = await renderToString(app);

    expect(ran).toEqual([]);
    // The reducer chain hangs off the effect result, so the slot still holds
    // its default: nothing about the app advanced. The page is still served —
    // a refused effect is not a failed render.
    expect(snapshot.slots.saved).toBe("none");
    expect(html).toContain("saved: none");
  });

  it("invokes one whose capability is declared", async () => {
    const { app, ran } = makeApp("storage.write", ["storage.write"]);

    const { html, snapshot } = await renderToString(app);

    expect(ran).toEqual(["stored:draft"]);
    expect(snapshot.slots.saved).toBe("stored");
    expect(html).toContain("saved: stored");
  });

  it("exempts a standard presentation effect, whose cap is empty", async () => {
    const { app, ran } = makeApp("", []);

    await renderToString(app);

    expect(ran).toEqual(["stored:draft"]);
  });

  it("warns in the words the live dispatcher uses", async () => {
    const { app } = makeApp("storage.write", []);

    await renderToString(app);

    expect(warnings).toEqual(['Capability "storage.write" not declared in app.caps']);
  });

  it("does not reach a host provider for an undeclared capability", async () => {
    // The provider seam is consulted from inside `invoke`, so a gate placed
    // below it would let a host implementation answer for a capability the app
    // never declared. Pinned by a provider that would answer if asked.
    const provider: Mock<CapabilityProvider> = vi.fn(async () => ({
      kind: "ok" as const,
      value: "from-provider",
    }));
    const { app, ran } = makeApp("storage.write", []);

    const { snapshot } = await renderToString(app, { providers: { "storage.write": provider } });

    expect(provider).not.toHaveBeenCalled();
    expect(ran).toEqual([]);
    expect(snapshot.slots.saved).toBe("none");
  });

  it("gates a follow-up emit a reducer produces, not only an init one", async () => {
    // `dispatchEmit` recurses for the emits an `.ok` reducer returns. The gate
    // has to sit on that path too, or the second hop escapes it.
    const { app, ran } = makeApp("storage.write", ["storage.write"]);
    app.effects.audit = {
      name: "audit",
      cap: "http.post",
      invoke: makeInvoke("http.post", ran, "audited"),
    };
    const onSaved = app.reducers[0];
    if (!onSaved) throw new Error("fixture lost its reducer");
    onSaved.apply = (_live, payload) => ({
      slots: { saved: payload.$1 as string },
      emits: [{ effect: "audit", args: ["saved"] }],
    });

    await renderToString(app);

    expect(ran).toEqual(["stored:draft"]);
    expect(warnings).toEqual(['Capability "http.post" not declared in app.caps']);
  });

  it("leaves a declared sibling in the same init alone", async () => {
    // The gate returns early from one `dispatchEmit` while `Promise.all` is
    // still running the others, and its cancel settles the episode's pending
    // counter — a counter both emits share.
    const { app, ran } = makeApp("storage.write", ["log.write"]);
    app.effects.ping = {
      name: "ping",
      cap: "log.write",
      invoke: makeInvoke("log.write", ran, "pinged"),
    };
    app.init.push({ effect: "ping", args: ["hello"] });

    const { bootstrapEpisode } = await renderToString(app);

    expect(ran).toEqual(["pinged:hello"]);
    expect(bootstrapEpisode.status).toBe("completed");
    // One episode carries both accounts: the refusal and the chain that ran.
    expect(bootstrapEpisode.steps.map((s) => s.kind)).toEqual([
      "effect-start",
      "effect-cancel",
      "effect-start",
      "effect-end",
    ]);
  });
});

describe("the bootstrap episode records the skip", () => {
  it("commits rather than stranding on a start that never ends", async () => {
    // `recordEffectStart` leaves the episode pending until its end lands.
    // A gate that recorded the start and then returned would keep the
    // bootstrap episode uncommitted, which `renderToString` rejects outright.
    const { app } = makeApp("storage.write", []);

    const { bootstrapEpisode } = await renderToString(app);

    expect(bootstrapEpisode.status).toBe("completed");
  });

  it("shows the effect that would have run, then its cancel", async () => {
    const { app } = makeApp("storage.write", []);

    const { bootstrapEpisode } = await renderToString(app);

    expect(bootstrapEpisode.steps.map((s) => s.kind)).toEqual(["effect-start", "effect-cancel"]);
    const [start, cancel] = bootstrapEpisode.steps;
    expect(start).toMatchObject({ kind: "effect-start", name: "save", args: "draft" });
    expect(cancel).toMatchObject({ kind: "effect-cancel", targetId: "save" });
  });

  it("leaves a declared effect's chain intact", async () => {
    const { app } = makeApp("storage.write", ["storage.write"]);

    const { bootstrapEpisode } = await renderToString(app);

    expect(bootstrapEpisode.steps.map((s) => s.kind)).toEqual([
      "effect-start",
      "effect-end",
      "reducer",
      "signal-update",
    ]);
  });
});

describe("after hydration", () => {
  it("leaves the slot at its default, because init does not run again", async () => {
    // Where the refusal is felt. `app.init` is not re-executed on the client
    // (§10.6.2 step 5) and the client's own gate refuses the same emit, so an
    // undeclared capability means the slot never advances at all.
    const { app, ran } = makeApp("storage.write", []);
    const rendered = await renderToString(app);
    const target = document.createElement("div");
    document.body.appendChild(target);

    const handle = hydrate(app, target, rendered, { episodeLogger: createEpisodeLogger() });

    expect(app.live?.saved).toBe("none");
    expect(ran).toEqual([]);
    expect(handle.episodes()[0]?.trigger.kind).toBe("ssr.hydrate");
    handle.dispose();
  });
});
