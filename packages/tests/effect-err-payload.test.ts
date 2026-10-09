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

type LiveApp = AppShape & { live: Record<string, unknown> };

/** An err result; with no `value` key it is a provider's err with no `value`, not one of `null`. */
type Script = { outcome: "err"; value?: unknown };

/** What `.err` stored: `problem` on a `failingAtBoot` app, `failure` on a `keepsItsErr` one. */
const stored = (slots: Record<string, unknown>): unknown => slots.problem ?? slots.failure;

/** The slots a scenario's boot leaves behind, with `effects` / `defaultEffect` scripted. */
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
  const result = { kind: "err", ...("value" in script ? { value: script.value } : {}) };
  const app = await loadSource(src);
  await problemShown(app, { [cap]: () => result as EffectResult });
  return (app.live as Record<string, unknown>).problem as string;
}

/** The slots `boot`'s mocked `run` leaves when a reducer-test mocks it with `mock`. */
async function reducerTestSlots(
  src: string,
  mock: { outcome: "ok" | "err"; value?: unknown },
  capabilities: string[] = [],
): Promise<Record<string, unknown>> {
  const app = (await loadSource(src, capabilities)) as LiveApp;
  _stdlibTest.runReducerTestFlow({
    name: "mocked",
    app,
    target: "boot",
    el: {},
    mocks: { run: mock },
    expect: { kind: "state", slots: {}, effects: [] },
  });
  return app.live;
}

/**
 * A recorded `effect-end` of `run`. A result with no `value` gives a step whose `value` is `undefined`, which the JSON a log reaches replay as drops
 * ({@link replaySlots}): a log line with no `value` at all.
 */
const effectEnd = (result: {
  outcome: "ok" | "err";
  value?: unknown;
}): EpisodeLogEntry["steps"][number] => ({
  kind: "effect-end",
  name: "run",
  result: result.outcome,
  value: result.value,
});

/** One recorded boot whose `run` ended with `recorded`. */
const bootEpisode = (recorded: { outcome: "ok" | "err"; value?: unknown }): EpisodeLogEntry => ({
  id: "ep_1",
  trigger: { kind: "app.start" },
  steps: [{ kind: "reducer", name: "boot", "slot-diffs": [], emits: ["run"] }, effectEnd(recorded)],
  status: "completed",
});

const hydrateEpisode = (
  recorded: { outcome: "ok" | "err"; value?: unknown },
  entry: string,
): EpisodeLogEntry => ({
  id: "ep_boot",
  trigger: { kind: "ssr.hydrate", target: "/" },
  steps: [effectEnd(recorded), { kind: "reducer", name: entry, "slot-diffs": [], emits: [] }],
  status: "completed",
});

/** The final slots of replaying `episode` with `run` under `mock`. */
async function replaySlots(
  src: string,
  episode: EpisodeLogEntry,
  mock: EpisodeMockPolicy,
  capabilities: string[] = [],
): Promise<Record<string, unknown>> {
  const app = (await loadSource(src, capabilities)) as LiveApp;
  const report = replayEpisodes({
    app,
    // Through JSON, because that is how an episode reaches `kumiki replay`.
    episodes: [JSON.parse(JSON.stringify(episode)) as EpisodeLogEntry],
    mocks: { run: mock },
    observer: () => "continue",
  });
  expect(report.panics).toEqual([]);
  return report.finalSlots;
}

/** Each stand-in for `run`'s provider, and what `.err` stored when it handed over `script`. */
const STAND_INS: [string, (src: string, script: Script, caps: string[]) => Promise<unknown>][] = [
  [
    "a scenario script",
    async (src, script, caps) =>
      stored(await scenarioState(src, { effects: { run: [script] } }, caps)),
  ],
  [
    "a scenario defaultEffect",
    async (src, script, caps) => stored(await scenarioState(src, { defaultEffect: script }, caps)),
  ],
  [
    "a reducer-test mock",
    async (src, script, caps) => stored(await reducerTestSlots(src, script, caps)),
  ],
  [
    "a replay --mock err(…)",
    async (src, script, caps) => {
      const fixed: EpisodeMockPolicy = { policy: "fixed", outcome: "err", value: script.value };
      return stored(await replaySlots(src, bootEpisode({ outcome: "ok" }), fixed, caps));
    },
  ],
  [
    "a replayed from-log effect-end",
    async (src, script, caps) =>
      stored(await replaySlots(src, bootEpisode(script), { policy: "from-log" }, caps)),
  ],
  [
    "an ssr.hydrate bootstrap's recorded effect-end",
    async (src, script, caps) =>
      stored(await replaySlots(src, hydrateEpisode(script, "failed"), { policy: "ignore" }, caps)),
  ],
];

// [what is handed over, cap, map-request, the err, the Text the real app shows]
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
    "session.write",
    `{key: "k", value: "v"}`,
    { outcome: "err", value: { message: "blocked" } },
    "blocked",
  ],
  [
    "a {message} record",
    "indexed.delete",
    `{store: "notes", key: "k"}`,
    { outcome: "err", value: { message: "locked" } },
    "locked",
  ],
];

describe("a stand-in's err on a storage-family effect is the Text the real app delivers", () => {
  it.each(ROWS)("a provider's err: %s on %s", async (_, cap, mapRequest, script, shown) => {
    expect(await realDelivers(cap, failingAtBoot(cap, mapRequest), script)).toBe(shown);
  });

  const cases = STAND_INS.flatMap(([path, deliver]) =>
    ROWS.map(
      ([what, cap, mapRequest, script, shown]) =>
        [
          `${path}: ${what} on ${cap}`,
          deliver,
          failingAtBoot(cap, mapRequest),
          script,
          shown,
        ] as const,
    ),
  );
  it.each(cases)("%s", async (_, deliver, src, script, shown) => {
    expect(await deliver(src, script, [])).toBe(shown);
  });

  // The other capabilities define their own `E`, and a stand-in writes it as the provider would return it: it reaches `.err` as written.
  const asWritten: [string, string, unknown, string[]][] = [
    [
      "an http.* err is the HttpError record it writes",
      keepsItsErr("http.get", "", `{url: "/x", decode: Decoder.None}`),
      { status: 503, message: "down", body: { _tag: "None" } },
      [],
    ],
    [
      "a custom capability's err is the record it writes",
      keepsItsErr("acme.fault", "type Fault = {code: Int}", `{id: "k"}`),
      { code: 7 },
      ["acme.fault"],
    ],
  ];
  const writtenCases = STAND_INS.flatMap(([path, deliver]) =>
    asWritten.map(
      ([what, src, value, caps]) => [`${path}: ${what}`, deliver, src, value, caps] as const,
    ),
  );
  it.each(writtenCases)("%s", async (_, deliver, src, value, caps) => {
    const script: Script = { outcome: "err", value };
    expect(await deliver(src, script, caps)).toEqual({ _tag: "Some", _0: value });
  });

  it("an episode-test with a {message} mock passes on the Text it would see live", async () => {
    const app = (await loadSource(failingAtBoot("storage.read", `{key: "k"}`))) as LiveApp;
    const result = _stdlibTest.runEpisodeTest({
      name: "mocked",
      app,
      episodes: [bootEpisode({ outcome: "err", value: "recorded" })],
      mocks: { run: { policy: "fixed", outcome: "err", value: { message: "blocked" } } },
      expect: { slotsEqual: { problem: "blocked" }, noPanics: true },
    });
    expect(result.pass, result.actual).toBe(true);
  });
});

describe("a stand-in's ok with no value is null", () => {
  const src = `
slot got : Option(Text) = Some("unset")
effect run cap=storage.read in=Unit out=Result(Option(Text), Text) map-request={key: "k"}
reducer boot   on=app.start      do= emit run()
reducer loaded on=run.ok($v, _)  do= got := $v
tile App = column(text("got"))
app OkPayload
    caps   = [storage.read]
    routes = {"/" -> App, "/404" -> App}
    init   = []`;

  it.each([
    ["a reducer-test mock", async () => (await reducerTestSlots(src, { outcome: "ok" })).got],
    [
      "a replay --mock ok(…)",
      async () =>
        (
          await replaySlots(src, bootEpisode({ outcome: "ok" }), {
            policy: "fixed",
            outcome: "ok",
            value: undefined,
          })
        ).got,
    ],
    [
      "a replayed from-log effect-end",
      async () =>
        (await replaySlots(src, bootEpisode({ outcome: "ok" }), { policy: "from-log" })).got,
    ],
    [
      "an ssr.hydrate bootstrap's recorded effect-end",
      async () =>
        (await replaySlots(src, hydrateEpisode({ outcome: "ok" }, "loaded"), { policy: "ignore" }))
          .got,
    ],
  ])("%s", async (_, got) => {
    expect(await got()).toBeNull();
  });
});

describe("a .kumiki test mock's err on a storage-family effect must be its Text", () => {
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
});
