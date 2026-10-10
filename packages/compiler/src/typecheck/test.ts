import {
  assertNever,
  type Expr,
  isTileExpr,
  type Pos,
  type TestDef,
  type TileExpr,
} from "../ast.ts";
import { BUILTIN_TILES } from "../builtins.ts";
import {
  bareNameAt,
  fitsRecordPosition,
  type GivenSection,
  givenSection,
  isRecordValue,
  isSectionName,
  nearestSection,
  notARecordMessage,
  type RecordPosition,
  type SectionName,
  sectionNames,
  type TestKind,
  type TestPart,
} from "../test-sections.ts";
import { checkAgainst, effectInput } from "./against.ts";
import {
  bindLocal,
  type Ctx,
  type KumikiError,
  type SymbolTable,
  wildcardText,
} from "./context.ts";
import { effectOutcomeType } from "./effect.ts";
import { checkExpr } from "./expr.ts";
import { walkExpr } from "./expr-walk.ts";
import { checkRouteSeed, isTestSlot } from "./slot.ts";
import { checkTileExpr } from "./tile.ts";
import { resolveType } from "./types.ts";

function checkWildcardsInKeys(expect: Expr, errors: KumikiError[]): void {
  const reported = new Set<Expr>();
  const refuseNested = (key: Expr): void => {
    if (key.kind === "Wildcard") return;
    walkExpr(key, (n) => {
      if (n.kind !== "Wildcard" || reported.has(n)) return;
      reported.add(n);
      errors.push({
        code: "E0109",
        kind: "test-wildcard-misuse",
        message: `Test wildcard "${wildcardText(n)}" cannot stand inside a Set member or map key: the member or key is keyed by its whole value, so a wildcard there can only be the whole member or key`,
        pos: n.pos,
      });
    });
  };
  walkExpr(expect, (n) => {
    if (n.kind === "ListLit" && n.asSet) for (const it of n.items) refuseNested(it);
    if (n.kind === "MapLit") for (const en of n.entries) refuseNested(en.key);
  });
}

export function checkTest(t: TestDef, sym: SymbolTable, errors: KumikiError[]): void {
  checkTestNames(t, sym, errors);
  walkExpr(t.given, (n) => {
    if (n.kind === "Wildcard") {
      errors.push({
        code: "E0109",
        kind: "test-wildcard-misuse",
        message: `Test wildcard "${wildcardText(n)}" is only valid inside a reducer-test \`expect\``,
        pos: n.pos,
      });
    }
  });
  if (t.testKind === "episode-test") {
    if (t.mocks?.kind === "RecordLit") {
      for (const m of t.mocks.fields) {
        if (!sym.effects.has(m.name)) {
          errors.push({
            code: "E0104",
            kind: "undef-effect",
            message: `Mock targets undefined effect "${m.name}"`,
            pos: t.mocks.pos,
          });
        }
        const v = m.value;
        const isFromLog = v.kind === "Ref" && v.name === "from-log";
        const isIgnore = v.kind === "Ref" && v.name === "ignore";
        const isOkErr = v.kind === "Call" && (v.callee === "ok" || v.callee === "err");
        if (!isFromLog && !isIgnore && !isOkErr) {
          errors.push({
            code: "E0712",
            kind: "episode-mock-invalid",
            message: `Mock for "${m.name}" must be \`from-log\`, \`ignore\`, \`ok(...)\`, or \`err(...)\``,
            pos: v.pos,
          });
        }
      }
    }
    return;
  }
  if (t.testKind === "property-test") {
    for (const f of t.forAll ?? []) resolveType(f.type, sym, errors);
    const checkRunReducer = (args: Expr[], pos: Pos): void => {
      if (args.length !== 1) {
        errors.push({
          code: "E0213",
          kind: "call-arity-mismatch",
          message: `Function "run-reducer" expects 1 argument(s) but got ${args.length}`,
          pos,
        });
        return;
      }
      const arg = args[0] as Expr;
      const rn = arg.kind === "Ref" ? arg.name : arg.kind === "Variant" ? arg.name : undefined;
      if (rn === undefined) {
        errors.push({
          code: "E0102",
          kind: "undef-reducer",
          message: "run-reducer expects a reducer name",
          pos: arg.pos,
        });
        return;
      }
      if (!sym.reducers.has(rn)) {
        errors.push({
          code: "E0102",
          kind: "undef-reducer",
          message: `Reference to undefined reducer "${rn}" in run-reducer`,
          pos: arg.pos,
        });
      }
    };
    walkExpr(t.invariant, (n) => {
      if (n.kind === "Call" && n.callee === "run-reducer") checkRunReducer(n.args, n.pos);
      if (n.kind === "MethodCall" && n.method === "run-reducer") checkRunReducer(n.args, n.pos);
    });
    return;
  }
  if (t.testKind === "reducer-test") {
    // A reducer-test `expect` is always an Expr (a tile-test's is a TileExpr).
    walkExpr(t.expect as Expr, (n) => {
      if (n.kind === "Wildcard" && n.wild === "slot" && !isTestSlot(n.slot, sym)) {
        errors.push({
          code: "E0103",
          kind: "undef-slot",
          message: `Reference to undefined slot "${n.slot}" in <slots.${n.slot}>`,
          pos: n.pos,
        });
      }
    });
    checkWildcardsInKeys(t.expect as Expr, errors);
    if (!sym.reducers.has(t.target ?? "")) {
      errors.push({
        code: "E0102",
        kind: "undef-reducer",
        message: `Reference to undefined reducer "${t.target}"`,
        pos: t.pos,
      });
    }
    const mocks = isRecordValue(t.given) ? givenSection<"reducer-test">(t, "mocks") : undefined;
    if (mocks?.kind === "RecordLit") {
      for (const m of mocks.fields) {
        if (!sym.effects.has(m.name)) {
          errors.push({
            code: "E0104",
            kind: "undef-effect",
            message: `Mock targets undefined effect "${m.name}"`,
            pos: mocks.pos,
          });
        }
      }
    }
    return;
  }
  const tileTarget = t.target ?? "";
  if (!sym.tiles.has(tileTarget)) {
    errors.push({
      code: "E0105",
      kind: "undef-tile",
      message: BUILTIN_TILES.has(tileTarget)
        ? `Tile-test target "${tileTarget}" is a built-in tile — a tile-test can only name a tile the program defines`
        : `Reference to undefined tile "${t.target}"`,
      pos: t.pos,
    });
  }
  checkTileTestInput(t, sym, errors);
  checkTileExpr(t.expect as TileExpr, sym, errors, {
    kind: "tile",
    localBinds: new Set(),
    localTypes: new Map(),
    routeBind: "no-payload",
  });
}

function checkTileTestInput(t: TestDef, sym: SymbolTable, errors: KumikiError[]): void {
  const def = sym.tiles.get(t.target ?? "");
  if (!def) return;
  const written = givenField(t, "in");
  const wants = def.in ? 1 : 0;
  const got = written ? 1 : 0;
  if (wants === got) {
    if (written && def.in) {
      checkAgainst(written.value, def.in, sym, errors, {
        kind: "test",
        localBinds: new Set(),
        localTypes: new Map(),
        routeBind: "no-payload",
        wildcardsReportedElsewhere: true,
      });
    }
    return;
  }
  if (got === 0 && hasUnreadGiven(t)) return;
  errors.push({
    code: "E0213",
    kind: "call-arity-mismatch",
    message: `Tile "${def.name}" expects ${wants} argument(s) but got ${got}`,
    pos: written?.pos ?? t.pos,
  });
}

function hasUnreadGiven(t: TestDef): boolean {
  if (!isRecordValue(t.given)) return true;
  return recordFieldsOf(t.given).some((f) => !isSectionName("tile-test", "given", f.name));
}

function givenField(
  t: TestDef,
  name: GivenSection<"tile-test">,
): { name: string; value: Expr; pos: Pos } | undefined {
  return recordFieldsOf(t.given).find((f) => f.name === name);
}

function checkTestNames(t: TestDef, sym: SymbolTable, errors: KumikiError[]): void {
  const base: Ctx = {
    kind: "test",
    localBinds: new Set(),
    localTypes: new Map(),
    routeBind: "no-payload",
  };
  for (const f of t.forAll ?? []) bindLocal(base, f.name, f.type);
  const owned: Ctx = { ...base, wildcardsReportedElsewhere: true };

  requireRecord(t.given, "given", errors);
  if (t.testKind === "reducer-test" || t.testKind === "episode-test") {
    requireRecord(t.expect, "expect", errors);
  }
  if (t.testKind === "episode-test") requireRecord(t.mocks, "mocks", errors);

  for (const f of sectionsOf(t, t.testKind, "given", errors)) {
    switch (f.section) {
      case "slots":
        if (requireRecord(f.value, "given.slots", errors)) {
          checkTestSlotMap(f.value, sym, errors, owned);
        }
        break;
      case "event":
        if (requireRecord(f.value, "given.event", errors)) {
          checkTestEvent(f.value, sym, errors, owned);
        }
        break;
      case "mocks":
        if (requireRecord(f.value, "given.mocks", errors)) {
          checkTestMockValues(f.value, sym, errors, owned);
        }
        break;
      case "in":
        checkExpr(f.value, sym, errors, owned);
        break;
      default:
        assertNever(f.section);
    }
  }
  if (t.invariant) checkExpr(t.invariant, sym, errors, { ...base, runReducerScope: true });
  if (t.testKind === "reducer-test") {
    for (const f of sectionsOf(t, "reducer-test", "expect", errors)) {
      switch (f.section) {
        case "slots":
          if (requireRecord(f.value, "expect.slots", errors)) {
            checkTestSlotMap(f.value, sym, errors, owned);
          }
          break;
        case "effects":
          checkTestEffects(f.value, sym, errors, owned);
          break;
        case "panic":
          checkExpr(f.value, sym, errors, owned);
          break;
        default:
          assertNever(f.section);
      }
    }
  }
  if (t.testKind === "episode-test") {
    for (const f of sectionsOf(t, "episode-test", "expect", errors)) {
      switch (f.section) {
        case "slots-equal":
          if (bareNameAt(f.value, "expect.slots-equal") !== undefined) break;
          if (requireRecord(f.value, "expect.slots-equal", errors)) {
            checkTestSlotMap(f.value, sym, errors, base);
          }
          break;
        case "no-panics":
        case "no-errors":
          checkExpr(f.value, sym, errors, base);
          break;
        default:
          assertNever(f.section);
      }
    }
    checkTestMockValues(t.mocks, sym, errors, base, true);
  }
  // A tile-test's `expect` is a tile expression, checked by `checkTileExpr`.
}

function sectionsOf<K extends TestKind, P extends TestPart>(
  t: TestDef,
  kind: K,
  part: P,
  errors: KumikiError[],
): { section: SectionName<K, P>; value: Expr }[] {
  const out: { section: SectionName<K, P>; value: Expr }[] = [];
  for (const f of recordFieldsOf(part === "given" ? t.given : t.expect)) {
    if (isSectionName(kind, part, f.name)) {
      out.push({ section: f.name, value: f.value });
      continue;
    }
    errors.push({
      code: "E0714",
      kind: "test-section-unknown",
      message: unknownSectionMessage(kind, part, f.name),
      pos: f.pos,
    });
  }
  return out;
}

function unknownSectionMessage(kind: TestKind, part: TestPart, written: string): string {
  const other: TestPart = part === "given" ? "expect" : "given";
  const article = /^[aeiou]/.test(kind) ? "an" : "a";
  const hint = isSectionName(kind, other, written)
    ? ` — "${written}" is ${other === "expect" ? "an" : "a"} \`${other}\` section`
    : nearestSectionHint(kind, part, written);
  return (
    `Unknown section "${written}" in ${article} ${kind} \`${part}\`${hint}` +
    ` (accepted: ${sectionNames(kind, part).join(", ")})`
  );
}

function nearestSectionHint(kind: TestKind, part: TestPart, written: string): string {
  const nearest = nearestSection(kind, part, written);
  return nearest === undefined ? "" : ` — did you mean "${nearest}"?`;
}

function requireRecord(
  value: Expr | TileExpr | undefined,
  position: RecordPosition,
  errors: KumikiError[],
): boolean {
  if (value === undefined || fitsRecordPosition(value, position)) return true;
  errors.push({
    code: "E0713",
    kind: "test-shape-invalid",
    message: notARecordMessage(position),
    pos: value.pos,
  });
  return false;
}

/** The fields of `e` when it is a record literal, and none when it is not. */
function recordFieldsOf(e: Expr | TileExpr | undefined): { name: string; value: Expr; pos: Pos }[] {
  if (e === undefined || isTileExpr(e) || e.kind !== "RecordLit") return [];
  return e.fields;
}

function checkTestSlotMap(rec: Expr, sym: SymbolTable, errors: KumikiError[], ctx: Ctx): void {
  for (const f of recordFieldsOf(rec)) {
    if (!isTestSlot(f.name, sym)) {
      errors.push({
        code: "E0103",
        kind: "undef-slot",
        message: `Reference to undefined slot "${f.name}"`,
        pos: f.pos,
      });
    } else if (!sym.slots.has(f.name)) {
      checkRouteSeed(f.value, errors);
    }
    checkExpr(f.value, sym, errors, ctx);
    const slot = sym.slots.get(f.name);
    if (slot) checkAgainst(f.value, slot.type, sym, errors, ctx);
  }
}

function checkTestEvent(event: Expr, sym: SymbolTable, errors: KumikiError[], ctx: Ctx): void {
  const uiEvent = isUiEventType(recordFieldsOf(event).find((f) => f.name === "type")?.value);
  for (const f of recordFieldsOf(event)) {
    if (f.name === "type") continue;
    if (f.name === "target") {
      const target = f.value;
      const name =
        target.kind === "Variant" ? target.name : target.kind === "Ref" ? target.name : undefined;
      if (uiEvent && name !== undefined && !BUILTIN_TILES.has(name) && !sym.tiles.has(name)) {
        errors.push({
          code: "E0105",
          kind: "undef-tile",
          message: `Reference to undefined tile "${name}"`,
          pos: target.pos,
        });
      }
      continue;
    }
    checkExpr(f.value, sym, errors, ctx);
  }
}

/** Whether `given.event.type` names a `ui.*` trigger — the ones aimed at a tile. */
function isUiEventType(type: Expr | undefined): boolean {
  if (type === undefined) return false;
  // `ui.click` parses as a field read on the name `ui`.
  if (type.kind === "FieldAccess") return type.base.kind === "Ref" && type.base.name === "ui";
  return false;
}

/** `[persist(x), other]` — the effects a reducer-test expects to have been emitted. */
function checkTestEffects(list: Expr, sym: SymbolTable, errors: KumikiError[], ctx: Ctx): void {
  if (list.kind !== "ListLit") {
    errors.push({
      code: "E0713",
      kind: "test-shape-invalid",
      message: "`expect.effects` must be a list of effects",
      pos: list.pos,
    });
    return;
  }
  for (const item of list.items) {
    const name = item.kind === "Call" ? item.callee : item.kind === "Ref" ? item.name : undefined;
    if (name === undefined) continue;
    const input = effectInput(name, sym);
    if (!input) {
      errors.push({
        code: "E0104",
        kind: "undef-effect",
        message: `Reference to undefined effect "${name}"`,
        pos: item.pos,
      });
    }
    if (item.kind !== "Call") continue;
    for (const a of item.args) checkExpr(a, sym, errors, ctx);
    const arg = item.args[0];
    if (input && arg && item.args.length === 1) {
      checkAgainst(arg, input.inType, sym, errors, ctx, "E0201", input.omittable);
    }
  }
}

function checkTestMockValues(
  rec: Expr | undefined,
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
  episode = false,
): void {
  const checkOutcome = (effect: string, call: Expr & { kind: "Call" }): void => {
    for (const a of call.args) checkExpr(a, sym, errors, ctx);
    const payload = call.args[0];
    const outcome = call.callee === "ok" ? "ok" : "err";
    if (payload) checkAgainst(payload, effectOutcomeType(effect, outcome, sym), sym, errors, ctx);
  };
  for (const f of recordFieldsOf(rec)) {
    const v = f.value;
    if (episode && v.kind === "Ref" && (v.name === "from-log" || v.name === "ignore")) continue;
    const outcome = v.kind === "Call" && (v.callee === "ok" || v.callee === "err") ? v : undefined;
    if (outcome) {
      checkOutcome(f.name, outcome);
      continue;
    }
    if (v.kind === "Call" && v.callee === "delay" && !episode) {
      const [ms, inner] = v.args;
      if (ms) checkExpr(ms, sym, errors, ctx);
      if (inner?.kind === "Call" && (inner.callee === "ok" || inner.callee === "err")) {
        checkOutcome(f.name, inner);
        continue;
      }
    }
    // An `episode-test`'s mocks have their own diagnostic, one section up.
    if (episode) continue;
    errors.push({
      code: "E0713",
      kind: "test-shape-invalid",
      message: `Mock for "${f.name}" must be \`ok(...)\`, \`err(...)\`, or \`delay(ms, ok(...)|err(...))\``,
      pos: v.pos,
    });
  }
}
