import { feature } from "@kumikijs/examples";
import type { EffectResult } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { failingAtBoot, problemShown } from "./helpers/effect-failure.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const EXAMPLE = feature("119-effect-payload-bind-types");

describe("a failed storage-family effect delivers its declared Text to .err", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("storage.read: example 119 renders the failure's message", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    const text = await problemShown(await loadApp(EXAMPLE));
    expect(text).toContain("problem: Error: storage blocked");
    expect(text).not.toContain("[object Object]");
  });

  it("session.write: a throwing sessionStorage renders the failure's message", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    const app = await loadSource(failingAtBoot("session.write", `{key: "k", value: "v"}`));
    const text = await problemShown(app);
    expect(text).toContain('problem: sessionStorage.setItem("k") failed: Error: quota exceeded');
    expect(text).not.toContain("[object Object]");
  });

  it("indexed.read: an app with no app.indexed-db renders why", async () => {
    const app = await loadSource(failingAtBoot("indexed.read", `{store: "notes", key: "k"}`));
    const text = await problemShown(app);
    expect(text).toContain("problem: app.indexed-db is not declared");
    expect(text).not.toContain("[object Object]");
  });

  it("a host provider for storage.write that throws is delivered as the same Text", async () => {
    const app = await loadSource(failingAtBoot("storage.write", `{key: "k", value: "v"}`));
    const text = await problemShown(app, {
      "storage.write": () => {
        throw new Error("provider down");
      },
    });
    expect(text).toContain("problem: Error: provider down");
    expect(text).not.toContain("[object Object]");
  });

  it("a host provider for storage.read that returns a {message} err is delivered as that message", async () => {
    const app = await loadSource(failingAtBoot("storage.read", `{key: "k"}`));
    const text = await problemShown(app, {
      "storage.read": async () => ({ kind: "err", value: { message: "vault sealed" } }),
    });
    expect(text).toContain("problem: vault sealed");
    expect(text).not.toContain("[object Object]");
  });

  it("a host provider for indexed.write that returns a Text err passes it through unchanged", async () => {
    const app = await loadSource(
      failingAtBoot("indexed.write", `{store: "notes", key: "k", value: "v"}`),
    );
    const text = await problemShown(app, {
      "indexed.write": () => ({ kind: "err", value: "disk full" }),
    });
    expect(text).toContain("problem: disk full");
  });

  it("storage.read when the localStorage getter itself throws, as in an opaque-origin sandbox", async () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
    try {
      const app = await loadSource(failingAtBoot("storage.read", `{key: "k"}`));
      expect(await problemShown(app)).toContain("problem: SecurityError: denied");
    } finally {
      if (saved) Object.defineProperty(globalThis, "localStorage", saved);
    }
  });

  it.each([
    "storage.read",
    "session.read",
    "indexed.write",
  ])("%s with in=Unit and no map-request delivers the Text of the missing request", async (cap) => {
    const app = await loadSource(failingAtBoot(cap, null), []);
    const text = await problemShown(app);
    expect(text).toMatch(/problem: (TypeError: |app\.indexed-db is not declared)/);
    expect(text).not.toContain("[object Object]");
  });

  it("a map-request that panics is delivered as its Text, once: retry= does not retry it", async () => {
    const app = await loadSource(
      failingAtBoot("storage.read", `panic("no key")`, "retry=linear(3, 5000ms)"),
    );
    const text = await problemShown(app);
    expect(text).toContain("problem: KumikiPanic: no key");
  });

  it("a provider that throws is called once under retry=; one that returns err is retried", async () => {
    let thrown = 0;
    const throwing = await problemShown(
      await loadSource(
        failingAtBoot("storage.write", `{key: "k", value: "v"}`, "retry=linear(3, 10ms)"),
      ),
      {
        "storage.write": () => {
          thrown++;
          throw new Error("provider down");
        },
      },
    );
    expect(throwing).toContain("problem: Error: provider down");
    expect(thrown).toBe(1);

    let returned = 0;
    const returning = await problemShown(
      await loadSource(
        failingAtBoot("storage.write", `{key: "k", value: "v"}`, "retry=linear(3, 10ms)"),
      ),
      {
        "storage.write": () => {
          returned++;
          return { kind: "err", value: `attempt ${returned}` };
        },
      },
    );
    expect(returning).toContain("problem: attempt 3");
    expect(returned).toBe(3);
  });

  it("a provider that rejects asynchronously is delivered as the same Text", async () => {
    const app = await loadSource(failingAtBoot("storage.write", `{key: "k", value: "v"}`));
    const text = await problemShown(app, {
      "storage.write": async () => {
        throw new Error("async down");
      },
    });
    expect(text).toContain("problem: Error: async down");
  });

  // One reading of an err value for the returned and the thrown path alike.
  const ERR_VALUES: [string, () => unknown, string][] = [
    ["an Error", () => new Error("boom"), "Error: boom"],
    ["a {message} record", () => ({ message: "sealed" }), "sealed"],
    ["a record with no message", () => ({ code: 5 }), '{"code":5}'],
    ["null", () => null, "null"],
    ["a record String() cannot print", () => Object.create(null), "{}"],
  ];

  it.each(
    ERR_VALUES,
  )("%s is the same Text returned as an err value and thrown", async (_, make, want) => {
    const src = failingAtBoot("storage.read", `{key: "k"}`);
    const returned = await problemShown(await loadSource(src), {
      "storage.read": () => ({ kind: "err", value: make() }),
    });
    const thrown = await problemShown(await loadSource(src), {
      "storage.read": () => {
        throw make();
      },
    });
    expect(returned).toContain(`problem: ${want}`);
    expect(thrown).toContain(`problem: ${want}`);
  });

  it("an err value no reading survives is a fixed Text rather than a second throw", async () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const app = await loadSource(failingAtBoot("storage.read", `{key: "k"}`));
    const text = await problemShown(app, {
      "storage.read": () => ({ kind: "err", value: cyclic }),
    });
    expect(text).toContain("problem: the effect failed with a value that cannot be shown as Text");
  });

  it("a provider that returns no {kind, value} is an err naming what it returned", async () => {
    const app = await loadSource(failingAtBoot("storage.read", `{key: "k"}`));
    const text = await problemShown(app, {
      "storage.read": () => null as unknown as EffectResult,
    });
    expect(text).toContain(
      "problem: Error: the storage.read provider returned null, not {kind, value}",
    );
  });
});
