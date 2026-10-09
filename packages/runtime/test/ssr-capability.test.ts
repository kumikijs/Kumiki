import type { AppShape, CapabilityProvider, EffectSpec } from "@kumikijs/runtime";
import { createEpisodeLogger, hydrate, renderToString } from "@kumikijs/runtime";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Built = {
  app: AppShape;
  /** Called once per effect the SSR pass actually invoked, in order. */
  ran: string[];
};

function makeInvoke(cap: string, ran: string[], value: unknown): EffectSpec["invoke"] {
  return async (input, caps) => {
    const provider = caps.provider(cap);
    if (provider) return await provider(input, caps);
    ran.push(`${String(value)}:${String(input)}`);
    return { kind: "ok", value };
  };
}

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

let errors: string[];

beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
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

  it("reports in the words the live dispatcher uses", async () => {
    const { app } = makeApp("storage.write", []);

    await renderToString(app);

    expect(errors).toEqual([
      `[kumiki] panic in effect "save": capability "storage.write" is not declared in app.caps`,
    ]);
  });

  it("does not reach a host provider for an undeclared capability", async () => {
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
    expect(errors).toEqual([
      `[kumiki] panic in effect "audit": capability "http.post" is not declared in app.caps`,
    ]);
  });

  it("leaves a declared sibling in the same init alone", async () => {
    const { app, ran } = makeApp("storage.write", ["log.write"]);
    app.effects.ping = {
      name: "ping",
      cap: "log.write",
      invoke: makeInvoke("log.write", ran, "pinged"),
    };
    app.init.push({ effect: "ping", args: ["hello"] });

    const { bootstrapEpisode } = await renderToString(app);

    expect(ran).toEqual(["pinged:hello"]);
    expect(bootstrapEpisode.status).toBe("panic");
    expect(bootstrapEpisode.steps.map((s) => s.kind)).toEqual([
      "effect-start",
      "panic",
      "effect-cancel",
      "effect-start",
      "effect-end",
    ]);
  });
});

describe("the bootstrap episode records the skip", () => {
  it("commits rather than stranding on a start that never ends", async () => {
    const { app } = makeApp("storage.write", []);

    const { bootstrapEpisode } = await renderToString(app);

    expect(bootstrapEpisode.status).toBe("panic");
    expect(bootstrapEpisode.steps.at(-1)).toMatchObject({ kind: "effect-cancel" });
  });

  it("shows the effect that would have run, then why, then its cancel", async () => {
    const { app } = makeApp("storage.write", []);

    const { bootstrapEpisode } = await renderToString(app);

    expect(bootstrapEpisode.steps.map((s) => s.kind)).toEqual([
      "effect-start",
      "panic",
      "effect-cancel",
    ]);
    const [start, panic, cancel] = bootstrapEpisode.steps;
    expect(start).toMatchObject({ kind: "effect-start", name: "save", args: "draft" });
    expect(panic).toMatchObject({ kind: "panic", category: "capability" });
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
