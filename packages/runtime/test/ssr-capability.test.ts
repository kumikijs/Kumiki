// The capability check is a runtime gate, not only a compile-time one
// (spec/runtime.md §10.4.2: "Checks whether each effect's `cap` is included in
// `app.caps`. A violation is not executed"). The live dispatcher's `launch`
// applies it; the SSR pass did not, so an effect the client refuses to run
// still ran on the server — a request issued from the prerender and never
// again after hydration.
//
// These tests hold the two passes to the same rule. They build the `AppShape`
// by hand because that is the only way to reach the hole: the compiler rejects
// an emit whose capability is undeclared (E0301), so the reachable cases are a
// host-built shape and a `caps` array edited after codegen.

import type { AppShape, CapabilityProvider, EffectSpec } from "@kumikijs/runtime";
import { renderToString } from "@kumikijs/runtime";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Built = {
  app: AppShape;
  /** Called once per effect the SSR pass actually invoked, in order. */
  ran: string[];
};

/**
 * An app whose single `init` emit is `save`, plus the reducer that writes
 * `saved` when it succeeds. `cap` and `app.caps` are the two knobs each test
 * turns; everything else is held constant so a difference in outcome is a
 * difference in the gate.
 */
function makeApp(cap: string, declared: string[]): Built {
  const ran: string[] = [];
  const save: EffectSpec = {
    name: "save",
    cap,
    invoke: async (input) => {
      ran.push(`save:${String(input)}`);
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
        name: "onSaved",
        event: { kind: "effect", effect: "save", outcome: "ok" },
        apply: (_live, payload) => ({ slots: { saved: payload.$1 as string }, emits: [] }),
      },
    ],
    root: () => ({ kind: "text", text: "app" }),
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
});

describe("the SSR pass gates an effect on its capability", () => {
  it("does not invoke an effect whose capability is not in app.caps", async () => {
    const { app, ran } = makeApp("storage.write", []);

    const { snapshot } = await renderToString(app);

    expect(ran).toEqual([]);
    // The reducer chain hangs off the effect result, so the slot still holds
    // its default: nothing about the app advanced.
    expect(snapshot.slots.saved).toBe("none");
  });

  it("invokes one whose capability is declared", async () => {
    const { app, ran } = makeApp("storage.write", ["storage.write"]);

    const { snapshot } = await renderToString(app);

    expect(ran).toEqual(["save:draft"]);
    expect(snapshot.slots.saved).toBe("stored");
  });

  it("exempts a standard presentation effect, whose cap is empty", async () => {
    const { app, ran } = makeApp("", []);

    await renderToString(app);

    expect(ran).toEqual(["save:draft"]);
  });

  it("warns in the words the live dispatcher uses", async () => {
    const { app } = makeApp("storage.write", []);

    await renderToString(app);

    expect(warnings).toEqual(['Capability "storage.write" not declared in app.caps']);
  });

  it("does not reach a host provider for an undeclared capability", async () => {
    // The provider seam is consulted from inside `invoke`, so a gate placed
    // below it would let a host implementation run for a capability the app
    // never declared. Pinned by a provider that would answer if asked.
    const provider: Mock<CapabilityProvider> = vi.fn(async () => ({
      kind: "ok" as const,
      value: "from-provider",
    }));
    const { app, ran } = makeApp("storage.write", []);

    await renderToString(app, { providers: { "storage.write": provider } });

    expect(provider).not.toHaveBeenCalled();
    expect(ran).toEqual([]);
  });

  it("gates a follow-up emit a reducer produces, not only an init one", async () => {
    // `dispatchEmit` recurses for the emits an `.ok` reducer returns. The gate
    // has to sit on that path too, or the second hop escapes it.
    const { app, ran } = makeApp("storage.write", ["storage.write"]);
    const audit: EffectSpec = {
      name: "audit",
      cap: "http.post",
      invoke: async () => {
        ran.push("audit");
        return { kind: "ok", value: null };
      },
    };
    app.effects.audit = audit;
    const onSaved = app.reducers[0];
    if (!onSaved) throw new Error("fixture lost its reducer");
    onSaved.apply = (_live, payload) => ({
      slots: { saved: payload.$1 as string },
      emits: [{ effect: "audit", args: ["saved"] }],
    });

    await renderToString(app);

    expect(ran).toEqual(["save:draft"]);
    expect(warnings).toEqual(['Capability "http.post" not declared in app.caps']);
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
