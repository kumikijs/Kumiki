import type { EffectDef, Expr, ReducerDef, TestDef, TileDef, TileExpr } from "../ast.ts";
import type { CodegenOptions } from "../codegen.ts";
import { type EvalCtx, type GenCtx, jsBinding, makeEvalCtx } from "./context.ts";
import { collectEmits, scanRunReducers } from "./emit-reducer.ts";
import { tileExprJs } from "./emit-tile.ts";
import { typeToGenDesc } from "./emit-type.ts";
import { jsOfExpr } from "./expr.ts";

function recordField(e: Expr | TileExpr, name: string): Expr | undefined {
  if ((e as Expr).kind !== "RecordLit") return undefined;
  return (e as Expr & { kind: "RecordLit" }).fields.find((f) => f.name === name)?.value;
}

/** The outcome of a mock value `ok(v)` / `err(e)` / `delay(ms, ok(v)|err(e))`. */
function mockOutcome(v: Expr): "ok" | "err" | undefined {
  if (v.kind === "Call" && (v.callee === "ok" || v.callee === "err")) return v.callee;
  if (v.kind === "Call" && v.callee === "delay") {
    const inner = v.args[1];
    if (inner?.kind === "Call" && (inner.callee === "ok" || inner.callee === "err")) {
      return inner.callee;
    }
  }
  return undefined;
}

/**
 * Static `--coverage` data (§8.7): which reducers / tiles / effects the test
 * suite exercises. A reducer-test/property-test covers its target reducer(s)
 * and the effects those reducers emit; a tile-test covers its tile; mocked
 * effects count as covered too.
 */
export function coverageJs(
  tests: TestDef[],
  reducers: ReducerDef[],
  tiles: TileDef[],
  effects: EffectDef[],
): string {
  const usedReducers = new Set<string>();
  const usedTiles = new Set<string>();
  const usedEffects = new Set<string>();
  const byName = new Map(reducers.map((r) => [r.name, r]));
  const markReducer = (name: string): void => {
    const r = byName.get(name);
    if (!r) return;
    usedReducers.add(name);
    for (const eff of collectEmits(r.do)) usedEffects.add(eff);
  };
  // A mocked effect result drives its `.ok`/`.err` reducers, so those count too.
  const markEffectReducers = (effect: string, outcome: "ok" | "err"): void => {
    for (const r of reducers) {
      if (r.on.kind === "EffectEvent" && r.on.effect === effect && r.on.outcome === outcome) {
        markReducer(r.name);
      }
    }
  };
  for (const t of tests) {
    if (t.testKind === "reducer-test") {
      if (t.target) markReducer(t.target);
      const mocks = recordField(t.given, "mocks");
      if (mocks?.kind === "RecordLit") {
        for (const f of mocks.fields) {
          usedEffects.add(f.name);
          const outcome = mockOutcome(f.value);
          if (outcome) markEffectReducers(f.name, outcome);
        }
      }
    } else if (t.testKind === "tile-test") {
      if (t.target) usedTiles.add(t.target);
    } else if (t.testKind === "property-test") {
      scanRunReducers(t.invariant, markReducer);
    } else if (t.testKind === "episode-test") {
      // episode-test replays a log: every effect mocked is one the test exercises.
      if (t.mocks?.kind === "RecordLit") {
        for (const f of t.mocks.fields) {
          usedEffects.add(f.name);
          if (f.value.kind === "Ref" && f.value.name === "from-log") {
            markEffectReducers(f.name, "ok");
            markEffectReducers(f.name, "err");
          } else {
            const outcome = mockOutcome(f.value);
            if (outcome) markEffectReducers(f.name, outcome);
          }
        }
      }
    }
  }
  const cat = (all: string[], used: Set<string>): string =>
    `{ total: ${JSON.stringify(all)}, used: ${JSON.stringify(all.filter((n) => used.has(n)))} }`;
  return `{ reducers: ${cat(
    reducers.map((r) => r.name),
    usedReducers,
  )}, tiles: ${cat(
    tiles.map((t) => t.name),
    usedTiles,
  )}, effects: ${cat(
    effects.map((e) => e.name),
    usedEffects,
  )} }`;
}

export function genTest(t: TestDef, gen: GenCtx, opts: CodegenOptions): string {
  const ctx = makeEvalCtx(gen, new Set());
  const nameJs = JSON.stringify(t.name);
  if (t.testKind === "episode-test") {
    // §8.6: load the episode log at compile time so the runtime test harness
    // never touches the filesystem. The reader is injected via CodegenOptions
    // (Node-only callers pass `nodeEpisodeLogReader`); without it we emit an
    // empty `episodes: []` — the runtime skips the replay loop, so a
    // `from-log` expect can silently pass. A separate check should refuse to
    // build an `episode-test load = "..."` when no reader is available.
    let episodesJs = "[]";
    if (opts.readEpisodeLog && t.load) {
      const raw = opts.readEpisodeLog(t.load);
      const parsed = parseEpisodeLog(raw);
      episodesJs = JSON.stringify(parsed);
    }
    const mocksJsStr = t.mocks ? episodeMockJs(t.mocks, ctx) : "{}";
    const expectJs = t.expect ? episodeExpectJs(t.expect as Expr, ctx) : "{}";
    return `  {
    name: ${nameJs},
    kind: "episode-test",
    run: () => _s.runEpisodeTest({
      name: ${nameJs},
      app: App,
      episodes: ${episodesJs},
      mocks: ${mocksJsStr},
      expect: ${expectJs},
    }),
  },`;
  }
  if (t.testKind === "property-test") {
    const forAll = t.forAll ?? [];
    // forAll var names are local binds, so invariant/given refs lower to the
    // `const <name> = _b[...]` we destructure at the top of the trial fn.
    const pctx = makeEvalCtx(gen, new Set(forAll.map((f) => f.name)));
    const varsJs = forAll
      .map(
        (f) =>
          `${JSON.stringify(f.name)}: ${JSON.stringify(typeToGenDesc(f.type, gen, new Set()))}`,
      )
      .join(", ");
    const binds = forAll
      .map((f) => `const ${jsBinding(f.name)} = _b[${JSON.stringify(f.name)}];`)
      .join(" ");
    const givenSlots = recordField(t.given, "slots");
    const initSlotsJs = givenSlots ? jsOfExpr(givenSlots, pctx) : "({})";
    const event = recordField(t.given, "event");
    const eventJs = eventPayloadJs(event, pctx);
    const invariantJs = t.invariant ? jsOfExpr(t.invariant, pctx) : "true";
    const runOpts = [
      t.count !== undefined ? `count: ${t.count}` : null,
      t.shrink !== undefined ? `shrink: ${t.shrink}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return `  {
    name: ${nameJs},
    kind: "property-test",
    run: () => _s.runPropertyTest({
      name: ${nameJs},
      vars: { ${varsJs} },
      trial: (_b) => {
        ${binds}
        const _init = { slots: ${initSlotsJs} };
        const _event = ${eventJs};
        return ${invariantJs};
      },${runOpts ? ` ${runOpts},` : ""}
    }),
  },`;
  }
  if (t.testKind === "reducer-test") {
    // A reducer-test always has an Expr `expect` (only property-test omits it).
    const expectExpr = t.expect as Expr;
    const slots = recordField(t.given, "slots");
    const event = recordField(t.given, "event");
    const slotsJs = slots ? jsOfExpr(slots, ctx) : "({})";
    const elJs = eventPayloadJs(event, ctx);
    const panic = recordField(expectExpr, "panic");
    let expectJs: string;
    if (panic) {
      expectJs = `{ kind: "panic", message: ${jsOfExpr(panic, ctx)} }`;
    } else {
      const xs = recordField(expectExpr, "slots");
      const xe = recordField(expectExpr, "effects");
      const xsJs = xs ? jsOfExpr(xs, ctx) : "({})";
      const effectsJs = xe ? effectListJs(xe, ctx) : "[]";
      expectJs = `{ kind: "state", slots: ${xsJs}, effects: ${effectsJs} }`;
    }
    // §8.5: with `given.mocks`, drive the multi-step emit→result→reducer flow
    // (effect results injected from the mocks) instead of a single reducer apply.
    const mocks = recordField(t.given, "mocks");
    if (mocks) {
      return `  {
    name: ${nameJs},
    kind: "reducer-test",
    run: () => {
      _s.resetLive(App.live, App.slots, ${slotsJs});
      const _el = ${elJs};
      return _s.runReducerTestFlow({ name: ${nameJs}, app: App, target: ${JSON.stringify(t.target)}, el: _el, mocks: ${mocksJs(mocks, ctx)}, expect: ${expectJs} });
    },
  },`;
    }
    return `  {
    name: ${nameJs},
    kind: "reducer-test",
    run: () => {
      _s.resetLive(App.live, App.slots, ${slotsJs});
      const _el = ${elJs};
      const _r = App.reducers.find((r) => r.name === ${JSON.stringify(t.target)});
      if (!_r) throw new Error("reducer ${t.target} not found");
      let _res = null, _panic = null;
      try { _res = _r.apply(App.live, { $el: _el, $event: _el }); }
      catch (e) { _panic = (e && e.message) ? e.message : String(e); }
      return _s.runReducerTest({ name: ${nameJs}, target: ${JSON.stringify(t.target)}, givenSlots: { ...App.live }, slotMetas: App.slots, result: _res, panic: _panic, expect: ${expectJs} });
    },
  },`;
  }
  // tile-test
  const slots = recordField(t.given, "slots");
  const slotsJs = slots ? jsOfExpr(slots, ctx) : "({})";
  const inField = recordField(t.given, "in");
  const inJs = inField ? jsOfExpr(inField, ctx) : "undefined";
  const expectedJs = tileExprJs(t.expect as TileExpr, gen, ctx);
  return `  {
    name: ${nameJs},
    kind: "tile-test",
    run: () => {
      _s.resetLive(App.live, App.slots, ${slotsJs});
      const _actual = App._tilesById[${JSON.stringify(t.target)}](${inJs});
      const _expected = ${expectedJs};
      return _s.runTileTest({ name: ${nameJs}, actual: _actual, expected: _expected });
    },
  },`;
}

/**
 * Compile a `[eff(a), ...]` expect.effects list into `[{effect, args, argsSpecified}]`.
 * A bare name (`persist`) matches by name only (`argsSpecified: false`); a call
 * (`persist(x)`, even `persist()`) pins the exact arguments (`argsSpecified: true`).
 */
function effectListJs(e: Expr, ctx: EvalCtx): string {
  if (e.kind !== "ListLit") return "[]";
  const items = e.items.map((it) => {
    if (it.kind === "Call") {
      const args = it.args.map((a) => jsOfExpr(a, ctx)).join(", ");
      return `{ effect: ${JSON.stringify(it.callee)}, args: [${args}], argsSpecified: true }`;
    }
    if (it.kind === "Ref") {
      return `{ effect: ${JSON.stringify(it.name)}, args: [], argsSpecified: false }`;
    }
    return `{ effect: "?", args: [], argsSpecified: false }`;
  });
  return `[${items.join(", ")}]`;
}

/**
 * Parse an episode log (one JSON Episode per line — JSONL — or a JSON array).
 * Surfaces malformed lines as a compile-time throw rather than smuggling them
 * into the generated test: a corrupted fixture means the test would lie.
 */
function parseEpisodeLog(raw: string): unknown[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed);
    if (!Array.isArray(arr)) throw new Error("episode log: JSON root must be an array");
    return arr;
  }
  const out: unknown[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    out.push(JSON.parse(s));
  }
  return out;
}

/**
 * Lower an `episode-test`'s `mocks = { effect: from-log | ignore | ok(v) | err(e) }`
 * record into the runtime call shape. `from-log` and `ignore` arrive as bare
 * identifiers (Ref nodes); `ok` / `err` carry a payload Expr that we evaluate
 * in the test's binding context.
 */
function episodeMockJs(e: Expr, ctx: EvalCtx): string {
  if (e.kind !== "RecordLit") return "{}";
  const parts = e.fields.map((f) => {
    const v = f.value;
    const key = JSON.stringify(f.name);
    if (v.kind === "Ref" && v.name === "from-log") return `${key}: { policy: "from-log" }`;
    if (v.kind === "Ref" && v.name === "ignore") return `${key}: { policy: "ignore" }`;
    if (v.kind === "Call" && (v.callee === "ok" || v.callee === "err")) {
      const value = v.args[0] ? jsOfExpr(v.args[0], ctx) : "null";
      return `${key}: { policy: "fixed", outcome: ${JSON.stringify(v.callee)}, value: ${value} }`;
    }
    // Defense-in-depth: typecheck (E0712) rejects this before we get here.
    // If a caller skips check() the loud throw beats silently treating a
    // typo'd `from_log` as `ignore` and passing the test.
    throw new Error(
      `episode-test mock for "${f.name}" must be \`from-log\`, \`ignore\`, \`ok(...)\`, or \`err(...)\``,
    );
  });
  return `{ ${parts.join(", ")} }`;
}

/**
 * Lower an `episode-test`'s `expect = { slots-equal, no-panics, no-errors }`.
 * `slots-equal` accepts either the literal `from-log` (use the log's recorded
 * final slot values) or a record of expected slot → value pairs.
 */
function episodeExpectJs(e: Expr, ctx: EvalCtx): string {
  if (e.kind !== "RecordLit") return "{}";
  const parts: string[] = [];
  for (const f of e.fields) {
    if (f.name === "slots-equal" || f.name === "slotsEqual") {
      if (f.value.kind === "Ref" && f.value.name === "from-log") {
        parts.push(`slotsEqual: "from-log"`);
      } else {
        parts.push(`slotsEqual: ${jsOfExpr(f.value, ctx)}`);
      }
    } else if (f.name === "no-panics" || f.name === "noPanics") {
      parts.push(`noPanics: ${jsOfExpr(f.value, ctx)}`);
    } else if (f.name === "no-errors" || f.name === "noErrors") {
      parts.push(`noErrors: ${jsOfExpr(f.value, ctx)}`);
    }
  }
  return `{ ${parts.join(", ")} }`;
}

function mocksJs(e: Expr, ctx: EvalCtx): string {
  if (e.kind !== "RecordLit") return "{}";
  const parts = e.fields.map((f) => `${JSON.stringify(f.name)}: ${mockScriptJs(f.value, ctx)}`);
  return `{ ${parts.join(", ")} }`;
}

function mockScriptJs(v: Expr, ctx: EvalCtx): string {
  if (v.kind === "Call" && (v.callee === "ok" || v.callee === "err")) {
    const value = v.args[0] ? jsOfExpr(v.args[0], ctx) : "null";
    return `{ outcome: ${JSON.stringify(v.callee)}, value: ${value} }`;
  }
  if (v.kind === "Call" && v.callee === "delay") {
    const ms = v.args[0] ? jsOfExpr(v.args[0], ctx) : "0";
    const inner = v.args[1];
    if (inner?.kind === "Call" && (inner.callee === "ok" || inner.callee === "err")) {
      const value = inner.args[0] ? jsOfExpr(inner.args[0], ctx) : "null";
      return `{ outcome: ${JSON.stringify(inner.callee)}, value: ${value}, delayMs: ${ms} }`;
    }
  }
  return `{ outcome: "ok", value: null }`;
}

/**
 * The reducer payload (`$el` / `$event`) for a reducer-test's `given.event`.
 * Uses `el` when present (spec §8.5), otherwise the event's other fields
 * (everything except `type` / `target`) so flat `{type, target, value}` forms
 * still reach the reducer.
 */
function eventPayloadJs(event: Expr | undefined, ctx: EvalCtx): string {
  if (event?.kind !== "RecordLit") return "({})";
  const el = event.fields.find((f) => f.name === "el");
  if (el) return jsOfExpr(el.value, ctx);
  const rest = event.fields.filter((f) => f.name !== "type" && f.name !== "target");
  if (rest.length === 0) return "({})";
  return jsOfExpr({ kind: "RecordLit", fields: rest, pos: event.pos }, ctx);
}
