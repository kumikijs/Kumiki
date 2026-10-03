// What a `.err` reducer on a built-in storage-family effect actually receives.
// These run programs against the real `storage.*` / `session.*` / `indexed.*`
// handlers, failing, and check that the reducer's `problem := $e` gets the
// `Text` the effect's `out=Result(_, Text)` declares (http.md §6.7) — not a
// record, which renders as "[object Object]". A scripted or mocked result
// stands in for the provider's, so the later blocks hold each of those to
// what the real run delivers: a scenario script, a `reducer-test` /
// `episode-test` mock, and a `kumiki replay` mock.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@kumikijs/compiler";
import {
  _stdlibTest,
  type AppShape,
  type CapabilityProvider,
  type EffectResult,
  type EpisodeLogEntry,
  type EpisodeMockPolicy,
  mount,
  replayEpisodes,
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

/**
 * A program on a capability that defines its own `E` — `HttpError` for
 * `http.get`, the declared `Fault` for a custom one — whose `.err` keeps `$e`.
 */
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

// The test tier. A `reducer-test` / `episode-test` mock and a `kumiki replay
// --mock` stand in for the provider's result exactly as a scenario script
// does, and are read the same way. In a `.kumiki` test the checker sees the
// value first: it must be the effect's `E`, so a record on a `Text`-failing
// effect is E0201 there. The runtime reading is what a mock the checker never
// saw gets — `--mock` JSON, a recorded effect-end, a host calling the runner
// directly — and it is the same `errText` the scenario runner reads through.
describe("a test mock's err on a storage-family effect is the Text the real app delivers", () => {
  type LiveApp = AppShape & { live: Record<string, unknown> };

  /** `src` with one `test` definition appended, checked; the codes it reports. */
  const testCodes = (src: string, test: string): string[] => {
    const r = compile(`${src}\n\n${test}`, { runtimeSpecifier: "./runtime.js" });
    return r.kind === "ok" ? [] : r.errors.map((e) => e.code);
  };
  const reducerTest = (mock: string): string => `
test mocked =
    reducer-test boot
        given  = {slots: {}, mocks: {run: ${mock}}}
        expect = {slots: {problem: "blocked"}, effects: []}`;
  const episodeTest = (mock: string): string => `
test mocked =
    episode-test
        load   = "boot.jsonl"
        mocks  = {run: ${mock}}
        expect = {slots-equal: {problem: "blocked"}, no-panics: true}`;

  it.each([
    ["reducer-test", reducerTest],
    ["episode-test", episodeTest],
  ])("a %s mock err must be the effect's Text: a record is E0201", (_, test) => {
    const src = failingAtBoot("storage.read", `{key: "k"}`);
    expect(testCodes(src, test(`err({message: "blocked"})`))).toEqual(["E0201"]);
    // The control: the same test with a Text is accepted, so the E0201 above
    // is the payload's and not the test's shape.
    expect(testCodes(src, test(`err("blocked")`))).toEqual([]);
  });

  /** What `boot`'s `.err` stores when a reducer-test mocks `run` with `mock`. */
  async function reducerTestStores(
    src: string,
    mock: { outcome: "ok" | "err"; value: unknown },
    capabilities: string[] = [],
  ): Promise<unknown> {
    const app = (await loadSource(src, capabilities)) as LiveApp;
    _stdlibTest.runReducerTestFlow({
      name: "mocked",
      app,
      target: "boot",
      el: {},
      mocks: { run: mock },
      expect: { kind: "state", slots: {}, effects: [] },
    });
    return app.live.problem ?? app.live.failure;
  }

  /** One recorded boot whose `run` failed with `recorded`. */
  const bootEpisode = (recorded: unknown): EpisodeLogEntry => ({
    id: "ep_1",
    trigger: { kind: "app.start" },
    steps: [
      { kind: "reducer", name: "boot", "slot-diffs": [], emits: ["run"] },
      { kind: "effect-end", name: "run", result: "err", value: recorded },
    ],
    status: "completed",
  });

  /** What `.err` stores when the boot episode is replayed with `run` under `mock`. */
  async function replayStores(
    src: string,
    mock: EpisodeMockPolicy,
    recorded: unknown = "recorded",
    capabilities: string[] = [],
  ): Promise<unknown> {
    const app = (await loadSource(src, capabilities)) as LiveApp;
    const report = replayEpisodes({
      app,
      episodes: [bootEpisode(recorded)],
      mocks: { run: mock },
      observer: () => "continue",
    });
    return report.finalSlots.problem ?? report.finalSlots.failure;
  }

  const blocked = { message: "blocked" };

  it.each([
    ["storage.read", `{key: "k"}`],
    ["session.write", `{key: "k", value: "v"}`],
    ["indexed.delete", `{store: "notes", key: "k"}`],
  ])("%s: a {message} err reaches .err as its message, as a provider's would", async (cap, req) => {
    const src = failingAtBoot(cap, req);
    expect(await reducerTestStores(src, { outcome: "err", value: blocked })).toBe("blocked");
    const fixed: EpisodeMockPolicy = { policy: "fixed", outcome: "err", value: blocked };
    expect(await replayStores(src, fixed)).toBe("blocked");
    // A recorded effect-end is a provider's result too — one logged before
    // the handlers delivered Text, say.
    expect(await replayStores(src, { policy: "from-log" }, blocked)).toBe("blocked");
  });

  it("an episode-test with a {message} mock passes on the Text it would see live", async () => {
    const app = (await loadSource(failingAtBoot("storage.read", `{key: "k"}`))) as LiveApp;
    const result = _stdlibTest.runEpisodeTest({
      name: "mocked",
      app,
      episodes: [bootEpisode("recorded")],
      mocks: { run: { policy: "fixed", outcome: "err", value: blocked } },
      expect: { slotsEqual: { problem: "blocked" }, noPanics: true },
    });
    expect(result.pass, result.actual).toBe(true);
  });

  it("a Text err is delivered unchanged", async () => {
    const src = failingAtBoot("storage.read", `{key: "k"}`);
    expect(await reducerTestStores(src, { outcome: "err", value: "blocked" })).toBe("blocked");
    const fixed: EpisodeMockPolicy = { policy: "fixed", outcome: "err", value: "blocked" };
    expect(await replayStores(src, fixed)).toBe("blocked");
  });

  it.each([
    [
      "an http.* err is the HttpError record the mock writes",
      keepsItsErr("http.get", "", `{url: "/x", decode: Decoder.None}`),
      { status: 503, message: "down", body: { _tag: "None" } },
      [],
    ],
    [
      "a custom capability's err is the record the mock writes",
      keepsItsErr("acme.fault", "type Fault = {code: Int}", `{id: "k"}`),
      { code: 7 },
      ["acme.fault"],
    ],
  ])("%s", async (_, src, value, caps) => {
    const want = { _tag: "Some", _0: value };
    expect(await reducerTestStores(src, { outcome: "err", value }, caps)).toEqual(want);
    const fixed: EpisodeMockPolicy = { policy: "fixed", outcome: "err", value };
    expect(await replayStores(src, fixed, "recorded", caps)).toEqual(want);
  });
});
