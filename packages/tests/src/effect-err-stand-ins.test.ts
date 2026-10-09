import { compile } from "@kumikijs/compiler";
import {
  _stdlibTest,
  type AppShape,
  type EffectResult,
  type EpisodeLogEntry,
  type EpisodeMockPolicy,
  replayEpisodes,
  runScenario,
  type Scenario,
} from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { withRoot } from "./helpers/dom.ts";
import { failingAtBoot, problemShown } from "./helpers/effect-failure.ts";
import { loadSource } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";

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
  const app = await loadSource(src, capabilities);
  const report = await withRoot((root) =>
    runScenario(app, root, {
      ...scripts,
      steps: [{ label: "boot fails", expect: { noErrors: true } }],
    }),
  );
  expect(report.ok, failureDetail(report)).toBe(true);
  return report.steps[0]?.state ?? {};
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
    // The control: the E0201 above is the payload's and not the test's shape.
    expect(testCodes(src, test(`err("blocked")`))).toEqual([]);
  });
});
