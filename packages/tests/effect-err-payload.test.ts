// What a `.err` reducer on a built-in storage-family effect actually receives.
// A test mock can deliver any shape it likes, so it only shows the shape its
// author believed in; these run programs against the real
// `storage.*` / `session.*` / `indexed.*` handlers, failing, and check that the
// reducer's `problem := $e` gets the `Text` the effect's `out=Result(_, Text)`
// declares (http.md §6.7) — not a record, which renders as "[object Object]".

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AppShape,
  type CapabilityProvider,
  type EffectResult,
  mount,
  runScenario,
  type Scenario,
} from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadApp, loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "119-effect-payload-bind-types.kumiki");

const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitUntil(done: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await tick();
  }
}

/** Mount `app`, wait for its `problem: …` line to fill, and return the page text. */
async function problemShown(
  app: AppShape,
  providers?: Record<string, CapabilityProvider>,
): Promise<string> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  let dispose: (() => void) | undefined;
  try {
    ({ dispose } = mount(app, root, providers ? { providers } : undefined));
    await waitUntil(() => /problem: \S/.test(root.textContent ?? ""));
    return root.textContent ?? "";
  } finally {
    dispose?.();
    root.remove();
  }
}

/**
 * A program whose one effect fails at boot and whose `.err` stores `$e` as it
 * is. `mapRequest: null` declares none, so the invoke receives no request.
 */
const failingAtBoot = (cap: string, mapRequest: string | null, clauses = ""): string => `
slot problem : Text = ""
effect run cap=${cap} in=Unit out=Result(Unit, Text)
    ${mapRequest === null ? "" : `map-request=${mapRequest}`} ${clauses}
reducer boot   on=app.start      do= emit run()
reducer failed on=run.err($e, _) do= problem := $e
tile App = column(text("problem: " + problem))
app ErrPayload
    caps   = [${cap}]
    routes = {"/" -> App, "/404" -> App}
    init   = []`;

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
    // Not the handler's own catch: the throw escapes the provider, which the
    // dispatcher would otherwise wrap as `{message: …}` without knowing `E`.
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
    // A provider written against the old record contract returns `{message}`
    // as its err value; `$e : Text` must still get the message, not the record
    // (which `String(…)` would render as "[object Object]").
    const app = await loadSource(failingAtBoot("storage.read", `{key: "k"}`));
    const text = await problemShown(app, {
      "storage.read": async () => ({ kind: "err", value: { message: "vault sealed" } }),
    });
    expect(text).toContain("problem: vault sealed");
    expect(text).not.toContain("[object Object]");
  });

  it("a host provider for indexed.write that returns a Text err passes it through unchanged", async () => {
    // Guard, passes before and after the coercion above: a provider already on
    // the `Text` contract must not have its value touched.
    const app = await loadSource(
      failingAtBoot("indexed.write", `{store: "notes", key: "k", value: "v"}`),
    );
    const text = await problemShown(app, {
      "indexed.write": () => ({ kind: "err", value: "disk full" }),
    });
    expect(text).toContain("problem: disk full");
  });

  it("storage.read when the localStorage getter itself throws, as in an opaque-origin sandbox", async () => {
    // The handler used to read the global before its own `try`, and codegen
    // returned the built-in's promise without awaiting it, so the rejection
    // skipped the invoke's `try` and reached the dispatcher as `{message}`.
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
    // `check` accepts the declaration; the handler then receives `undefined`
    // as its request.
    const app = await loadSource(failingAtBoot(cap, null), []);
    const text = await problemShown(app);
    expect(text).toMatch(/problem: (TypeError: |app\.indexed-db is not declared)/);
    expect(text).not.toContain("[object Object]");
  });

  it("a map-request that panics is delivered as its Text, once: retry= does not retry it", async () => {
    // The retry delay is far longer than the wait: a retried panic would not
    // reach `.err` in time.
    const app = await loadSource(
      failingAtBoot("storage.read", `panic("no key")`, "retry=linear(3, 5000ms)"),
    );
    const text = await problemShown(app);
    expect(text).toContain("problem: KumikiPanic: no key");
  });

  it("a provider that throws is called once under retry=; one that returns err is retried", async () => {
    // Only a throw is final. A returned err is what `retry=` exists for.
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
    // Only the `await` on the provider's promise keeps this inside the invoke's
    // `try`; the synchronous throw above does not need it.
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

// The scenario tier. A scripted outcome takes the place of a provider's
// result (stdlib.md §2.5), so it is read as one: each row runs the same value
// through a real mount, as a host provider's err, and through `runScenario`, as
// a scripted err, and the slot must hold the same `Text` both ways. The runner
// used to hand the script's value to `.err` as written, so a record or a number
// reached the `Text` slot and the page showed "[object Object]".
describe("a scripted err on a storage-family effect is the Text the real app delivers", () => {
  type Script = { outcome: "err"; value?: unknown };

  /** The slot a scenario's boot leaves behind, with `effects` / `defaultEffect` scripted. */
  async function scenarioState(
    src: string,
    scripts: Pick<Scenario, "effects" | "defaultEffect">,
    capabilities: string[] = [],
  ): Promise<Record<string, unknown>> {
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const report = await runScenario(await loadSource(src, capabilities), root, {
        ...scripts,
        steps: [{ label: "boot fails", expect: { noErrors: true } }],
      });
      const failures = report.steps.flatMap((s) => s.failures);
      expect(report.ok, failures.join("\n")).toBe(true);
      return report.steps[0]?.state ?? {};
    } finally {
      root.remove();
    }
  }

  /** The `Text` a real mount stores when the capability's provider returns `script`'s err. */
  async function realDelivers(cap: string, src: string, script: Script): Promise<string> {
    // A script with no `value` is a provider's err with no `value`, not one of `null`.
    const result = { kind: "err", ...("value" in script ? { value: script.value } : {}) };
    const app = await loadSource(src);
    await problemShown(app, { [cap]: () => result as EffectResult });
    return (app.live as Record<string, unknown>).problem as string;
  }

  // [what is scripted, cap, map-request, the script, the Text the real app shows]
  const ROWS: [string, string, string, Script, string][] = [
    ["a Text", "storage.read", `{key: "k"}`, { outcome: "err", value: "blocked" }, "blocked"],
    [
      "a {message} record",
      "storage.read",
      `{key: "k"}`,
      { outcome: "err", value: { message: "blocked" } },
      "blocked",
    ],
    ["a number", "storage.read", `{key: "k"}`, { outcome: "err", value: 42 }, "42"],
    ["no value", "storage.read", `{key: "k"}`, { outcome: "err" }, "undefined"],
    [
      "a record with no message",
      "session.write",
      `{key: "k", value: "v"}`,
      { outcome: "err", value: { code: 5 } },
      '{"code":5}',
    ],
    [
      "a {message} record",
      "indexed.delete",
      `{store: "notes", key: "k"}`,
      { outcome: "err", value: { message: "locked" } },
      "locked",
    ],
  ];

  it.each(ROWS)("%s on %s", async (_, cap, mapRequest, script, shown) => {
    const src = failingAtBoot(cap, mapRequest);
    const real = await realDelivers(cap, src, script);
    expect(real).toBe(shown);
    expect((await scenarioState(src, { effects: { run: [script] } })).problem).toBe(real);
  });

  it("a defaultEffect err is read the same way", async () => {
    const src = failingAtBoot("storage.read", `{key: "k"}`);
    const script: Script = { outcome: "err", value: { message: "blocked" } };
    const real = await realDelivers("storage.read", src, script);
    expect(real).toBe("blocked");
    expect((await scenarioState(src, { defaultEffect: script })).problem).toBe(real);
  });

  // The other capabilities define their own `E`, and a script writes it as the
  // provider would return it: it reaches `.err` as written.
  const keepsItsErr = (cap: string, decl: string, request: string): string => `
${decl}
slot failure : Option(${cap === "http.get" ? "HttpError" : "Fault"}) = None
effect run cap=${cap} in=Unit out=Result(Unit, ${cap === "http.get" ? "HttpError" : "Fault"})
    map-request=${request}
reducer boot   on=app.start      do= emit run()
reducer failed on=run.err($e, _) do= failure := Some($e)
tile App = column(text("failure"))
app KeepsErr
    caps   = [${cap}]
    routes = {"/" -> App, "/404" -> App}
    init   = []`;

  it("an http.* err is the HttpError record the script writes", async () => {
    const httpError = { status: 503, message: "down", body: { _tag: "None" } };
    const src = keepsItsErr("http.get", "", `{url: "/x", decode: Decoder.None}`);
    const state = await scenarioState(src, {
      effects: { run: [{ outcome: "err", value: httpError }] },
    });
    expect(state.failure).toEqual({ _tag: "Some", _0: httpError });
  });

  it("a custom capability's err is the record the script writes", async () => {
    const src = keepsItsErr("acme.fault", "type Fault = {code: Int}", `{id: "k"}`);
    const state = await scenarioState(
      src,
      { effects: { run: [{ outcome: "err", value: { code: 7 } }] } },
      ["acme.fault"],
    );
    expect(state.failure).toEqual({ _tag: "Some", _0: { code: 7 } });
  });
});
