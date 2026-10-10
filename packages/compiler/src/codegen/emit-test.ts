import {
  assertNever,
  type EffectDef,
  type Expr,
  type ReducerDef,
  type TestDef,
  type TileDef,
  type TileExpr,
} from "../ast.ts";
import type { CodegenOptions } from "../codegen.ts";
import { parseEpisodeLogText } from "../episode-log.ts";
import {
  bareNameAt,
  expectSection,
  givenSection,
  isSectionName,
  recordFieldsAt,
  recordValueAt,
} from "../test-sections.ts";
import { bindRef, type EvalCtx, fieldKey, type GenCtx, makeEvalCtx } from "./context.ts";
import { collectEmits, scanRunReducers } from "./emit-reducer.ts";
import { tileExprJs } from "./emit-tile.ts";
import { forAllGenerator, noGeneratorMessage } from "./emit-type.ts";
import { jsOfExpr } from "./expr.ts";

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
      const mocks = givenSection<"reducer-test">(t, "mocks");
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
    const mocksJsStr = t.mocks ? episodeMockJs(t.mocks, ctx) : "{}";
    const expectJs = t.expect ? episodeExpectJs(t.expect as Expr, ctx) : "{}";
    // Replaying nothing would pass every `from-log` expectation, so an unread log fails the test.
    if (t.load && !opts.readEpisodeLog) {
      const failure = {
        name: t.name,
        pass: false,
        expected: `the episodes in ${JSON.stringify(t.load)}`,
        actual:
          "no episode log was read: compile was given no readEpisodeLog, so nothing was replayed",
        diffAt: "load",
      };
      return `  {
    name: ${nameJs},
    kind: "episode-test",
    run: () => (${JSON.stringify(failure)}),
  },`;
    }
    const episodesJs =
      opts.readEpisodeLog && t.load
        ? JSON.stringify(parseEpisodeLogText(opts.readEpisodeLog(t.load)))
        : "[]";
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
    const pctx = makeEvalCtx(gen, new Set(forAll.map((f) => f.name)));
    const varsJs = forAll
      .map((f) => {
        // E0715 refuses this at check time; a caller that skipped `check` gets the code, not a stand-in.
        const g = forAllGenerator(f.type, gen);
        if ("refused" in g) throw new Error(`E0715 ${noGeneratorMessage(f.name, g.refused)}`);
        return `${fieldKey(f.name)}: ${JSON.stringify(g.desc)}`;
      })
      .join(", ");
    const binds = forAll
      .map((f) => `const ${bindRef(pctx, f.name)} = _b[${fieldKey(f.name)}];`)
      .join(" ");
    const givenSlots = givenSection<"property-test">(t, "slots");
    const initSlotsJs = givenSlots
      ? jsOfExpr(recordValueAt(givenSlots, "given.slots"), pctx)
      : "({})";
    const event = givenSection<"property-test">(t, "event");
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
    const slots = givenSection<"reducer-test">(t, "slots");
    const event = givenSection<"reducer-test">(t, "event");
    const slotsJs = slots ? jsOfExpr(recordValueAt(slots, "given.slots"), ctx) : "({})";
    const elJs = eventPayloadJs(event, ctx);
    const panic = expectSection<"reducer-test">(t, "panic");
    let expectJs: string;
    if (panic) {
      expectJs = `{ kind: "panic", message: ${jsOfExpr(panic, ctx)} }`;
    } else {
      const xs = expectSection<"reducer-test">(t, "slots");
      const xe = expectSection<"reducer-test">(t, "effects");
      const xsJs = xs ? jsOfExpr(recordValueAt(xs, "expect.slots"), ctx) : "({})";
      const effectsJs = xe ? effectListJs(xe, ctx) : "[]";
      expectJs = `{ kind: "state", slots: ${xsJs}, effects: ${effectsJs} }`;
    }
    const mocks = givenSection<"reducer-test">(t, "mocks");
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
  const slots = givenSection<"tile-test">(t, "slots");
  const slotsJs = slots ? jsOfExpr(recordValueAt(slots, "given.slots"), ctx) : "({})";
  const inField = givenSection<"tile-test">(t, "in");
  const target = gen.tiles.find((x) => x.name === t.target);
  if (target) {
    const wants = target.in ? 1 : 0;
    const got = inField ? 1 : 0;
    if (wants !== got) {
      throw new Error(
        `E0213 tile-test ${JSON.stringify(t.name)}: Tile "${target.name}" expects ${wants} argument(s) but got ${got}`,
      );
    }
  }
  const inJs = inField ? jsOfExpr(inField, ctx) : "undefined";
  const expectGen: GenCtx = { ...gen, expectedTree: true };
  const expectedJs = tileExprJs(t.expect as TileExpr, expectGen, { ...ctx, gen: expectGen });
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

function effectListJs(e: Expr, ctx: EvalCtx): string {
  if (e.kind !== "ListLit") {
    throw new Error("expect.effects must be a list of effects");
  }
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

function episodeMockJs(e: Expr, ctx: EvalCtx): string {
  const parts = recordFieldsAt(e, "mocks").map((f) => {
    const v = f.value;
    const key = fieldKey(f.name);
    if (v.kind === "Ref" && v.name === "from-log") return `${key}: { policy: "from-log" }`;
    if (v.kind === "Ref" && v.name === "ignore") return `${key}: { policy: "ignore" }`;
    if (v.kind === "Call" && (v.callee === "ok" || v.callee === "err")) {
      const value = v.args[0] ? jsOfExpr(v.args[0], ctx) : "null";
      return `${key}: { policy: "fixed", outcome: ${JSON.stringify(v.callee)}, value: ${value} }`;
    }
    throw new Error(
      `episode-test mock for "${f.name}" must be \`from-log\`, \`ignore\`, \`ok(...)\`, or \`err(...)\``,
    );
  });
  return `{ ${parts.join(", ")} }`;
}

function episodeExpectJs(e: Expr, ctx: EvalCtx): string {
  const parts: string[] = [];
  for (const f of recordFieldsAt(e, "expect")) {
    if (!isSectionName("episode-test", "expect", f.name)) {
      throw new Error(`episode-test expect has no section "${f.name}"`);
    }
    switch (f.name) {
      case "slots-equal": {
        const bare = bareNameAt(f.value, "expect.slots-equal");
        parts.push(
          bare !== undefined
            ? `slotsEqual: ${JSON.stringify(bare)}`
            : `slotsEqual: ${jsOfExpr(recordValueAt(f.value, "expect.slots-equal"), ctx)}`,
        );
        break;
      }
      case "no-panics":
        parts.push(`noPanics: ${jsOfExpr(f.value, ctx)}`);
        break;
      case "no-errors":
        parts.push(`noErrors: ${jsOfExpr(f.value, ctx)}`);
        break;
      default:
        assertNever(f.name);
    }
  }
  return `{ ${parts.join(", ")} }`;
}

function mocksJs(e: Expr, ctx: EvalCtx): string {
  const parts = recordFieldsAt(e, "given.mocks").map(
    (f) => `${fieldKey(f.name)}: ${mockScriptJs(f.value, ctx)}`,
  );
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
  throw new Error(
    "a reducer-test mock must be `ok(...)`, `err(...)`, or `delay(ms, ok(...)|err(...))`",
  );
}

function eventPayloadJs(event: Expr | undefined, ctx: EvalCtx): string {
  if (event === undefined) return "({})";
  const fields = recordFieldsAt(event, "given.event");
  const el = fields.find((f) => f.name === "el");
  if (el) return jsOfExpr(el.value, ctx);
  const rest = fields.filter((f) => f.name !== "type" && f.name !== "target");
  if (rest.length === 0) return "({})";
  return jsOfExpr({ kind: "RecordLit", fields: rest, pos: event.pos }, ctx);
}
