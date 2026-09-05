import {
  assignable,
  constructorArity,
  elementType,
  isKnownTypeName,
  isOpaque,
  paramSubstitution,
  recordFieldType,
  substituteType,
  typeToString,
  unaliasType,
  unknownType,
} from "./assignable.ts";
import type {
  AppDef,
  EffectDef,
  Expr,
  FnDef,
  Lvalue,
  Pattern,
  Pos,
  Program,
  ReducerDef,
  SlotDef,
  Statement,
  TestDef,
  TileDef,
  TileExpr,
  TypeDef,
  TypeExpr,
} from "./ast.ts";
import { assertNever, isTileExpr } from "./ast.ts";
import {
  type BuiltinArity,
  builtinArity,
  CONSTANT_NAMESPACES,
  isQualifierName,
  QUALIFIED_BUILTIN_CALLS,
  TYPE_MEMBER_CALLS,
  UNIMPLEMENTED_CALLS,
} from "./builtin-calls.ts";
import { BUILTIN_TILES } from "./builtins.ts";
import { BUILTIN_EFFECT_CAPS, STANDARD_CAPABILITIES } from "./capabilities.ts";
import {
  FIELD_ACCESS_SHORTCUTS,
  KNOWN_MEMBERS,
  KNOWN_METHODS,
  METHOD_MIN_ARGS,
  NUMERIC_MEMBERS,
} from "./codegen.ts";
import { boundaryTarget, expansionTargets, findCycles, type GraphEdge } from "./def-graph.ts";
import { buildDefIndex, type DefIndex, referencesIn } from "./references.ts";
import { RESERVED_BIND_NAMES } from "./reserved-binds.ts";
import { isPrimTypeName, STDLIB_TYPES } from "./stdlib-types.ts";
// One handler-name set for the whole compiler. A local copy here had drifted
// from the lifted set — it was missing `onKeyDown` and `onMouseEnter`, so
// `input(onKeyDown=bump)` compiled to a working listener but was reported as
// an undefined reference. `test/ui-lifts.test.ts` exercises every entry of
// this set through the checker, so a second copy cannot drift unnoticed again.
import {
  HANDLER_NAMES,
  HANDLER_PROP_TILES,
  handlerReducerName,
  UI_EVENT_TILE_KINDS,
} from "./ui-lifts.ts";
import {
  describeDuplicate,
  duplicateSubRoutes,
  findDuplicateDefinitions,
  findDuplicateNames,
} from "./uniqueness.ts";

export type KumikiError = {
  code: string;
  kind: string;
  message: string;
  pos: Pos;
  /**
   * Diagnostic severity. Omitted → "error" (default), failing `compile()` and
   * `kumiki check`. `"warning"` is non-fatal: still surfaced to stderr (CLI) /
   * Rollup `this.warn` (Vite), but does not change the exit code. See
   * `docs/spec/errors.md` for the W02xx band.
   */
  severity?: "error" | "warning";
};

/**
 * The accessibility band, which `--strict-a11y` turns on. Exported so a caller
 * that wants "did this fail a11y?" asks the same set the filter uses, rather
 * than matching the `E07` prefix — that prefix also covers strict-icons and the
 * testing-DSL invariants.
 */
export const A11Y_CODES = new Set(["E0701", "E0702", "E0703", "E0705"]);

// `UI_EVENT_TILE_KINDS` is the W0212 gate, derived from the shared
// `UI_LIFTS` table in `ui-lifts.ts` so codegen's handler-emission gate and
// the typecheck-time warning stay in lockstep. `null` = "any tile is
// allowed" (hover, wired by the universal `applyUiEventHandlers`).
// The per-row rationale (including why `link` is omitted from `click`)
// lives next to the table itself in `ui-lifts.ts`.

/**
 * Diagnostic codes filtered out of `check()`'s output unless `strictIcons` is
 * on. The runtime placeholder (spec §4.8.3) stays fail-soft for smoke-driven
 * authoring; opt in via `kumiki check --strict-icons` or
 * `compile({ strictIcons: true })` to surface them.
 */
const STRICT_ICONS_CODES = new Set(["E0704"]);

/**
 * Diagnostic codes filtered out of `check()`'s output unless `strictSelectorId`
 * is on. The runtime `_dispatch` filter (packages/runtime/src/core.ts) is the
 * authority for id-scoped selectors and defensively drops mismatches; E0212
 * lifts a subset of those silent drops — the ones provably unreachable at
 * compile time — into a check-time diagnostic. Opt in via
 * `kumiki check --strict-selector-id` or `compile({ strictSelectorId: true })`.
 * Kept off by default so the PR #148 runtime-filter regression test
 * (`packages/tests/selector-id.test.ts`, which uses a deliberate literal
 * mismatch to prove the filter fires) still compiles cleanly.
 */
const STRICT_SELECTOR_ID_CODES = new Set(["E0212"]);

/**
 * Returns errors with a11y / strict-icons warnings filtered out (unless their
 * respective `strict*` opt-ins are on). `capabilities` lists project-registered
 * capabilities (from a `kumiki.caps.json` manifest) that are accepted in
 * `app.caps` in addition to the standard set. `iconNames` is the closed name
 * set from `@kumikijs/icons` (Vite plugin / CLI passes `Object.keys(ALL_ICONS)`);
 * with `strictIcons: true`, any literal `icon(name="<x>")` whose name is in
 * neither `iconNames` nor a `theme.icons` block becomes an `E0704`.
 *
 * `requireApp` (default `true`) decides whether a program with no `app`
 * definition is an error. It is the difference between the two questions a
 * checker answers: "is every definition well-formed?" and "is this a complete
 * application?" Only the AI-editing verbs ask the first one — a program is
 * legitimately app-less between `kumiki add` calls — so they opt out. Every
 * other caller wants the second, which is why the default is on. It does not
 * cover `E0004`: one app too many is wrong at every point in an edit, unlike
 * one too few.
 */
export function check(
  program: Program,
  opts?: {
    strictA11y?: boolean;
    strictIcons?: boolean;
    strictSelectorId?: boolean;
    iconNames?: Iterable<string>;
    capabilities?: string[];
    requireApp?: boolean;
  },
): KumikiError[] {
  const iconDomain = new Set<string>(opts?.iconNames ?? []);
  for (const def of program.defs) {
    if (def.kind !== "ThemeDef") continue;
    const icons = def.body.icons;
    if (icons && typeof icons === "object" && !Array.isArray(icons)) {
      for (const key of Object.keys(icons)) iconDomain.add(key);
    }
  }
  const errors = checkAll(program, new Set(opts?.capabilities ?? []), iconDomain);
  const apps = program.defs.filter((d): d is AppDef => d.kind === "AppDef");
  if (opts?.requireApp !== false && apps.length === 0) {
    // Appended, not prepended: consumers that read the first diagnostic to
    // classify a file (`kumiki fix`) learn more from the one that names a
    // definition than from the one that names the whole program. The position
    // is the top of the file because what is missing has no token.
    errors.push({
      code: "E0003",
      kind: "missing-app",
      message: "Program has no app definition",
      pos: { line: 1, col: 1 },
    });
  }
  // Not gated by `requireApp`. An app-less program is incomplete, which is a
  // legitimate state mid-edit; a second app is wrong in any state, because
  // codegen takes the first and drops the rest — routes and all — without
  // saying so.
  for (const extra of apps.slice(1)) {
    errors.push({
      code: "E0004",
      kind: "duplicate-app",
      message: `Program declares more than one app definition ("${extra.name}")`,
      pos: extra.pos,
    });
  }
  return errors.filter((e) => {
    if (A11Y_CODES.has(e.code) && !opts?.strictA11y) return false;
    if (STRICT_ICONS_CODES.has(e.code) && !opts?.strictIcons) return false;
    if (STRICT_SELECTOR_ID_CODES.has(e.code) && !opts?.strictSelectorId) return false;
    return true;
  });
}

type SymbolTable = {
  types: Map<string, TypeDef>;
  slots: Map<string, SlotDef>;
  reducers: Map<string, ReducerDef>;
  tiles: Map<string, TileDef>;
  fns: Map<string, FnDef>;
  effects: Map<string, EffectDef>;
  /** Names declared by `timer(d, name=N)` triggers — the `stop-timer` namespace. */
  timerNames: Set<string>;
  /**
   * Reducers a `link {prefetch: R}` names (routing.md §3.8). The prefetch fires
   * its target with the same binding as `route.enter`, so `$route` is in scope
   * *on that path*.
   */
  prefetchTargets: Set<string>;
  /** Names declared by `motion N = {…}` — the `motion` prop namespace. */
  motions: Set<string>;
  /** Names declared by `theme N = {…}` — the `app.theme` namespace. */
  themes: Set<string>;
  /**
   * Closed icon-name domain for `--strict-icons`: union of the
   * `@kumikijs/icons` registry passed by the toolchain and every key seen
   * in any `theme.icons` block in the program. Always populated; `E0704`
   * emission is gated by the strictIcons opt-in in `check()`.
   */
  iconDomain: Set<string>;
  /**
   * Every id a tile in this program declares literally — `{id: "x"}` or
   * `id="x"`. It is what a `label {for: …}` has to name to associate with a
   * control (`E0705`). Ids computed at runtime are not in it and cannot be:
   * see `collectElementIds`.
   */
  elementIds: Set<string>;
  app?: AppDef;
};

function checkAll(
  program: Program,
  registeredCaps: Set<string>,
  iconDomain: Set<string>,
): KumikiError[] {
  const errors: KumikiError[] = [];
  const sym: SymbolTable = {
    // Seeded before the program's own definitions, so `type Route = …` in a
    // program shadows the standard-library one rather than colliding with it.
    types: new Map(STDLIB_TYPES.map((t) => [t.name, t])),
    slots: new Map(),
    reducers: new Map(),
    tiles: new Map(),
    fns: new Map(),
    effects: new Map(),
    timerNames: new Set(),
    prefetchTargets: new Set(),
    motions: new Set(),
    themes: new Set(),
    iconDomain,
    elementIds: new Set(),
  };

  for (const def of program.defs) {
    switch (def.kind) {
      case "TypeDef":
        sym.types.set(def.name, def);
        break;
      case "SlotDef":
        sym.slots.set(def.name, def);
        break;
      case "ReducerDef":
        sym.reducers.set(def.name, def);
        if (def.on.kind === "TimerEvent" && def.on.name !== undefined) {
          if (sym.timerNames.has(def.on.name)) {
            errors.push({
              code: "E0002",
              kind: "duplicate-timer-name",
              message: `Timer name "${def.on.name}" is declared more than once`,
              pos: def.on.pos,
            });
          } else {
            sym.timerNames.add(def.on.name);
          }
        }
        break;
      case "TileDef":
        sym.tiles.set(def.name, def);
        break;
      case "FnDef":
        sym.fns.set(def.name, def);
        break;
      case "EffectDef":
        sym.effects.set(def.name, def);
        break;
      case "MotionDef":
        sym.motions.add(def.name);
        break;
      case "ThemeDef":
        sym.themes.add(def.name);
        break;
      case "AppDef":
        sym.app = def;
        break;
    }
  }

  // Collected across the whole program before any definition is checked: the
  // tile that prefetches a reducer may be written below it.
  for (const def of program.defs) {
    if (def.kind === "TileDef") collectPrefetchTargets(def.body, sym.prefetchTargets);
    if (def.kind === "TileDef") collectElementIds(def.body, sym.elementIds);
  }

  const index = buildDefIndex(program);
  for (const def of program.defs) {
    if (def.kind === "TypeDef") checkTypeDef(def, sym, errors);
    if (def.kind === "SlotDef") checkSlot(def, sym, errors, index);
    if (def.kind === "TileDef") checkTile(def, sym, errors);
    if (def.kind === "ReducerDef") checkReducer(def, sym, errors);
    if (def.kind === "FnDef") checkFn(def, sym, errors);
    if (def.kind === "EffectDef") checkEffect(def, sym, errors);
    if (def.kind === "AppDef") checkApp(def, sym, errors, registeredCaps);
    if (def.kind === "MotionDef") checkMotion(def, errors);
    if (def.kind === "TestDef") checkTest(def, sym, errors);
  }
  checkCycles(program, sym, index, errors);
  checkDuplicateNames(program, errors);

  return errors;
}

/** A definition declared twice (`E0007`), and a name written twice (`E0008`). */
function checkDuplicateNames(program: Program, errors: KumikiError[]): void {
  for (const d of findDuplicateDefinitions(program)) {
    errors.push({
      code: "E0007",
      kind: "duplicate-definition",
      message: `${d.layer} "${d.name}" is declared more than once; only one of the two declarations takes effect`,
      pos: d.pos,
    });
  }
  for (const d of findDuplicateNames(program))
    errors.push({ code: "E0008", ...describeDuplicate(d) });
}

/**
 * A tile that expands into itself and a `fn` that calls itself.
 *
 * The two are checked together because the question is the same one — does the
 * definition graph close a loop — and only the edges differ. Slots are absent:
 * an initializer may not read another slot at all (`E0304`), which leaves a
 * slot loop unreachable.
 */
function checkCycles(
  program: Program,
  sym: SymbolTable,
  index: DefIndex,
  errors: KumikiError[],
): void {
  const tiles = program.defs.filter((d): d is TileDef => d.kind === "TileDef");
  const tileEdges = (name: string): readonly GraphEdge[] => {
    const def = sym.tiles.get(name);
    if (!def) return [];
    const boundary = boundaryTarget(def);
    const targets = boundary
      ? [...expansionTargets(def.body), boundary]
      : expansionTargets(def.body);
    // Builtins terminate — they have no body to expand — so only names that
    // resolve to a declared tile are edges.
    return targets.filter((e) => sym.tiles.has(e.to));
  };
  for (const cycle of findCycles(
    tiles.map((t) => t.name),
    tileEdges,
  )) {
    errors.push({
      code: "E0005",
      kind: "tile-cycle",
      message: `Tile "${cycle.path[0]}" expands into itself (${cycle.path.join(" → ")})`,
      pos: cycle.pos,
    });
  }

  const fns = program.defs.filter((d): d is FnDef => d.kind === "FnDef");
  const fnEdges = (name: string): readonly GraphEdge[] => {
    const def = sym.fns.get(name);
    if (!def) return [];
    return referencesIn(def, index)
      .filter((r) => r.layer === "fn")
      .map((r) => ({ to: r.name, pos: r.pos ?? def.pos }));
  };
  for (const cycle of findCycles(
    fns.map((f) => f.name),
    fnEdges,
  )) {
    errors.push({
      code: "E0006",
      kind: "fn-cycle",
      message: `fn "${cycle.path[0]}" calls itself (${cycle.path.join(" → ")})`,
      pos: cycle.pos,
    });
  }
}

// ----- motion layer -----

const MOTION_KEYFRAME_PROPS = new Set(["opacity", "translate-x", "translate-y", "scale", "rotate"]);
const MOTION_EASINGS = new Set(["linear", "ease", "ease-in", "ease-out", "ease-in-out"]);
const MOTION_DURATION_TOKENS = new Set(["fast", "normal", "slow"]);
const MOTION_DIRECTIONS = new Set(["normal", "reverse", "alternate", "alternate-reverse"]);
const MOTION_TIMING_KEYS = new Set(["duration", "easing", "iteration", "direction"]);

/** `duration` (ms) and `iteration` are spec'd as positive integers (no 0 / negative / float). */
const isPositiveInt = (v: unknown): boolean =>
  typeof v === "number" && Number.isInteger(v) && v > 0;

type MotionBody = { [k: string]: import("./ast.ts").ThemeValue };

/**
 * Validate a `motion` definition against the closed grammar (ADR-001). Purity
 * (no slots/effects) is already guaranteed by the parser — the body is a literal
 * record — so this only enforces the closed property + timing vocabularies.
 */
function checkMotion(def: import("./ast.ts").MotionDef, errors: KumikiError[]): void {
  const body = def.body as MotionBody;
  const keyframes = body.keyframes;
  if (typeof keyframes !== "object" || Array.isArray(keyframes)) {
    errors.push({
      code: "E0403",
      kind: "motion-malformed",
      message: `motion "${def.name}" must declare a "keyframes" record`,
      pos: def.pos,
    });
    return;
  }
  const stops = keyframes as MotionBody;
  for (const required of ["from", "to"]) {
    const stop = stops[required];
    if (typeof stop !== "object" || Array.isArray(stop)) {
      errors.push({
        code: "E0403",
        kind: "motion-malformed",
        message: `motion "${def.name}" keyframes must include a "${required}" record`,
        pos: def.pos,
      });
      return;
    }
  }
  for (const stopName of Object.keys(stops)) {
    if (stopName !== "from" && stopName !== "to") {
      errors.push({
        code: "E0403",
        kind: "motion-malformed",
        message: `motion "${def.name}" keyframes support only "from" / "to" (got "${stopName}")`,
        pos: def.pos,
      });
      continue;
    }
    const stop = stops[stopName] as MotionBody;
    for (const [prop, val] of Object.entries(stop)) {
      if (!MOTION_KEYFRAME_PROPS.has(prop)) {
        errors.push({
          code: "E0401",
          kind: "motion-unknown-property",
          message: `motion "${def.name}": unknown keyframe property "${prop}" (allowed: ${[...MOTION_KEYFRAME_PROPS].join(", ")})`,
          pos: def.pos,
        });
      } else if (typeof val !== "number") {
        errors.push({
          code: "E0401",
          kind: "motion-unknown-property",
          message: `motion "${def.name}": keyframe property "${prop}" must be a number`,
          pos: def.pos,
        });
      }
    }
  }
  // Timing fields (all optional; values must be in the closed sets).
  for (const key of Object.keys(body)) {
    if (key === "keyframes") continue;
    if (!MOTION_TIMING_KEYS.has(key)) {
      errors.push({
        code: "E0402",
        kind: "motion-invalid-timing",
        message: `motion "${def.name}": unknown field "${key}" (allowed: keyframes, ${[...MOTION_TIMING_KEYS].join(", ")})`,
        pos: def.pos,
      });
    }
  }
  const dur = body.duration;
  if (dur !== undefined && !(isPositiveInt(dur) || MOTION_DURATION_TOKENS.has(String(dur)))) {
    errors.push({
      code: "E0402",
      kind: "motion-invalid-timing",
      message: `motion "${def.name}": duration must be a positive Int (ms) or one of fast/normal/slow`,
      pos: def.pos,
    });
  }
  const eas = body.easing;
  if (eas !== undefined && !MOTION_EASINGS.has(String(eas))) {
    errors.push({
      code: "E0402",
      kind: "motion-invalid-timing",
      message: `motion "${def.name}": easing must be one of ${[...MOTION_EASINGS].join(", ")}`,
      pos: def.pos,
    });
  }
  const iter = body.iteration;
  if (iter !== undefined && !(isPositiveInt(iter) || iter === "infinite")) {
    errors.push({
      code: "E0402",
      kind: "motion-invalid-timing",
      message: `motion "${def.name}": iteration must be a positive Int or "infinite"`,
      pos: def.pos,
    });
  }
  const dir = body.direction;
  if (dir !== undefined && !MOTION_DIRECTIONS.has(String(dir))) {
    errors.push({
      code: "E0402",
      kind: "motion-invalid-timing",
      message: `motion "${def.name}": direction must be one of ${[...MOTION_DIRECTIONS].join(", ")}`,
      pos: def.pos,
    });
  }
}

/**
 * Names codegen resolves before it ever consults the slot table, so a slot
 * declared with one of them is unreachable. Only `route` reaches this check:
 * the lexer's keyword set already rejects `now`, `self` and the rest before
 * the parser can build a SlotDef out of them, and `route` is the one such name
 * that is a plain identifier (docs/spec/routing.md §3.2).
 */
const RESERVED_SLOT_NAMES: ReadonlyMap<string, string> = new Map([
  ["route", "the router-maintained route slot"],
]);

/**
 * A name a test's `given.slots` / `expect.slots` may carry: one the program
 * declared, or a reserved one the runtime maintains and the harness seeds with
 * the same empty route `mount` uses, completing a partial one. No program can
 * declare a reserved name, so without this a test naming `route` is an
 * undefined slot — and the reducer reading it has no writable test at all.
 */
function isTestSlot(name: string, sym: SymbolTable): boolean {
  return sym.slots.has(name) || RESERVED_SLOT_NAMES.has(name);
}

/**
 * The fields of the `route` slot (routing.md §3.2). A test may name any subset
 * of them; anything else is a typo the harness would drop silently, leaving a
 * green test that exercised the branch it meant to avoid. Checked here rather
 * than at runtime so the report names the source position.
 *
 * Kept in step with the runtime's `emptyRoute` by a test in `@kumikijs/tests`.
 */
export const ROUTE_SLOT_FIELDS: ReadonlySet<string> = new Set([
  "path",
  "pattern",
  "params",
  "query",
  "hash",
]);

/** Report a `route` seed that is not a record of route fields. */
function checkRouteSeed(value: Expr, errors: KumikiError[]): void {
  if (value.kind !== "RecordLit") {
    errors.push({
      code: "E0201",
      kind: "type-mismatch",
      message:
        `The "route" slot takes a record of ` +
        `${[...ROUTE_SLOT_FIELDS].map((f) => `"${f}"`).join(" / ")}, ` +
        "naming as many of them as the test needs",
      pos: value.pos,
    });
    return;
  }
  for (const f of value.fields) {
    if (ROUTE_SLOT_FIELDS.has(f.name)) continue;
    errors.push({
      code: "E0108",
      kind: "undef-member",
      message:
        `The "route" slot has no field "${f.name}" ` +
        `(${[...ROUTE_SLOT_FIELDS].map((x) => `"${x}"`).join(" / ")})`,
      pos: f.pos,
    });
  }
}

function checkSlot(slot: SlotDef, sym: SymbolTable, errors: KumikiError[], index: DefIndex): void {
  const reserved = RESERVED_SLOT_NAMES.get(slot.name);
  if (reserved !== undefined) {
    errors.push({
      code: "E0115",
      kind: "reserved-slot-name",
      message: `Slot "${slot.name}" collides with ${reserved}; reads of it never see this slot`,
      pos: slot.pos,
    });
  }
  resolveType(slot.type, sym, errors);
  // Derived slots are prohibited (language.md §1.4.2 inv. 4), and the lowering
  // agrees: a slot read is emitted as a lookup in the live-value table, which
  // is built after the slot table — so an initializer that reads a slot throws
  // on mount whichever order the two are declared in.
  for (const ref of referencesIn(slot, index)) {
    if (ref.layer !== "slot") continue;
    errors.push({
      code: "E0304",
      kind: "derived-slot",
      message: `Slot "${slot.name}" reads slot "${ref.name}" in its initial value; derived slots are prohibited — compute it in a fn instead`,
      pos: ref.pos ?? slot.pos,
    });
  }
  const ctx: Ctx = {
    kind: "slot-init",
    localBinds: new Set(),
    localTypes: new Map(),
    routeBind: "no-payload",
  };
  checkExpr(slot.init, sym, errors, ctx);
  checkAgainst(slot.init, slot.type, sym, errors, ctx);
}

function checkTile(tile: TileDef, sym: SymbolTable, errors: KumikiError[]): void {
  const ctx: Ctx = {
    kind: "tile",
    localBinds: new Set(),
    localTypes: new Map(),
    routeBind: "no-payload",
  };
  if (tile.in) {
    resolveType(tile.in, sym, errors);
    ctx.localBinds.add("$1");
    ctx.localTypes.set("$1", tile.in);
  }
  checkTileExpr(tile.body, sym, errors, ctx);
  // `error-boundary` is a tile reference like any other, and was the only one
  // nothing resolved: the lowering skipped a name it could not find and
  // produced an unprotected tile with no diagnostic, so a misspelling cost the
  // boundary and said nothing until something panicked.
  if (tile.errorBoundary !== undefined && !sym.tiles.has(tile.errorBoundary)) {
    errors.push({
      code: "E0105",
      kind: "undef-tile",
      message: `Tile "${tile.name}" declares error-boundary "${tile.errorBoundary}", which is not a tile`,
      pos: tile.errorBoundaryPos ?? tile.pos,
    });
  }
  if (tile.subRoutes) checkSubRoutes(tile, sym, errors);
}

/**
 * A route entry applies the tile it names, and is the only application that
 * cannot pass anything: the route table lowers to `tile: () => …`
 * (`codegen.ts`), so a target that declares `in=` leaves `$1` unbound and the
 * mount dies with `_d_1 is not defined` — `check` and `build` both say ok and
 * the app renders nothing at all.
 *
 * There is no argument to give it. The route state a target would want needs
 * none: every tile reads the standard `route` slot (routing.md §3.2).
 *
 * `where` names the entry — a route or a sub-route, which is what
 * `route-outlet` renders — so the two positions read as one rule. A redirect
 * is not an entry either caller brings here: it names a path, and both skip it
 * before the target is looked up.
 */
function checkRouteTargetArity(
  entry: { path: string; tile: string; tilePos?: Pos; pathPos: Pos },
  where: string,
  sym: SymbolTable,
  errors: KumikiError[],
): void {
  // An undefined target has no `in=` to disagree with, and its report is
  // E0105's — one mistake named twice reads as two.
  const target = sym.tiles.get(entry.tile);
  if (!target?.in) return;
  errors.push({
    code: "E0213",
    kind: "call-arity-mismatch",
    message: `${where} targets tile "${entry.tile}", which expects 1 argument(s) — a route target is rendered with none`,
    pos: entry.tilePos ?? entry.pathPos,
  });
}

function checkSubRoutes(tile: TileDef, sym: SymbolTable, errors: KumikiError[]): void {
  const subRoutes = tile.subRoutes;
  if (!subRoutes) return;
  // What a sub-route entry has to answer for: that its target exists, and that
  // it takes no argument. One loop, so the redirect skip that guards the first
  // question is the one that guards the second — two loops over the same array
  // invite a merge that puts the second question behind the wrong guard.
  for (const sr of subRoutes) {
    if (sr.tile.startsWith(">>")) continue; // a redirect names a path, not a tile
    const where = `Sub-route "${sr.path}" in tile "${tile.name}"`;
    if (!sym.tiles.has(sr.tile)) {
      errors.push({
        code: "E0105",
        kind: "undef-tile",
        message: `${where} targets undefined tile "${sr.tile}"`,
        pos: tile.pos,
      });
    }
    checkRouteTargetArity(sr, where, sym, errors);
  }
  // Duplicate sub-route paths within the same tile. `E0112` rather than
  // `E0008` because it came first and a code's meaning is permanent — but the
  // rule behind it is the shared one, so the position is the offending entry
  // rather than the tile that contains it.
  for (const dup of duplicateSubRoutes(subRoutes)) {
    errors.push({
      code: "E0112",
      kind: "duplicate-sub-route",
      message: `Sub-route path "${dup.name}" is declared more than once in tile "${tile.name}"`,
      pos: dup.pos,
    });
  }
  // Parent pattern must be a wildcard ("/foo/*"); otherwise sub-routes can
  // never match because the runtime only looks them up after the parent
  // wildcard matches the path. If the tile isn't a route target at all,
  // emit `orphan-sub-routes` instead.
  const app = sym.app;
  if (!app) return;
  const parents = app.routes.filter((r) => !r.tile.startsWith(">>") && r.tile === tile.name);
  if (parents.length === 0) {
    errors.push({
      code: "E0111",
      kind: "orphan-sub-routes",
      message: `Tile "${tile.name}" declares sub-routes but is not the target of any route in app.routes`,
      pos: tile.pos,
    });
    return;
  }
  for (const parent of parents) {
    if (!parent.path.endsWith("/*")) {
      errors.push({
        code: "E0114",
        kind: "sub-routes-without-wildcard-parent",
        message: `Tile "${tile.name}" declares sub-routes but its parent route "${parent.path}" is not a wildcard pattern (must end with "/*")`,
        pos: tile.pos,
      });
    }
  }
  // The matched child can only render if the parent's body actually contains
  // a `route-outlet`. Without one, sub-routes compile but silently render
  // nothing — exactly the "compiles but does nothing" failure mode Kumiki
  // refuses to ship. Catch it at the type check.
  if (!tileBodyUsesRouteOutlet(tile.body)) {
    errors.push({
      code: "E0113",
      kind: "sub-routes-without-outlet",
      message: `Tile "${tile.name}" declares sub-routes but its body never calls "route-outlet" — the matched child would have nowhere to render`,
      pos: tile.pos,
    });
  }
}

/** True if any sub-tree of the tile body is a `route-outlet` call. */
function tileBodyUsesRouteOutlet(t: TileExpr): boolean {
  switch (t.kind) {
    case "TileCall": {
      if (t.name === "route-outlet") return true;
      for (const arg of t.args) {
        const v = arg.value as TileExpr;
        if (
          v.kind === "TileCall" ||
          v.kind === "TileFor" ||
          v.kind === "TileWhen" ||
          v.kind === "TileIf" ||
          v.kind === "TileMatch"
        ) {
          if (tileBodyUsesRouteOutlet(v)) return true;
        }
      }
      return false;
    }
    case "TileFor":
    case "TileWhen":
      return tileBodyUsesRouteOutlet(t.body);
    case "TileIf":
      return tileBodyUsesRouteOutlet(t.consequent) || tileBodyUsesRouteOutlet(t.alternate);
    case "TileMatch":
      return t.arms.some((arm) => tileBodyUsesRouteOutlet(arm.body));
  }
}

type Ctx = {
  /**
   * Which position the expression is written in. Not decoration: it decides
   * whether reading a slot is impurity (`fn`), whether `$1` has an explanation
   * (`tile`), whether an `emit` expression has anywhere to send its dispatch
   * (`reducer`), and whether the runtime has installed `route` yet
   * (`app-init` — it has not).
   *
   * These name a position, not a definition: an `effect`'s `map-request` is
   * checked as `slot-init`, because what it needs is the same pure, payloadless
   * treatment. A new check conditioned on one of these values inherits every
   * position that borrows it, so widen the value's meaning here before adding
   * one rather than assuming the name is the whole story.
   *
   * `test` is an expression inside a `test` definition. It answers the four
   * rules below the way a test body needs — a slot is readable, `$1` is bound
   * by nothing, `emit` has no dispatch to reach — but so would a borrowed
   * value. What it is really for is the branches that *suppress* a check
   * inside a test body: `run-reducer` as a callee, and a wildcard whose
   * diagnostic another pass owns. Both are positions where the general rule
   * would report a mistake that is not one, so a fifth branch on this value
   * should be read as a suppression until it proves otherwise.
   */
  kind: "slot-init" | "tile" | "reducer" | "fn" | "app-init" | "test";
  localBinds: Set<string>;
  capsAvailable?: Set<string>; // for reducer context
  /**
   * Inferred types of in-scope local binds (ADR-002): fn params, tile `in`
   * (`$1`), `let` bindings, `for` binds and `match` binds. Cloned alongside
   * `localBinds` when a narrower scope is entered.
   *
   * Always present, and always written through `bindLocal` — a name absent
   * here must mean "in scope, type unknown", which is only true if every
   * re-binding *removes* the outer entry. It did not, so an inner `for x in
   * names` inherited the type of an outer `let x = 5` and reported the loop
   * variable as an Int.
   */
  localTypes: Map<string, TypeExpr>;
  /**
   * `run-reducer(<reducer>)` lowers to a read of `_init` / `_event`, which are
   * bound only inside a generated property trial — so a property-test
   * invariant is the one expression that may call it. Everywhere else in a
   * test body the emitted module dies with `_init is not defined` before a
   * single test reports, which is why the *position* is refused rather than
   * the reducer name resolved.
   */
  runReducerScope?: boolean;
  /**
   * A wildcard here is already reported by one of `checkTest`'s two dedicated
   * passes — E0109 for one anywhere in a `given`, E0103 for a `<slots.X>`
   * naming nothing in a reducer-test `expect`. Set only in those positions, so
   * one mistake draws one diagnostic there and a wildcard where neither pass
   * looks (an invariant, an `episode-test` expect) still draws E0109.
   */
  wildcardsReportedElsewhere?: boolean;
  /**
   * Whether the runtime fills `$route` into the payload this expression is
   * evaluated with. Required, so every scope has to answer it — the field was
   * optional for one commit and `app.init` silently went without.
   *
   * `no-payload` is a `fn`, a tile or a slot initializer: they are not applied
   * with a payload at all, so `$route` there is a name that does not exist
   * (E0103) rather than a bind read out of its scope (E0119).
   */
  routeBind: "bound" | "unbound" | "no-payload";
  /**
   * Where the E0120 gate records the names it matched, for a caller that wants
   * the answer rather than the diagnostic. Set only by the pass that asks
   * whether a `fn` body would read the route from an `app.init` position; a
   * scope that leaves it unset is unaffected.
   *
   * A read nested inside a `let`, a `for` or a match arm reaches this array
   * because every narrower scope is built by spreading the parent (`innerScope`
   * and the `LetIn` branch), so the child holds the same array. Construct one
   * of those explicitly and nested reads stop being found — silently, since
   * every diagnostic the gate produces here is discarded.
   */
  routeNamesSeen?: string[];
};

/**
 * Bring `name` into scope with `type`, or with no type when it cannot be
 * worked out. The delete is the load-bearing half: a bind shadows whatever the
 * name meant outside, so leaving the outer type behind makes the checker
 * reason about a value that is no longer there.
 */
function bindLocal(ctx: Ctx, name: string, type: TypeExpr | null): void {
  ctx.localBinds.add(name);
  if (type) ctx.localTypes.set(name, type);
  else ctx.localTypes.delete(name);
}

/** The type one iteration of `for x in iter` binds, given the iterated expression. */
function elementTypeOf(iter: Expr, sym: SymbolTable, ctx: Ctx): TypeExpr | null {
  return elementType(inferType(iter, sym, ctx), sym);
}

/**
 * `for` iterates a list (language.md §1.7.2 inv. 5). A `Map` and a `Set` are
 * both plain objects at runtime — keyed by field, not indexed — so iterating
 * one compiles and then throws where it is used: `.map is not a function` in a
 * tile, `object is not iterable` in a reducer. The spec's answer is to name the
 * list you meant, and both types have one.
 *
 * Silent when the type is unknown: `null` from `inferType` means "cannot tell",
 * never "not a collection".
 */
function checkIterationTarget(iter: Expr, sym: SymbolTable, errors: KumikiError[], ctx: Ctx): void {
  const t = unaliasType(inferType(iter, sym, ctx), sym);
  if (t?.kind !== "TypeApp") return;
  const remedy = t.name === "Map" ? "keys" : t.name === "Set" ? "to-list" : null;
  if (!remedy) return;
  // A `Map` has two lists in it and they bind different things, so the message
  // names both: `.keys` was not necessarily what the loop wanted.
  const alternative = t.name === "Map" ? " (or .values, which binds the value)" : "";
  errors.push({
    code: "E0218",
    kind: "for-over-non-list",
    message: `"for" iterates a List, but this is a ${t.name} — iterate its .${remedy}${alternative}`,
    pos: iter.pos,
  });
}

/** A copy of `ctx` whose bindings can be extended without touching the parent. */
function innerScope(ctx: Ctx): Ctx {
  return { ...ctx, localBinds: new Set(ctx.localBinds), localTypes: new Map(ctx.localTypes) };
}

/**
 * `button(type=…)` takes one of the three HTML values. A literal outside them
 * is worth reporting because of which way it fails: an invalid `type`
 * attribute resolves to `submit`, so `type="submmit"` on a button written NOT
 * to submit makes it submit the form it is in — the failure direction with the
 * most damage. Only literals are checked; an expression is unresolvable here,
 * exactly as `input(type=…)` treats one.
 */
const BUTTON_TYPES = new Set(["submit", "button", "reset"]);

function checkButtonType(t: TileExpr & { kind: "TileCall" }, errors: KumikiError[]): void {
  if (t.name !== "button") return;
  const arg = t.args.find((a) => a.name === "type");
  if (!arg) return;
  const v = arg.value as Expr;
  if (v.kind !== "Str" || BUTTON_TYPES.has(v.value)) return;
  errors.push({
    code: "E0201",
    kind: "type-mismatch",
    message: `button type="${v.value}" is not one of submit / button / reset; an invalid type submits`,
    pos: v.pos,
  });
}

/**
 * Validate `icon(name="<literal>")` against the strict-icons domain. Only
 * literal string names are checked — dynamic forms (`icon(name=slot)`,
 * computed expressions) are unresolvable at check time, matching the codegen
 * gate in `packages/compiler/src/codegen.ts` (icon case). E0704 is gated by
 * the `strictIcons` opt-in in `check()` so default callers never see it.
 */
function checkIconName(
  t: TileExpr & { kind: "TileCall" },
  sym: SymbolTable,
  errors: KumikiError[],
): void {
  if (t.name !== "icon") return;
  const nameArg = t.args.find((a) => a.name === "name");
  if (!nameArg) return;
  const v = nameArg.value as Expr;
  if (v.kind !== "Str") return;
  const literal = v.value;
  if (!literal) return;
  if (sym.iconDomain.has(literal)) return;
  errors.push({
    code: "E0704",
    kind: "unknown-icon",
    message: `Unknown icon name "${literal}" — not in @kumikijs/icons or any theme.icons block`,
    pos: v.pos,
  });
}

function checkA11y(
  t: TileExpr & { kind: "TileCall" },
  sym: SymbolTable,
  errors: KumikiError[],
): void {
  if (t.name === "label") {
    // A `for` that names nothing is a label that labels nothing: clicking it
    // focuses no control, and a screen reader announces the field unnamed.
    // Read from both spellings, the same two `collectElementIds` gathers ids
    // from — a `for` written as an argument reaches the DOM exactly as the
    // block form does, so a check that saw only one would bless the other.
    // Only a literal is resolvable; see `collectElementIds`.
    const forProp = writtenValue(t, "for");
    if (forProp?.kind === "Str" && !sym.elementIds.has(forProp.value)) {
      errors.push({
        code: "E0705",
        kind: "a11y-label-for",
        message: `label for="${forProp.value}" names no tile — no id="${forProp.value}" in this program`,
        pos: forProp.pos,
      });
    }
  }
  if (t.name === "button") {
    const hasText = t.args.some((a) => a.name === "text");
    const hasAria = t.props.some((p) => p.name === "aria-label");
    if (!hasText && !hasAria) {
      errors.push({
        code: "E0701",
        kind: "a11y-button",
        message: `button must have a text= argument or aria-label prop`,
        pos: t.pos,
      });
    }
  }
  if (t.name === "image") {
    const hasAlt = t.args.some((a) => a.name === "alt") || t.props.some((p) => p.name === "alt");
    if (!hasAlt) {
      errors.push({
        code: "E0702",
        kind: "a11y-image",
        message: `image must have an alt prop`,
        pos: t.pos,
      });
    }
  }
  if (t.name === "link") {
    const hasText = t.args.some((a) => a.name === "text") || t.props.some((p) => p.name === "text");
    const hasAria = t.props.some((p) => p.name === "aria-label");
    if (!hasText && !hasAria) {
      errors.push({
        code: "E0703",
        kind: "a11y-link",
        message: `link must have inner text or aria-label`,
        pos: t.pos,
      });
    }
  }
}

function checkTileExpr(t: TileExpr, sym: SymbolTable, errors: KumikiError[], ctx: Ctx): void {
  switch (t.kind) {
    case "TileFor": {
      checkExpr(t.iter, sym, errors, ctx);
      checkIterationTarget(t.iter, sym, errors, ctx);
      const inner = innerScope(ctx);
      bindLocal(inner, t.bind, elementTypeOf(t.iter, sym, ctx));
      checkTileExpr(t.body, sym, errors, inner);
      return;
    }
    case "TileWhen":
      checkExpr(t.cond, sym, errors, ctx);
      checkCondition(t.cond, inferType(t.cond, sym, ctx), sym, errors, '"when"');
      checkTileExpr(t.body, sym, errors, ctx);
      return;
    case "TileIf":
      checkExpr(t.cond, sym, errors, ctx);
      checkCondition(t.cond, inferType(t.cond, sym, ctx), sym, errors, '"if"');
      checkTileExpr(t.consequent, sym, errors, ctx);
      checkTileExpr(t.alternate, sym, errors, ctx);
      return;
    case "TileMatch": {
      checkExpr(t.scrutinee, sym, errors, ctx);
      const scrutType = inferType(t.scrutinee, sym, ctx);
      for (const arm of t.arms) {
        const inner = innerScope(ctx);
        checkPatternBindsAreDistinct(arm.pattern, errors);
        checkPatternAgainstType(arm.pattern, scrutType, sym, errors, inner);
        checkTileExpr(arm.body, sym, errors, inner);
      }
      return;
    }
    case "TileCall":
      checkTileCall(t, sym, errors, ctx);
      return;
  }
}

/**
 * A user tile is applied like a one-parameter function (§1.7.1: "a tile takes a
 * single positional argument", readable as `$1` only when `in=` is declared).
 * `tile Row in=Int` is called `Row(id)`; a tile with no `in=` takes nothing.
 *
 * Three shapes were unreported before this. Too few arguments leaves `$1`
 * unbound and the mount dies with `_d_1 is not defined`. Too many, to a tile
 * with no `in=`, mounts and renders while dropping the value. And a *tile*
 * where a value belongs — `Card(text("child"))` — makes codegen render the
 * argument in place of the tile's own body, so `Card`'s definition disappears
 * from the output with nothing said. The grammar has no children form; that
 * lowering is unspecified and now unreachable.
 *
 * On a user-tile call, only positional arguments count: a named one is a prop
 * wherever it is written — `Btn(onClick=tap)` and `Btn() {onClick: tap}` reach
 * the tile's root node alike — and `tileCallJs` takes the input from the same
 * set, so what is counted here is what is read there. A prop's value is not a
 * tile, which is the one shape that has no consumer on either side and is
 * reported below. The builtin call sites still take `args[0]` whatever its
 * name; that half is its own defect.
 */
function checkTileInput(
  t: TileExpr & { kind: "TileCall" },
  def: TileDef,
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  const positional = t.args.filter((a) => a.name === undefined);
  const wants = def.in ? 1 : 0;
  if (positional.length !== wants) {
    errors.push({
      code: "E0213",
      kind: "call-arity-mismatch",
      message: `Tile "${t.name}" expects ${wants} argument(s) but got ${positional.length}`,
      pos: t.pos,
    });
    return;
  }
  for (const named of t.args) {
    if (named.name === undefined || !isTileExpr(named.value)) continue;
    errors.push({
      code: "E0201",
      kind: "type-mismatch",
      message:
        `Named argument "${named.name}" on tile "${t.name}" is a prop, and a prop's value ` +
        `cannot be a tile — nothing renders it. Pass the tile as the positional argument of ` +
        `a tile that declares "in=", or write it as a child`,
      pos: named.value.pos,
    });
  }
  const arg = positional[0];
  if (!def.in || !arg) return;
  const value = arg.value;
  if (isTileExpr(value)) {
    errors.push({
      code: "E0201",
      kind: "type-mismatch",
      message: `Tile "${t.name}" expects a value of type ${typeToString(def.in)} but got a tile`,
      pos: value.pos,
    });
    return;
  }
  checkAgainst(value, def.in, sym, errors, ctx);
}

function checkTileCall(
  t: TileExpr & { kind: "TileCall" },
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  const userTile = sym.tiles.get(t.name);
  if (!BUILTIN_TILES.has(t.name) && !userTile) {
    errors.push({
      code: "E0105",
      kind: "undef-tile",
      message: `Reference to undefined tile "${t.name}"`,
      pos: t.pos,
    });
  }
  if (userTile) checkTileInput(t, userTile, sym, errors, ctx);
  checkA11y(t, sym, errors);
  checkIconName(t, sym, errors);
  checkButtonType(t, errors);
  if (t.name === "input") {
    const bindArg = t.args.find((a) => a.name === "bind");
    const typeArg = t.args.find((a) => a.name === "type");
    const typeVal = typeArg?.value as Expr | undefined;
    const isFileType = typeVal?.kind === "Str" && typeVal.value === "file";
    if (bindArg && isFileType) {
      const bindVal = bindArg.value as Expr;
      const slotName = bindVal.kind === "Ref" ? bindVal.name : "<expr>";
      errors.push({
        code: "E0205",
        kind: "bind-on-file-input",
        message: `input(type="file") does not support bind="${slotName}"; receive files via a ui.change reducer with $event.files.head (see docs/spec/forms.md §5.10, §5.1.1)`,
        pos: bindVal.pos,
      });
    }
    const isKnownNonFile =
      typeVal === undefined || (typeVal.kind === "Str" && typeVal.value !== "file");
    if (isKnownNonFile) {
      const observedType =
        typeVal === undefined
          ? `no type, defaults to "text"`
          : `type="${(typeVal as Expr & { kind: "Str" }).value}"`;
      for (const arg of t.args) {
        if (arg.name !== "accept" && arg.name !== "multiple") continue;
        const argVal = arg.value as Expr;
        errors.push({
          code: "E0206",
          kind: "file-only-prop",
          message: `input prop "${arg.name}" requires type="file" (got ${observedType}); accept/multiple are only valid on file inputs (see docs/spec/forms.md §5.10)`,
          pos: argVal.pos,
        });
      }
    }
  }

  for (const arg of t.args) {
    const v = arg.value;
    // A named arg whose name is an event handler binds a reducer — asked before
    // the nested-tile branch below, because a capitalised name written as a
    // named argument of a builtin that takes tiles parses as a tile call.
    // Checked as one, `box(text("x"), onClick=Card)` drew no diagnostic and
    // codegen captured no handler: the tile rendered and the click did
    // nothing. The other positions — a props block, a value-arg builtin such
    // as `link`, a user tile — parse the same name as a variant tag;
    // `checkHandlerBinding` reads the name out of either, which is what makes
    // them agree.
    if (arg.name !== undefined && HANDLER_NAMES.has(arg.name)) {
      checkHandlerBinding(t.name, arg.name, "arg", v, sym, errors);
      continue;
    }
    if (isTileExpr(v)) {
      checkTileExpr(v, sym, errors, ctx);
      continue;
    }
    checkExpr(v, sym, errors, ctx);
  }
  for (const prop of t.props) {
    if (HANDLER_NAMES.has(prop.name)) {
      checkHandlerBinding(t.name, prop.name, "prop", prop.value, sym, errors);
    } else if (prop.name === "motion" && prop.value.kind === "Str") {
      // A `motion: "Name"` prop must name a defined `motion` (M5 AC2).
      if (!sym.motions.has(prop.value.value)) {
        errors.push({
          code: "E0107",
          kind: "undef-motion",
          message: `Reference to undefined motion "${prop.value.value}"`,
          pos: prop.value.pos,
        });
      }
    } else if (t.name === "link" && prop.name === "prefetch") {
      // §3.8 prefetch — value names a reducer (bare ident or string literal),
      // not a value expression. Skip checkExpr (would flag the ident as undef)
      // and instead verify the reducer exists.
      const ref = prop.value;
      const name = ref.kind === "Ref" ? ref.name : ref.kind === "Str" ? ref.value : null;
      if (name === null) {
        errors.push({
          code: "E0201",
          kind: "type-mismatch",
          message: `link prefetch must be a reducer name`,
          pos: ref.pos,
        });
      } else if (!sym.reducers.has(name)) {
        errors.push({
          code: "E0102",
          kind: "undef-reducer",
          message: `Reference to undefined reducer "${name}"`,
          pos: ref.pos,
        });
      }
    } else {
      checkExpr(prop.value, sym, errors, ctx);
    }
  }
}

/**
 * Check one handler binding, in either form: `f(onX=r)` and `f() {onX: r}`.
 *
 * A handler names a reducer: this is the one argument position resolved in the
 * reducer namespace. What arrives is not always shaped like a reference — a
 * capitalised name is a tile call as a named argument of a builtin that takes
 * tiles, and a variant tag everywhere else (a props block, a value-arg builtin
 * such as `link`, a user tile) — and neither binding form has anything more to
 * say about that than the other, so both ask here rather than each deciding
 * for itself.
 *
 * The shape is not the question: `handlerReducerName` reads the name out of
 * whichever of the three the parser produced, so a reducer whose own name is
 * capitalised binds like any other. What is left to report is what was always
 * being reported — a value that is no name at all, and a name that names no
 * reducer — and a capitalised name now answers each exactly as a lowercase one
 * does.
 */
function checkHandlerBinding(
  tileName: string,
  handler: string,
  form: "arg" | "prop",
  value: Expr | TileExpr,
  sym: SymbolTable,
  errors: KumikiError[],
): void {
  checkHandlerTarget(tileName, handler, value.pos, errors);
  const name = handlerReducerName(value);
  if (name === null) {
    errors.push({
      code: "E0201",
      kind: "type-mismatch",
      message: `Event handler ${form} "${handler}" must be a reducer name`,
      pos: value.pos,
    });
    return;
  }
  if (!sym.reducers.has(name)) {
    errors.push({
      code: "E0102",
      kind: "undef-reducer",
      message: `Reference to undefined reducer "${name}"`,
      pos: value.pos,
    });
  }
}

/**
 * A handler prop written on a tile whose renderer never reads it.
 * `row(text("card"), onClick=open)` compiles, renders, and does nothing: the
 * container renderer wires layout and style, and clicks reach whatever
 * descendant handles them — or nothing.
 *
 * A warning rather than an error, matching W0212: the same silent-drop
 * situation, and the same reason to report it rather than break the build.
 * `W0212` cannot see this one — it asks about `ui.<ev>(Tile)` selectors, and a
 * container with any clickable descendant satisfies it.
 */
function checkHandlerTarget(
  tileName: string,
  handler: string,
  pos: Pos,
  errors: KumikiError[],
): void {
  if (!BUILTIN_TILES.has(tileName)) return;
  const allowed = HANDLER_PROP_TILES[handler];
  if (allowed == null || allowed.has(tileName)) return;
  errors.push({
    code: "W0213",
    kind: "handler-on-inert-tile",
    severity: "warning",
    message: `"${handler}" on ${tileName}() is dropped — ${tileName} does not fire it. Put it on ${[...allowed].sort().join(" / ")}, or subscribe with a reducer's on=ui.<event>(<Tile>)`,
    pos,
  });
}

/**
 * Collect every BUILTIN_TILES kind that may appear as a (descendant) part of
 * a named tile's render tree. Returns an empty set when nothing can be
 * statically inferred (cycle, undeclared name, or only dynamic bodies
 * without resolvable children). Used by the `W0212` check to suppress
 * cascade false positives — codegen propagates `ui.click(TodoRow)` down to
 * the `check` descendant of `TodoRow = row(check(...), …)`, so finding any
 * descendant in the allowed kind set means the subscription is wired.
 */
function collectTileBuiltinKinds(
  tileName: string,
  sym: SymbolTable,
  visited: Set<string> = new Set(),
): Set<string> {
  // `visited` is shared across the whole walk on purpose, and does two things:
  // it stops a cycle from recurring (`E0005` is what reports one), and it stops
  // a name reached twice through different branches from being re-expanded.
  // The second is why it must not be per-branch — a diamond over a deep tile
  // would otherwise re-walk the shared part once per path.
  if (visited.has(tileName)) return new Set();
  visited.add(tileName);
  if (BUILTIN_TILES.has(tileName)) return new Set([tileName]);
  const def = sym.tiles.get(tileName);
  if (!def) return new Set();
  // The same edges a cycle is looked for along: what this body expands into is
  // what its render tree is made of. A name that resolves to neither a builtin
  // nor a declared tile contributes nothing.
  const out = new Set<string>();
  for (const target of expansionTargets(def.body)) {
    for (const kind of collectTileBuiltinKinds(target.to, sym, visited)) out.add(kind);
  }
  return out;
}

/**
 * Result of walking a tile body to collect the literal `{id: "..."}` values
 * its `TileCall`s can produce. `known: true` means every `TileCall` reachable
 * through the body's control-flow branches carries a literal `Str` id, so the
 * `ids` set fully enumerates the DOM ids the tile can render. `known: false`
 * means at least one reachable `TileCall` has no `{id}` prop or its `{id}`
 * value is a non-`Str` expression (a `Ref` etc.) — the runtime filter is the
 * authority for those cases and E0212 stays silent.
 */
type TileIdCollection =
  | { readonly known: true; readonly ids: ReadonlySet<string> }
  | { readonly known: false };

const ID_COLL_UNKNOWN: TileIdCollection = Object.freeze({ known: false });

function mergeIdCollections(a: TileIdCollection, b: TileIdCollection): TileIdCollection {
  if (!a.known || !b.known) return ID_COLL_UNKNOWN;
  const out = new Set(a.ids);
  for (const v of b.ids) out.add(v);
  return { known: true, ids: out };
}

/**
 * §1.6.2 / issue #149 — collect the literal `{id}` values a tile's `TileCall`
 * roots can produce. Only walks THIS tile's body — referenced user tiles are
 * intentionally not descended so a future per-instance id-override at the use
 * site isn't foreclosed at compile time. Cycle-safe by construction: the
 * walker never crosses tile boundaries, so recursion is bounded by this
 * tile's own AST depth. Takes the `TileDef` directly (rather than looking up
 * by name) so a caller that forgets the existence guard fails loudly instead
 * of getting a silent `known: false` — the exact silent-failure mode this
 * whole diagnostic exists to prevent.
 */
function collectTileDeclaredIds(def: TileDef): TileIdCollection {
  return walkTileExprForDeclaredIds(def.body);
}

function walkTileExprForDeclaredIds(expr: TileExpr): TileIdCollection {
  // Exhaustive switch: a future 6th `TileExpr` variant would otherwise
  // silently fall through to the `TileCall`-shaped `props` read below and
  // either return a wrong-looking id set or crash at runtime with no code /
  // position. The `never` fallthrough turns that into a compile-time error.
  switch (expr.kind) {
    case "TileFor":
    case "TileWhen":
      return walkTileExprForDeclaredIds(expr.body);
    case "TileIf":
      return mergeIdCollections(
        walkTileExprForDeclaredIds(expr.consequent),
        walkTileExprForDeclaredIds(expr.alternate),
      );
    case "TileMatch": {
      // Seed with UNKNOWN so a hypothetical 0-arm match (no branches to
      // vouch for the id set) yields `known: false` and E0212 stays silent
      // instead of emitting a message with an empty `actual` — the parser
      // rejects 0-arm matches today, but this keeps the diagnostic honest
      // if that ever changes.
      let acc: TileIdCollection = ID_COLL_UNKNOWN;
      for (let i = 0; i < expr.arms.length; i++) {
        const armIds = walkTileExprForDeclaredIds(expr.arms[i]!.body);
        acc = i === 0 ? armIds : mergeIdCollections(acc, armIds);
      }
      return acc;
    }
    case "TileCall": {
      const id = expr.props.find((p) => p.name === "id")?.value;
      if (id?.kind !== "Str") return ID_COLL_UNKNOWN;
      return { known: true, ids: new Set([id.value]) };
    }
    default: {
      const _exhaustive: never = expr;
      return _exhaustive;
    }
  }
}

/**
 * Whether the runtime *may* apply this reducer with a `$route` in its payload.
 * Two things do (`core.ts`): the route lifecycle chain (`route.enter` /
 * `route.leave` / `route.error`), and a link's prefetch, which fires its target
 * with a synthetic route built from `prefetch-args` so the prefetch and the
 * navigation can share one reducer body (routing.md §3.8). Every other trigger
 * passes a payload with no route in it.
 *
 * "May", because a prefetch target is exempted by NAME. The prefetch resolves
 * its reducer by name and binds a route only on that path; the same reducer
 * reached through its own `on=` trigger gets the routeless payload like any
 * other. A reducer has one trigger and this check has no path sensitivity, so
 * the choice is between exempting the name and reporting every prefetch target
 * that is also, say, click-triggered — where the read is legitimate on one path
 * and empty on the other. Exempting is the side that never rejects a working
 * program; what it costs is that `prefetch: R` on a reducer triggered some
 * other way turns the check off for `R` entirely.
 */
function bindsRoute(r: ReducerDef, sym: SymbolTable): boolean {
  if (r.on.kind === "LifecycleEvent" && r.on.name.startsWith("route.")) return true;
  return sym.prefetchTargets.has(r.name);
}

/**
 * Every reducer a `link {prefetch: …}` names, in either form the prop accepts
 * (bare ident or string literal — the same pair `checkTileProp` resolves). The
 * walk is the whole tile body, not only its top level: a prefetching link is
 * usually inside the `for` that renders the list it links into.
 */
function collectPrefetchTargets(expr: TileExpr, out: Set<string>): void {
  switch (expr.kind) {
    case "TileFor":
    case "TileWhen":
      collectPrefetchTargets(expr.body, out);
      return;
    case "TileIf":
      collectPrefetchTargets(expr.consequent, out);
      collectPrefetchTargets(expr.alternate, out);
      return;
    case "TileMatch":
      for (const arm of expr.arms) collectPrefetchTargets(arm.body, out);
      return;
    case "TileCall": {
      if (expr.name === "link") {
        const v = expr.props.find((p) => p.name === "prefetch")?.value;
        if (v?.kind === "Ref") out.add(v.name);
        else if (v?.kind === "Str") out.add(v.value);
      }
      for (const a of expr.args) if (isTileExpr(a.value)) collectPrefetchTargets(a.value, out);
      return;
    }
    default:
      assertNever(expr);
  }
}

/**
 * Every id declared as a literal, in either form a tile accepts — `{id: "x"}`
 * or `id="x"`. This is the domain `E0705` resolves a `label {for: …}` against.
 *
 * An id built at runtime (`{id: "todo-" + t.id}`) is not in it, and the check
 * only ever looks up a literal `for`. A computed `for` is therefore never
 * reported; a literal one against a computed id is, which is the right answer —
 * one literal name cannot address a control per row — and `errors.md` says so
 * along with the fix. The same literal-only discipline `E0704` applies to icon
 * names.
 */
/**
 * A value a tile-call was given under `name`, in either form it accepts: the
 * props block (`{for: "x"}`) or a named argument (`for="x"`). The block form
 * wins, matching what codegen emits when a tile writes both.
 */
function writtenValue(t: TileExpr & { kind: "TileCall" }, name: string): Expr | undefined {
  const fromProp = t.props.find((p) => p.name === name)?.value;
  if (fromProp !== undefined) return fromProp;
  const fromArg = t.args.find((a) => a.name === name)?.value;
  return fromArg === undefined || isTileExpr(fromArg) ? undefined : fromArg;
}

function collectElementIds(expr: TileExpr, out: Set<string>): void {
  switch (expr.kind) {
    case "TileFor":
    case "TileWhen":
      collectElementIds(expr.body, out);
      return;
    case "TileIf":
      collectElementIds(expr.consequent, out);
      collectElementIds(expr.alternate, out);
      return;
    case "TileMatch":
      for (const arm of expr.arms) collectElementIds(arm.body, out);
      return;
    case "TileCall": {
      const id = writtenValue(expr, "id");
      if (id?.kind === "Str") out.add(id.value);
      for (const a of expr.args) if (isTileExpr(a.value)) collectElementIds(a.value, out);
      return;
    }
    default:
      assertNever(expr);
  }
}

function checkReducer(r: ReducerDef, sym: SymbolTable, errors: KumikiError[]): void {
  const ctx: Ctx = {
    kind: "reducer",
    localBinds: new Set(),
    localTypes: new Map(),
    capsAvailable: new Set(sym.app?.caps ?? []),
    routeBind: bindsRoute(r, sym) ? "bound" : "unbound",
  };
  // event binds
  if (r.on.kind === "EffectEvent") {
    // Both checks a bind is subject to today are asked here, in the walk that
    // puts the names into scope, so the answer to one cannot drift from the
    // answer to the other. Whichever of them fires, the name still enters the
    // scope — that is what `ctx.localBinds.add` below the branch is for, and
    // why it sits outside it: the body's reads are then that binding, so a
    // `$route` bind does not also collect an E0119 apiece for every read.
    //
    // Which positional each name already holds. A bind list names the payload's
    // positionals in order, so a bind's index *is* its position — `_` included,
    // since it stands for a positional rather than skipping one, which is the
    // index `emit-reducer.ts` reads the payload at.
    const boundAt = new Map<string, number>();
    r.on.binds.forEach((b, i) => {
      if (b.name === "_") return;
      if (RESERVED_BIND_NAMES.has(b.name)) {
        // §1.6.5 — codegen declares these three in every reducer body, whatever
        // the trigger, so a bind that takes one is a second declaration of the
        // same name. Reported per bind, and never as a duplicate as well: this
        // already says to rename the bind, and renaming it settles both.
        errors.push({
          code: "E0121",
          kind: "reserved-bind-name",
          message:
            `"${b.name}" is a positional binding the compiler declares in every reducer ` +
            `body, so an effect-event bind cannot also take the name — the two declarations ` +
            `collide and the module does not load. Rename the bind`,
          pos: b.pos,
        });
      } else {
        const first = boundAt.get(b.name);
        if (first === undefined) boundAt.set(b.name, i + 1);
        else
          errors.push({
            code: "E0123",
            kind: "duplicate-effect-bind",
            message:
              `"${b.name}" is bound twice in this trigger: it names $${first} and then ` +
              `$${i + 1}, so the two binds are peers — nothing nests them, the second does ` +
              `not shadow the first, and $${first} has no name left to read it by. Rename ` +
              `one, or write "_" for a positional the reducer does not read`,
            pos: b.pos,
          });
      }
      ctx.localBinds.add(b.name);
    });
    // The name before `.ok` / `.err` is the effect whose result this reducer
    // waits for. A misspelling leaves it waiting for a result nothing produces.
    if (!sym.effects.has(r.on.effect) && !BUILTIN_EFFECT_CAPS.has(r.on.effect)) {
      errors.push({
        code: "E0104",
        kind: "undef-effect",
        message: `Reference to undefined effect "${r.on.effect}"`,
        pos: r.on.effectPos,
      });
    }
  }
  // `tile.mount(X)` fires when *that* tile enters the rendered tree, so an
  // undeclared `X` is the same dead subscription E0211 reports for a `ui.*`
  // selector — and there is no `_` here to exempt: the wildcard exists for
  // reducers dispatched indirectly, which a lifecycle event never is.
  const lifecycleTile = r.on.kind === "LifecycleEvent" ? r.on.tileTarget : undefined;
  if (lifecycleTile && !sym.tiles.has(lifecycleTile.name)) {
    errors.push({
      code: "E0211",
      kind: "undef-tile-in-selector",
      message: `Reducer "${r.name}" subscribes to ${lifecycleTile.event}(${lifecycleTile.name}) but tile "${lifecycleTile.name}" is not declared`,
      pos: lifecycleTile.pos,
    });
  }
  // §1.6.2 — the selector's tile name must refer to a declared `tile`. A typo
  // here used to bind nothing silently, which made `ui.click(Foo)` indistin-
  // guishable from `ui.click(Fooo)`. Fires before the reducer body is checked
  // so the diagnostic carries the actual selector position. The `_` wildcard
  // selector is a parser-accepted sentinel for reducers dispatched indirectly
  // (e.g. as `emit confirm({onYes: r})` callbacks), so it has no tile to
  // resolve — see docs/spec/lifecycle.md.
  if (r.on.kind === "UiEvent" && r.on.selector.tile !== "_" && !sym.tiles.has(r.on.selector.tile)) {
    errors.push({
      code: "E0211",
      kind: "undef-tile-in-selector",
      message: `Reducer "${r.name}" subscribes to ui.${r.on.ev}(${r.on.selector.tile}) but tile "${r.on.selector.tile}" is not declared`,
      pos: r.on.pos,
    });
  }
  // §1.6.2 / issue #149 — a typo in the `#id` portion of a `ui.<ev>(Tile#id)`
  // selector previously survived all four compile stages and was silently
  // filtered by the runtime `_dispatch`. When the target tile's every reachable
  // TileCall carries a literal `{id: "..."}` prop and none of those literals
  // matches the selector's id, the subscription can never fire — surface it as
  // a compile-time error, gated by `strictSelectorId` (the runtime filter stays
  // the authority for tiles with computed or missing `{id}`, and for the PR
  // #148 regression test that intentionally constructs a literal mismatch).
  // Skipped when E0211 already fires (undeclared tile) so users see one root
  // cause, not two overlapping ones.
  if (r.on.kind === "UiEvent" && r.on.selector.tile !== "_" && r.on.selector.id !== undefined) {
    const def = sym.tiles.get(r.on.selector.tile);
    if (def !== undefined) {
      const decl = collectTileDeclaredIds(def);
      if (decl.known && decl.ids.size > 0 && !decl.ids.has(r.on.selector.id)) {
        const actual = [...decl.ids].map((v) => `"${v}"`).join(" | ");
        errors.push({
          code: "E0212",
          kind: "selector-id-mismatch",
          message:
            `Reducer "${r.name}" subscribes to ui.${r.on.ev}(${r.on.selector.tile}#${r.on.selector.id}) ` +
            `but tile "${r.on.selector.tile}" is declared with id ${actual} — this selector can never match`,
          pos: r.on.pos,
        });
      }
    }
  }
  // §1.6.1 — flag `ui.<ev>(Tile)` subscriptions whose target tile has no
  // descendant that can fire `<ev>` in the DOM (e.g. `ui.focus(Card)` where
  // `Card = box(...)`). Codegen drops the handler silently for that case,
  // so the reducer is dead code. Surfacing it as a warning matches the
  // issue's "warn first, promote to error later" plan. The descendant walk
  // suppresses false positives for the cascade pattern where a focusable
  // child IS in the body (e.g. `TodoRow = row(check(...))` + `ui.click`).
  // Wildcard `_` selectors are skipped (no tile to resolve); undeclared
  // selectors are already covered by E0211.
  if (r.on.kind === "UiEvent" && r.on.selector.tile !== "_") {
    const allowed = UI_EVENT_TILE_KINDS[r.on.ev];
    if (allowed != null) {
      const descendants = collectTileBuiltinKinds(r.on.selector.tile, sym);
      const hasMatch = [...descendants].some((k) => allowed.has(k));
      // Empty set = unresolvable (cycle / undeclared / dynamic-only body) →
      // conservative skip, no warning.
      if (descendants.size > 0 && !hasMatch) {
        errors.push({
          code: "W0212",
          kind: "ui-event-tile-mismatch",
          severity: "warning",
          message:
            `Reducer "${r.name}" subscribes to ui.${r.on.ev}(${r.on.selector.tile}) ` +
            `but tile "${r.on.selector.tile}" has no descendant that fires "${r.on.ev}" ` +
            `(DOM-allowed: ${[...allowed].join(", ")}; observed in body: ${[...descendants].sort().join(", ")}). ` +
            `The handler is silently dropped.`,
          pos: r.on.pos,
        });
      }
    }
  }
  // Not derived from `RESERVED_BIND_NAMES`: `$route` is deliberately absent,
  // because the E0119 gate reads `localBinds` to tell a payload field from a
  // name something in the body bound. Seeding it here would answer that
  // question "bound" for every reducer and retire the diagnostic.
  ctx.localBinds.add("$el");
  ctx.localBinds.add("$event");

  const writtenRoots = new Set<string>();
  for (const stmt of r.do) checkStmt(stmt, sym, errors, ctx, writtenRoots);
}

function checkStmt(
  s: Statement,
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
  writtenRoots: Set<string>,
): void {
  if (s.kind === "ForStmt") {
    checkExpr(s.iter, sym, errors, ctx);
    checkIterationTarget(s.iter, sym, errors, ctx);
    const inner = innerScope(ctx);
    bindLocal(inner, s.bind, elementTypeOf(s.iter, sym, ctx));
    // A loop body executes multiple times; track writes inside its own scope
    // so the same slot can be assigned once per iteration. After the loop,
    // propagate the write set up to the parent (the slot WAS written).
    const bodyWrites = new Set<string>(writtenRoots);
    for (const st of s.body) checkStmt(st, sym, errors, inner, bodyWrites);
    for (const r of bodyWrites) writtenRoots.add(r);
    return;
  }
  if (s.kind === "IfStmt") {
    checkExpr(s.cond, sym, errors, ctx);
    checkCondition(s.cond, inferType(s.cond, sym, ctx), sym, errors, '"if"');
    // then/else are exclusive — each branch starts from the parent write set.
    // A slot written in only one branch (or both) counts as "written" for the
    // parent, so subsequent code can't re-write it.
    const thenWrites = new Set<string>(writtenRoots);
    for (const st of s.consequent) checkStmt(st, sym, errors, ctx, thenWrites);
    const elseWrites = new Set<string>(writtenRoots);
    for (const st of s.alternate) checkStmt(st, sym, errors, ctx, elseWrites);
    for (const r of thenWrites) writtenRoots.add(r);
    for (const r of elseWrites) writtenRoots.add(r);
    return;
  }
  if (s.kind === "MatchStmt") {
    checkExpr(s.scrutinee, sym, errors, ctx);
    const scrutType = inferType(s.scrutinee, sym, ctx);
    // Arms are mutually exclusive — each starts fresh from the parent set.
    const armSets: Set<string>[] = [];
    for (const arm of s.arms) {
      const inner = innerScope(ctx);
      checkPatternBindsAreDistinct(arm.pattern, errors);
      checkPatternAgainstType(arm.pattern, scrutType, sym, errors, inner);
      const armWrites = new Set<string>(writtenRoots);
      for (const st of arm.body) checkStmt(st, sym, errors, inner, armWrites);
      armSets.push(armWrites);
    }
    for (const set of armSets) for (const r of set) writtenRoots.add(r);
    return;
  }
  if (s.kind === "NoopStmt") return;
  if (s.kind === "LetStmt") {
    checkExpr(s.rhs, sym, errors, ctx);
    bindLocal(ctx, s.name, inferType(s.rhs, sym, ctx));
    return;
  }
  if (s.kind === "Emit") {
    checkEmitTarget(s.effect, s.args, sym, errors, ctx, s.pos);
    // `emit confirm({onYes: <reducer>, onNo: <reducer>})` (lifecycle §7.6):
    // the onYes/onNo fields name reducers, not values. Skip the standard
    // checkExpr on those Refs (which would flag them as undefined names),
    // but verify they DO resolve to a defined reducer.
    const confirmArg = s.effect === "confirm" && s.args.length === 1 ? s.args[0] : undefined;
    if (confirmArg && confirmArg.kind === "RecordLit") {
      for (const f of confirmArg.fields) {
        if ((f.name === "onYes" || f.name === "onNo") && f.value.kind === "Ref") {
          if (!sym.reducers.has(f.value.name)) {
            errors.push({
              code: "E0103",
              kind: "undef-ref",
              message: `confirm "${f.name}" refers to undefined reducer "${f.value.name}"`,
              pos: f.value.pos,
            });
          }
          continue;
        }
        checkExpr(f.value, sym, errors, ctx);
      }
      return;
    }
    for (const a of s.args) checkExpr(a, sym, errors, ctx);
    return;
  }
  if (s.kind === "StopTimer") {
    if (!sym.timerNames.has(s.name)) {
      errors.push({
        code: "E0106",
        kind: "undef-timer",
        message: `stop-timer refers to undefined timer name "${s.name}"`,
        pos: s.pos,
      });
    }
    return;
  }
  if (s.kind === "PanicStmt") {
    checkExpr(s.message, sym, errors, ctx);
    // The runtime stringifies whatever it is given, so a record arrives as
    // "[object Object]" — the stop reason lost at exactly the moment it is
    // needed. A panic carries one thing out of the program and this is it.
    checkAgainst(s.message, prim("Text", s.pos), sym, errors, ctx);
    return;
  }
  // SlotAssign
  const root = lvalueRoot(s.lvalue);
  if (!sym.slots.has(root)) {
    errors.push({
      code: "E0103",
      kind: "undef-slot",
      message: `Assignment to undefined slot "${root}"`,
      pos: s.pos,
    });
  }
  // Track duplicate writes at lvalue-SHAPE granularity. `issues[iid].status`
  // and `issues[iid].updatedAt` have different shapes so they may coexist in
  // the same reducer; codegen accumulates them via `_setPath` chaining on the
  // shared `_next[root]`.
  const shape = lvalueShape(s.lvalue);
  if (writtenRoots.has(shape)) {
    errors.push({
      code: "E0601",
      kind: "duplicate-write",
      message: `Slot path "${shape}" is written more than once in this reducer`,
      pos: s.pos,
    });
  }
  writtenRoots.add(shape);
  checkLvalue(s.lvalue, sym, errors, ctx);
  checkExpr(s.rhs, sym, errors, ctx);
  checkAgainst(s.rhs, lvalueType(s.lvalue, sym), sym, errors, ctx);
}

function lvalueShape(lv: Lvalue): string {
  if (lv.kind === "LSlot") return lv.name;
  const parts: string[] = [];
  let cur: Lvalue = lv;
  while (cur.kind !== "LSlot") {
    if (cur.kind === "LField") parts.unshift(`.${cur.field}`);
    else parts.unshift("[]");
    cur = cur.base;
  }
  return cur.name + parts.join("");
}

function lvalueRoot(lv: Lvalue): string {
  while (lv.kind !== "LSlot") {
    lv = lv.base;
  }
  return lv.name;
}

function checkLvalue(lv: Lvalue, sym: SymbolTable, errors: KumikiError[], ctx: Ctx): void {
  if (lv.kind === "LSlot") return;
  if (lv.kind === "LIndex") checkExpr(lv.index, sym, errors, ctx);
  else {
    // Record the same decision `classifyFieldAccess` records for a read, so
    // codegen lowers `opt.get.f` and `rec.get.f` differently. Left unset when
    // the base type is unknown, as it is there — the name-based reading then
    // stands, on both sides alike.
    const base = unaliasType(lvalueType(lv.base, sym), sym);
    if (base?.kind === "TypeRecord") {
      const isField = recordFieldType(base, lv.field) !== null;
      lv.accessKind = isField ? "field" : "shortcut";
      if (!isField) {
        // The read side's diagnostic, raised for a write. Without it the same
        // expression was an error as an rvalue and silent as an lvalue, and
        // the write landed on a key beside the data it meant to edit.
        errors.push({
          code: "E0108",
          kind: "undef-member",
          message: `Record type has no field or method ".${lv.field}"`,
          pos: lv.pos,
        });
      }
    } else if (base) {
      lv.accessKind = "shortcut";
    }
  }
  checkLvalue(lv.base, sym, errors, ctx);
}

/**
 * Resolve a `Call`'s callee. Codegen's fallback lowers an unknown name to a
 * call on a JS binding of that name, so anything this function lets through
 * without a lowering becomes `<name> is not defined` at runtime — which is why
 * the accepted set is `builtin-calls.ts`, the same table codegen dispatches on,
 * rather than a looser "looks like a function" rule.
 */
function checkCallee(
  callee: string,
  args: Expr[],
  pos: Pos,
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  const argCount = args.length;
  const fn = sym.fns.get(callee);
  // A declared `fn` wins over the unimplemented list. Codegen has no lowering
  // for `trace`, so it takes the user-fn fallback and a program that declares
  // `fn trace` works — reporting E0802 for it would reject a running program
  // and tell its author their own function is unimplemented.
  if (!fn && UNIMPLEMENTED_CALLS.has(callee)) {
    errors.push({
      code: "E0802",
      kind: "unimplemented-function",
      message: `Function "${callee}" is documented but not implemented by the runtime`,
      pos,
    });
    return;
  }
  // A constant namespace has exactly the members `QUALIFIED_BUILTIN_CALLS`
  // lists. Without this, `TYPE_MEMBER_CALLS` resolves `fresh` / `parse` / `show`
  // on *any* capitalised qualifier, so `EffectId.fresh` passed and lowered to
  // `_s.freshId()` — a real id minted where the author wrote the empty
  // sentinel, which a later `http.cancel` then aims at nothing. Only the
  // zero-argument form is refused: `EffectId.show(h)` is the qualified spelling
  // of `h.show` and means what it says.
  const dot = callee.indexOf(".");
  if (
    dot > 0 &&
    argCount === 0 &&
    CONSTANT_NAMESPACES.has(callee.slice(0, dot)) &&
    !QUALIFIED_BUILTIN_CALLS.has(callee)
  ) {
    errors.push({
      code: "E0116",
      kind: "undef-call",
      message: `Call to undefined function "${callee}"`,
      pos,
    });
    return;
  }
  // `<Type>.fresh|parse|show` is lowered on any capitalised qualifier — codegen
  // matches it by regex — so a misspelt qualifier did not fail, it changed what
  // the call does: `Int.parse` has a numeric branch and `Itn.parse` misses it,
  // so an `Int` slot ends up holding `"12"` and every later sum concatenates.
  // Reported as E0117 with the sentence `resolveType` uses, so the repair path
  // for an unknown type name covers this one without knowing about it.
  if (dot > 0 && TYPE_MEMBER_CALLS.has(callee.slice(dot + 1))) {
    const qualifier = callee.slice(0, dot);
    // The same spelling rule `builtinArity` and codegen apply. Without it this
    // reported an undefined *type* for a name that has no lowering under any
    // spelling — and the type-name repair it invited landed on E0116 at the
    // same position, costing a rollback and a round.
    if (
      isQualifierName(qualifier) &&
      !isKnownTypeName(qualifier, sym) &&
      !isPrimTypeName(qualifier)
    ) {
      errors.push({
        code: "E0117",
        kind: "undef-type",
        message: `Reference to undefined type "${qualifier}"`,
        pos,
      });
      return;
    }
  }
  const arity = builtinArity(callee);
  if (arity !== undefined) {
    if (argCount < arity.min || argCount > arity.max) {
      errors.push({
        code: "E0213",
        kind: "call-arity-mismatch",
        message: `Function "${callee}" expects ${wantedArguments(arity)} but got ${argCount}`,
        pos,
      });
    }
    return;
  }
  if (!fn) {
    errors.push({
      code: "E0116",
      kind: "undef-call",
      message: `Call to undefined function "${callee}"`,
      pos,
    });
    return;
  }
  if (fn.params.length !== argCount) {
    errors.push({
      code: "E0213",
      kind: "call-arity-mismatch",
      message: `Function "${callee}" expects ${fn.params.length} argument(s) but got ${argCount}`,
      pos,
    });
    return;
  }
  fn.params.forEach((p, i) => {
    const arg = args[i];
    if (arg) checkAgainst(arg, p.type, sym, errors, ctx);
  });
}

/**
 * `run-reducer` outside the one expression that can lower it.
 *
 * The position is what is wrong, so this is reported where the call is written
 * rather than against the reducer it names — which may well exist.
 */
function reportRunReducerPosition(ctx: Ctx, pos: Pos, errors: KumikiError[]): void {
  if (ctx.runReducerScope) return;
  errors.push({
    code: "E0116",
    kind: "undef-call",
    message: 'Call to "run-reducer" outside a property-test invariant',
    pos,
  });
}

/**
 * How many arguments a builtin wants, as the message says it. Only `fmt` has a
 * range — its signature is `fmt(template, ...args)`, so the template is all
 * that can be required and naming an exact number would describe a call that
 * cannot exist.
 */
function wantedArguments(arity: BuiltinArity): string {
  const count = `${arity.min} argument(s)`;
  return arity.min === arity.max ? count : `at least ${count}`;
}

/**
 * The sentence to add when an unresolved name reads as arithmetic.
 *
 * `-` is an identifier character AND the subtraction operator, and longest
 * munch settles it in the identifier's favour — `on-401` is core syntax written
 * exactly like `count-1`, so no rule can keep one and split the other. What is
 * left is that `count-1` resolves to nothing, and the diagnostic can say why
 * when the part before the hyphen is a name that does resolve.
 *
 * Not when a declared name is one edit away, though: `page-size` beside a
 * `page-sizes` is a typo, and `kumiki fix` reads this message as a contract —
 * telling it to insert spaces there would propose the one repair that cannot
 * be right. A misspelling looks like arithmetic in exactly the cases where
 * saying so is least useful.
 */
function arithmeticHint(name: string, sym: SymbolTable, ctx: Ctx): string {
  const cut = name.indexOf("-");
  if (cut <= 0) return "";
  const head = name.slice(0, cut);
  const tail = name.slice(cut + 1);
  const resolves = ctx.localBinds.has(head) || sym.slots.has(head) || sym.fns.has(head);
  if (!resolves) return "";
  if (hasCloseName(name, sym, ctx)) return "";
  return ` — "-" continues an identifier, so this is one name. Write "${head} - ${tail}" with spaces for subtraction.`;
}

/**
 * Is some name in scope within one edit of `name`? Deliberately cheaper than
 * `kumiki fix`'s suggester, which ranks candidates — here the only question is
 * whether a suggestion exists at all, because one is a better answer than the
 * hint.
 */
function hasCloseName(name: string, sym: SymbolTable, ctx: Ctx): boolean {
  const inScope = [...ctx.localBinds, ...sym.slots.keys(), ...sym.fns.keys()];
  return inScope.some((c) => c !== name && withinOneEdit(name, c));
}

/** Levenshtein distance ≤ 1, without building the matrix. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function checkExpr(e: Expr, sym: SymbolTable, errors: KumikiError[], ctx: Ctx): void {
  switch (e.kind) {
    case "Num":
    case "Str":
    case "Bool":
    case "Unit":
      return;
    case "Ref":
      // An `app.init` argument is evaluated while `createApp()` builds the app
      // object; the route is installed later, by whichever mount follows. Both
      // spellings therefore read nothing here, and both get the same answer —
      // E0119's would send the author from `$route` to `route`, which is the
      // other half of the same hole. Checked before the two branches below so
      // the position wins over the spelling.
      //
      // A local bind wins over both. `let route = "x" in route` is a name that
      // shadows the built-in, codegen honours the shadow (`localBinds` is the
      // first thing its `Ref` case consults), and a report here would reject a
      // program that works — the same checker/codegen disagreement this gate
      // exists to close, pointed the other way.
      if (
        (e.name === "route" || e.name === "$route") &&
        ctx.kind === "app-init" &&
        !ctx.localBinds.has(e.name)
      ) {
        // The one place that decides whether a `route` here is the runtime's,
        // so the transitive pass asks this branch rather than matching the
        // spelling itself: `routeNamesSeen` is how a caller checking a `fn`
        // body in this position learns which name it found.
        ctx.routeNamesSeen?.push(e.name);
        errors.push({
          code: "E0120",
          kind: "route-in-app-init",
          message: routeInAppInitMessage(e.name),
          pos: e.pos,
        });
        return;
      }
      // `$route` is not a name in a table — it is a payload field the runtime
      // fills in for some reducers and not others, so the reducer's own trigger
      // is what puts it in scope. Answered here rather than by seeding
      // localBinds, so there is one place that decides. Where there is no
      // payload at all the name means nothing, and the undefined-name report
      // below is the right one.
      //
      // An enclosing bind of the same name wins, for the reason the E0120 gate
      // above gives: `let $route = … in $route` lowers to that binding — codegen
      // gives a declaration over a name already in scope an identifier of its
      // own (`declareBind`), so the shadow is a shadow and not a collision — and
      // the payload it does or does not carry decides nothing.
      if (e.name === "$route" && ctx.routeBind !== "no-payload" && !ctx.localBinds.has(e.name)) {
        if (ctx.routeBind === "unbound") {
          errors.push({
            code: "E0119",
            kind: "route-bind-out-of-scope",
            message:
              `"$route" is only bound in a route.enter / route.leave / route.error reducer ` +
              `and in a link's prefetch target; nothing binds one here, so every field off ` +
              `it reads undefined. Read the "route" slot instead — ` +
              `it holds the current route and is in scope everywhere`,
            pos: e.pos,
          });
        }
        return;
      }
      if (ctx.localBinds.has(e.name)) return;
      if (sym.slots.has(e.name)) {
        if (ctx.kind === "fn") {
          errors.push({
            code: "E0305",
            kind: "fn-impurity",
            message: `fn "${currentFnName(ctx)}" must not read slot "${e.name}"`,
            pos: e.pos,
          });
        }
        return;
      }
      if (sym.fns.has(e.name)) return;
      // Could be a built-in like `route`
      if (e.name === "route" || e.name === "now" || e.name === "self") return;
      // `$1` in a tile is bound only when the tile declares `in=`; reaching here
      // means it didn't (in= adds `$1` to localBinds). Point at the real fix.
      if (e.name === "$1" && ctx.kind === "tile") {
        errors.push({
          code: "E0103",
          kind: "undef-ref",
          message: `"$1" is undefined here — a tile can only use "$1" if it declares an "in=" argument (e.g. \`tile X in=SomeType = …\`)`,
          pos: e.pos,
        });
        return;
      }
      errors.push({
        code: "E0103",
        kind: "undef-ref",
        message: `Reference to undefined name "${e.name}"${arithmeticHint(e.name, sym, ctx)}`,
        pos: e.pos,
      });
      return;
    case "Variant":
      for (const p of e.payload) checkExpr(p, sym, errors, ctx);
      return;
    case "BinOp": {
      // EffectId is opaque (spec stdlib §2.1.1.1): only `==` / `!=` defined.
      // Boolean `&` / `|` cannot meaningfully apply to it either, but we leave
      // them to the general unknown-receiver path — the typical misuse is
      // arithmetic (`+` / `-` / `*` / `/`) or ordering (`<` / `>` / `<=` /
      // `>=`), which is what we flag here.
      const isEffectId = (t: TypeExpr | null): boolean =>
        !!t && t.kind === "TypePrim" && t.name === "EffectId";
      let effectIdMisuse = false;
      if (e.op !== "==" && e.op !== "!=") {
        const lt = inferType(e.lhs, sym, ctx);
        const rt = inferType(e.rhs, sym, ctx);
        if (isEffectId(lt) || isEffectId(rt)) {
          effectIdMisuse = true;
          errors.push({
            code: "E0204",
            kind: "effect-id-misuse",
            message: `Operator "${e.op}" cannot be applied to EffectId — only "==" / "!=" are defined`,
            pos: e.pos,
          });
        }
      }
      checkExpr(e.lhs, sym, errors, ctx);
      checkExpr(e.rhs, sym, errors, ctx);
      // E0204 already named the operand; the operand-family check would only
      // repeat it in different words.
      if (!effectIdMisuse) checkBinOpOperands(e, sym, errors, ctx);
      return;
    }
    case "UnaryOp": {
      checkExpr(e.rhs, sym, errors, ctx);
      const rt = inferType(e.rhs, sym, ctx);
      if (e.op === "!") checkCondition(e.rhs, rt, sym, errors, '"!"');
      else if (isKnown(rt, sym) && !isNumeric(rt, sym)) {
        errors.push({
          code: "E0201",
          kind: "type-mismatch",
          message: `Operator "-" expects a number but got ${typeToString(rt as TypeExpr)}`,
          pos: e.rhs.pos,
        });
      }
      return;
    }
    case "FieldAccess":
      checkExpr(e.base, sym, errors, ctx);
      classifyFieldAccess(e, sym, errors, ctx);
      return;
    case "Index":
      checkExpr(e.base, sym, errors, ctx);
      checkExpr(e.index, sym, errors, ctx);
      return;
    case "Call":
      // `run-reducer(name)` takes a reducer, not a value, and lowers only
      // inside a generated property-test trial — so it is absent from the
      // callee tables on purpose. `checkTest` resolves the name and the count
      // there; walking it here would report the callee as undefined and the
      // reducer as a name.
      if (ctx.kind === "test" && e.callee === "run-reducer") {
        reportRunReducerPosition(ctx, e.pos, errors);
        return;
      }
      for (const a of e.args) checkExpr(a, sym, errors, ctx);
      checkCallee(e.callee, e.args, e.pos, sym, errors, ctx);
      return;
    case "MethodCall":
      // The chained spelling of the same thing: `run-reducer(inc).run-reducer(dec)`.
      if (ctx.kind === "test" && e.method === "run-reducer") {
        checkExpr(e.receiver, sym, errors, ctx);
        reportRunReducerPosition(ctx, e.pos, errors);
        return;
      }
      if (!KNOWN_METHODS.has(e.method)) {
        errors.push({
          code: "E0801",
          kind: "unimplemented-method",
          message: `Method ".${e.method}" is not implemented by the runtime`,
          pos: e.pos,
        });
      }
      // `Math.round("hello")` is `NaN`, and the method-call branch asked only
      // whether the runtime knows the *name*. Same rule as the field-access
      // branch below, and it has to be in both: the two spellings of one
      // member cannot disagree about whose member it is.
      if (NUMERIC_MEMBERS.has(e.method)) {
        const rt = inferType(e.receiver, sym, ctx);
        if (isKnown(rt, sym) && !isNumeric(rt, sym)) {
          errors.push({
            code: "E0108",
            kind: "undef-member",
            message: `Type "${typeName(rt, sym)}" has no member ".${e.method}" — it is a method of Int / Float`,
            pos: e.pos,
          });
        }
      }
      {
        // A method whose lowering reads arguments it was not given crashes
        // codegen with a bare `TypeError` and no position — so `check` says ok
        // and `build` dies. Reported here, where the position is.
        const min = METHOD_MIN_ARGS.get(e.method);
        if (min !== undefined && e.args.length < min) {
          errors.push({
            code: "E0213",
            kind: "call-arity-mismatch",
            message: `Method ".${e.method}" expects ${min} argument(s) but got ${e.args.length}`,
            pos: e.pos,
          });
        }
      }
      checkExpr(e.receiver, sym, errors, ctx);
      if (e.method === "copy") checkRecordUpdate(e, sym, errors, ctx);
      for (const a of e.args) {
        // Inside a method-call argument `$1` / `$2` are the implicit lambda's
        // parameters, and they SHADOW any outer ones — a tile that declares
        // `in=TaskId` binds `$1` to it, and `dueDate.map(formatDate($1))`
        // inside that tile is a different `$1`. The element type is left
        // undecided: which argument a method binds is per-method, and guessing
        // wrong costs a diagnostic on a working program.
        const inner = innerScope(ctx);
        bindLocal(inner, "$1", null);
        bindLocal(inner, "$2", null);
        checkExpr(a, sym, errors, inner);
      }
      if (e.method === "get-or") {
        // The fallback is the value the call produces on the empty case, so it
        // is checked against what the call answers. Reported under E0201
        // whatever position the call sits in — including inside an `emit`
        // argument, where the mismatch is against the method's own signature
        // and not against the effect's `in=` type.
        const want = getOrResultType(
          unaliasType(inferType(e.receiver, sym, ctx), sym),
          e.args.length,
        );
        const fallback = e.args.at(-1);
        if (want !== null && fallback !== undefined) checkAgainst(fallback, want, sym, errors, ctx);
      }
      return;
    case "Wildcard":
      // In the two positions `checkTest`'s dedicated passes walk — anywhere in
      // a `given`, and a reducer-test `expect` — reporting here as well would
      // make one mistake two diagnostics. Everywhere else in a test body this
      // is the only report there is: a wildcard in an invariant lowers to a
      // sentinel, so the property is falsified on every trial and rendered as
      // a counterexample against the code under test.
      if (ctx.wildcardsReportedElsewhere) return;
      errors.push({
        code: "E0109",
        kind: "test-wildcard-misuse",
        message: `Test wildcard "${wildcardText(e)}" is only valid inside a reducer-test \`expect\``,
        pos: e.pos,
      });
      return;
    case "RecordLit":
      for (const f of e.fields) checkExpr(f.value, sym, errors, ctx);
      return;
    case "ListLit":
    case "TupleLit":
      for (const it of e.items) checkExpr(it, sym, errors, ctx);
      return;
    case "MapLit":
      for (const ent of e.entries) {
        checkExpr(ent.key, sym, errors, ctx);
        checkExpr(ent.value, sym, errors, ctx);
      }
      return;
    case "MatchExpr": {
      checkExpr(e.scrutinee, sym, errors, ctx);
      const scrutType = inferType(e.scrutinee, sym, ctx);
      for (const arm of e.arms) {
        const inner = innerScope(ctx);
        checkPatternBindsAreDistinct(arm.pattern, errors);
        checkPatternAgainstType(arm.pattern, scrutType, sym, errors, inner);
        checkExpr(arm.body, sym, errors, inner);
      }
      return;
    }
    case "IfExpr":
      checkExpr(e.cond, sym, errors, ctx);
      checkCondition(e.cond, inferType(e.cond, sym, ctx), sym, errors, '"if"');
      checkExpr(e.consequent, sym, errors, ctx);
      checkExpr(e.alternate, sym, errors, ctx);
      return;
    case "LetIn": {
      checkExpr(e.value, sym, errors, ctx);
      const inner: Ctx = {
        ...ctx,
        localBinds: new Set(ctx.localBinds),
        localTypes: new Map(ctx.localTypes),
      };
      bindLocal(inner, e.name, inferType(e.value, sym, inner));
      checkExpr(e.body, sym, errors, inner);
      return;
    }
    case "TokenRef":
      if (!KNOWN_TOKEN_GROUPS.has(e.group)) {
        errors.push({
          code: "E0110",
          kind: "unknown-token-group",
          message: `Unknown theme token group "@${e.group}" (allowed: ${[...KNOWN_TOKEN_GROUPS].join(", ")})`,
          pos: e.pos,
        });
      }
      return;
    case "EmitExpr":
      // `emit X(...)` is a dispatch — it has side effects (the effect queue is
      // populated). Allowed only in a reducer body, mirroring statement-form
      // `emit` (parsed only inside `parseStatement`). A fn / slot-init / tile
      // body that "yields an EffectId" would have nowhere meaningful to send
      // the dispatch.
      if (ctx.kind !== "reducer") {
        errors.push({
          code: "E0305",
          kind: "fn-impurity",
          message: `emit "${e.effect}" used as an expression is only allowed inside a reducer body`,
          pos: e.pos,
        });
        return;
      }
      checkEmitTarget(e.effect, e.args, sym, errors, ctx, e.pos);
      for (const a of e.args) checkExpr(a, sym, errors, ctx);
      return;
  }
}

const COMPARISON_OPS: ReadonlySet<string> = new Set(["<", ">", "<=", ">="]);
const BOOLEAN_OPS: ReadonlySet<string> = new Set(["&", "|"]);
const EQUALITY_OPS: ReadonlySet<string> = new Set(["==", "!="]);

/**
 * The set an ordering comparison is defined within. Two operands compare only
 * when they land in the same one — `Int < Text` has no answer the runtime could
 * give that is not an accident of JavaScript's coercion rules.
 */
function orderingFamily(t: TypeExpr | null, sym: SymbolTable): string | null {
  if (isNumeric(t, sym)) return "number";
  if (isPrimNamed(t, sym, "Text")) return "text";
  if (isPrimNamed(t, sym, "Time")) return "time";
  return null;
}

function binOpResult(e: Expr & { kind: "BinOp" }, sym: SymbolTable, ctx: Ctx): TypeExpr | null {
  if (COMPARISON_OPS.has(e.op) || BOOLEAN_OPS.has(e.op) || EQUALITY_OPS.has(e.op))
    return prim("Bool", e.pos);
  const lt = inferType(e.lhs, sym, ctx);
  const rt = inferType(e.rhs, sym, ctx);
  if (e.op === "+") {
    // `+` is the one overloaded operator: `Text` on either side concatenates
    // and stringifies the other. An operand we cannot type might be that
    // `Text`, so a sum with one is undecidable rather than numeric.
    if (isPrimNamed(lt, sym, "Text") || isPrimNamed(rt, sym, "Text")) return prim("Text", e.pos);
    if (!isKnown(lt, sym) || !isKnown(rt, sym)) return null;
  }
  return arithmeticResult(e.op, lt, rt, sym, e.pos);
}

function checkBinOpOperands(
  e: Expr & { kind: "BinOp" },
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  const lt = inferType(e.lhs, sym, ctx);
  const rt = inferType(e.rhs, sym, ctx);
  const sides = [
    [lt, e.lhs],
    [rt, e.rhs],
  ] as const;

  const requireNumeric = (): void => {
    for (const [t, side] of sides) {
      if (isKnown(t, sym) && !isNumeric(t, sym)) {
        errors.push({
          code: "E0201",
          kind: "type-mismatch",
          message: `Operator "${e.op}" expects a number but got ${typeToString(t as TypeExpr)}`,
          pos: side.pos,
        });
      }
    }
  };

  if (e.op === "+") {
    if (isPrimNamed(lt, sym, "Text") || isPrimNamed(rt, sym, "Text")) return;
    // Neither side is known to be `Text`, but an unknown one could be — only a
    // sum whose operands are both resolved can be judged.
    if (!isKnown(lt, sym) || !isKnown(rt, sym)) return;
    requireNumeric();
    return;
  }
  if (e.op === "-" || e.op === "*" || e.op === "/" || e.op === "%") {
    requireNumeric();
    return;
  }
  if (BOOLEAN_OPS.has(e.op)) {
    for (const [t, side] of sides) {
      if (isKnown(t, sym) && !isPrimNamed(t, sym, "Bool")) {
        errors.push({
          code: "E0201",
          kind: "type-mismatch",
          message: `Operator "${e.op}" expects Bool but got ${typeToString(t as TypeExpr)}`,
          pos: side.pos,
        });
      }
    }
    return;
  }
  if (COMPARISON_OPS.has(e.op)) {
    if (!isKnown(lt, sym) || !isKnown(rt, sym)) return;
    const lf = orderingFamily(lt, sym);
    if (lf !== null && lf === orderingFamily(rt, sym)) return;
    errors.push({
      code: "E0201",
      kind: "type-mismatch",
      message: `Operator "${e.op}" cannot compare ${typeToString(lt as TypeExpr)} with ${typeToString(rt as TypeExpr)}`,
      pos: e.pos,
    });
  }
  // `==` / `!=` are defined on every type, including across an Option and its
  // None, so there is nothing here to reject.
}

/** A condition — `if`, `when`, `!` — must be a `Bool` when its type is known. */
function checkCondition(
  e: Expr,
  t: TypeExpr | null,
  sym: SymbolTable,
  errors: KumikiError[],
  site: string,
): void {
  if (!isKnown(t, sym) || isPrimNamed(t, sym, "Bool")) return;
  errors.push({
    code: "E0201",
    kind: "type-mismatch",
    message: `Condition of ${site} must be Bool but got ${typeToString(t as TypeExpr)}`,
    pos: e.pos,
  });
}

/**
 * The code a value mismatch is reported under, and the `kind` that goes with
 * it. `emit` reports its argument as E0202 — the diagnostic that already told
 * authors to look at the effect's `in=` type — and everything else as E0201.
 * The pair is derived in one place so the two can never be assembled apart.
 */
const MISMATCH_KIND = {
  E0201: "type-mismatch",
  E0202: "emit-arg-type-mismatch",
} as const;

type MismatchCode = keyof typeof MISMATCH_KIND;

function pushMismatch(errors: KumikiError[], code: MismatchCode, message: string, pos: Pos): void {
  errors.push({ code, kind: MISMATCH_KIND[code], message, pos });
}

/**
 * Check `e` against the type the site declares, reporting at the innermost
 * expression that is wrong.
 *
 * The literal forms are matched against the declared shape directly rather than
 * inferred and compared, because that is the only way a diagnostic can point at
 * the offending element: `[1, "a"]` against `List(Int)` names `"a"`, and a
 * record literal names the field. Everything else falls back to `inferType` +
 * `assignable`, which stay silent whenever either side is undecidable.
 *
 * `code` exists because `emit` reports its argument under its own code
 * (E0202) — the diagnostic that already told authors to look at the effect's
 * `in=` type.
 */
function checkAgainst(
  e: Expr,
  declared: TypeExpr | null,
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
  code: MismatchCode = "E0201",
): void {
  if (declared === null) return;
  const d = unaliasType(declared, sym);
  if (d === null || d.kind === "TypeRef") return; // opaque: a type parameter, or a name that resolves to nothing

  const mismatch = (at: Expr, actual: TypeExpr): void => {
    pushMismatch(
      errors,
      code,
      `Expected ${typeToString(declared)} but got ${typeToString(actual)}`,
      at.pos,
    );
  };

  if (d.kind === "TypeApp" && (d.name === "List" || d.name === "Set") && e.kind === "ListLit") {
    for (const item of e.items) checkAgainst(item, d.args[0] ?? null, sym, errors, ctx, code);
    return;
  }
  if (d.kind === "TypeApp" && d.name === "Tuple" && e.kind === "TupleLit") {
    // Arity first, and on its own: a tuple's length IS its type, unlike a
    // list's. `assignable` compares argument lists pairwise and treats a
    // missing one as agreeing — right for `List`, where the count is the
    // constructor's own arity, and wrong here, where `Tuple(Int, Int, Int) =
    // (1, 2)` would reach codegen and lower to a pattern guard that never
    // matches, writing `undefined` into the slot.
    if (e.items.length !== d.args.length) {
      pushMismatch(
        errors,
        code,
        `Expected ${typeToString(declared)} but got a tuple of ${e.items.length} item(s)`,
        e.pos,
      );
      return;
    }
    // Then position by position, so the diagnostic names the item rather than
    // the whole tuple.
    for (let i = 0; i < e.items.length; i++) {
      checkAgainst(e.items[i] as Expr, d.args[i] ?? null, sym, errors, ctx, code);
    }
    return;
  }
  if (d.kind === "TypeApp" && e.kind === "MapLit") {
    // A `Set` is written `{}` and nothing else: the grammar has no non-empty
    // set literal (`{"a", "b"}` does not parse, and `{a, b}` is a record), so
    // an entry can only come from a `Map`. Both are the same node kind, which
    // is why the declared type decides.
    if (d.name === "Set") return;
    if (d.name === "Map") {
      for (const ent of e.entries) {
        checkAgainst(ent.key, d.args[0] ?? null, sym, errors, ctx, code);
        checkAgainst(ent.value, d.args[1] ?? null, sym, errors, ctx, code);
      }
      return;
    }
  }
  if (d.kind === "TypeRecord" && e.kind === "RecordLit") {
    checkRecordLit(e, d, sym, errors, ctx, code);
    return;
  }
  if (e.kind === "Variant") {
    checkVariantAgainst(e, d, declared, sym, errors, ctx, code);
    return;
  }
  if (e.kind === "IfExpr") {
    // Both branches land in this position, and reporting at the branch beats
    // reporting at the `if`.
    checkAgainst(e.consequent, declared, sym, errors, ctx, code);
    checkAgainst(e.alternate, declared, sym, errors, ctx, code);
    return;
  }
  if (
    e.kind === "Num" &&
    d.kind === "TypePrim" &&
    d.name === "Int" &&
    Number.isInteger(e.value) &&
    !Number.isSafeInteger(e.value)
  ) {
    errors.push({
      code: "E0217",
      kind: "int-literal-precision",
      // `e.value` is already the rounded double, so the literal as written has
      // to come from the lexeme — reporting `e.value` on both sides of "was
      // rounded to" says the number was rounded to itself.
      message: `Int literal ${e.raw ?? e.value} is not exactly representable and was rounded to ${e.value}`,
      pos: e.pos,
    });
    return;
  }

  const actual = inferType(e, sym, ctx);
  if (actual === null || !isKnown(actual, sym)) return;
  if (!assignable(actual, declared, sym)) mismatch(e, actual);
}

/**
 * `r.copy(f=v)` names fields of `r`'s type and replaces them. Unlike a record
 * literal it is a *patch*, so naming only some fields is the point and a
 * missing one is never an error — but naming one the type does not have is,
 * and so is a replacement value of the wrong type. Both used to lower to a
 * spread that silently added a property nothing reads.
 */
function checkRecordUpdate(
  e: Expr & { kind: "MethodCall" },
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  const patch = e.args[0];
  if (patch?.kind !== "RecordLit") return;
  const recv = unaliasType(inferType(e.receiver, sym, ctx), sym);
  if (recv?.kind !== "TypeRecord") return;
  for (const f of patch.fields) {
    const want = recordFieldType(recv, f.name);
    if (want === null) {
      errors.push({
        code: "E0215",
        kind: "unknown-record-field",
        message: `Record type has no field "${f.name}"`,
        pos: f.value.pos,
      });
      continue;
    }
    checkAgainst(f.value, want, sym, errors, ctx);
  }
}

function checkRecordLit(
  e: Expr & { kind: "RecordLit" },
  d: TypeExpr & { kind: "TypeRecord" },
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
  code: MismatchCode,
): void {
  const given = new Set(e.fields.map((f) => f.name));
  for (const declaredField of d.fields) {
    if (given.has(declaredField.name)) continue;
    errors.push({
      code: "E0214",
      kind: "missing-record-field",
      message: `Record literal is missing field "${declaredField.name}" of type ${typeToString(declaredField.type)}`,
      pos: e.pos,
    });
  }
  for (const f of e.fields) {
    const want = recordFieldType(d, f.name);
    if (want === null) {
      errors.push({
        code: "E0215",
        kind: "unknown-record-field",
        message: `Record type has no field "${f.name}"`,
        pos: f.value.pos,
      });
      continue;
    }
    checkAgainst(f.value, want, sym, errors, ctx, code);
  }
}

/**
 * A variant constructor is the one expression whose type comes entirely from
 * the position it sits in: `Idle` names a tag, and only the declared type says
 * which union that tag belongs to.
 */
function checkVariantAgainst(
  e: Expr & { kind: "Variant" },
  d: TypeExpr,
  declared: TypeExpr,
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
  code: MismatchCode,
): void {
  const payloadsOf = (): TypeExpr[] | "unknown-tag" | null => {
    if (d.kind === "TypeUnion") {
      const v = d.variants.find((variant) => variant.name === e.name);
      return v ? v.payloads : "unknown-tag";
    }
    if (d.kind === "TypeApp" && d.name === "Option") {
      if (e.name === "None") return [];
      if (e.name === "Some") return [d.args[0] ?? unknownType(e.pos)];
      return "unknown-tag";
    }
    if (d.kind === "TypeApp" && d.name === "Result") {
      if (e.name === "Ok") return [d.args[0] ?? unknownType(e.pos)];
      if (e.name === "Err") return [d.args[1] ?? unknownType(e.pos)];
      return "unknown-tag";
    }
    return null;
  };

  const payloads = payloadsOf();
  if (payloads === null) {
    // The declared type is not a union at all — `slot n : Int = Idle`.
    pushMismatch(
      errors,
      code,
      `Expected ${typeToString(declared)} but got variant "${e.name}"`,
      e.pos,
    );
    return;
  }
  if (payloads === "unknown-tag") {
    errors.push({
      code: "E0216",
      kind: "unknown-variant",
      message: `Variant "${e.name}" is not a member of type "${typeToString(declared)}"`,
      pos: e.pos,
    });
    return;
  }
  if (payloads.length !== e.payload.length) {
    errors.push({
      code: "E0213",
      kind: "call-arity-mismatch",
      message: `Variant "${e.name}" carries ${payloads.length} payload(s) but got ${e.payload.length}`,
      pos: e.pos,
    });
    return;
  }
  e.payload.forEach((p, i) => {
    checkAgainst(p, payloads[i] ?? null, sym, errors, ctx, code);
  });
}

/**
 * What `.get` unwraps a type to — `Option(T)` / `Result(T, E)` to `T`, and
 * `null` for anything else. One resolver, read by the rvalue path and the
 * lvalue one alike, so the two cannot come to disagree about what it reaches.
 */
function unwrappedType(t: TypeExpr): TypeExpr | null {
  if (t.kind !== "TypeApp") return null;
  if (t.name !== "Option" && t.name !== "Result") return null;
  return t.args[0] ?? null;
}

/**
 * What `.get-or(…)` answers — `Option(T)` / `Result(T, E)` to `T`, `Map(K, V)`
 * to `V` (stdlib.md §2.2.4 / §2.2.5 / §2.2.1), and `null` for a receiver that
 * decides nothing. Separate from `unwrappedType` because a Map is not unwrapped
 * by either member: `.get` on one *wraps*, into `Option(V)`.
 *
 * It is also the type the fallback must have, which is why one resolver serves
 * both readers: the fallback is what the call evaluates to when there is
 * nothing to unwrap, so a fallback of another type *is* the value the program
 * gets on the empty case. Two tables could disagree about that.
 *
 * The argument count is part of the question rather than a check beside it: the
 * lowering tells the Map reading from the unwrapping one by counting arguments
 * (`codegen/expr.ts`, `case "get-or"`), so a call whose count does not fit its
 * receiver has no result type to speak of and stays undecidable here — while
 * still lowering to the reading its count names.
 */
function getOrResultType(recv: TypeExpr | null, argCount: number): TypeExpr | null {
  if (recv?.kind !== "TypeApp") return null;
  if (recv.name === "Map") return argCount === 2 ? (recv.args[1] ?? null) : null;
  return argCount === 1 ? unwrappedType(recv) : null;
}

/**
 * The declared type of an assignment target, walking `.field` and `[k]` through
 * the slot's type. `null` wherever the path leaves what the type system knows.
 */
function lvalueType(lv: Lvalue, sym: SymbolTable): TypeExpr | null {
  if (lv.kind === "LSlot") return sym.slots.get(lv.name)?.type ?? null;
  const base = unaliasType(lvalueType(lv.base, sym), sym);
  if (!base) return null;
  if (lv.kind === "LField") {
    // A record's own field wins over the shortcut name (stdlib.md §2.2), which
    // is what keeps `get` writable as a field on a record that declares one.
    if (base.kind === "TypeRecord") return recordFieldType(base, lv.field);
    if (lv.field === "get") return unwrappedType(base);
    return null;
  }
  if (base.kind === "TypeApp") {
    if (base.name === "List" || base.name === "Set") return base.args[0] ?? null;
    if (base.name === "Map") return base.args[1] ?? null;
  }
  return null;
}

/**
 * Common emit-call validation shared by `Statement.Emit` (line ~655) and the
 * `Expr.EmitExpr` form used in `let id = emit X(...)`. Checks the effect is
 * defined, its capability is available, and — when both sides have a known
 * type — that the first arg matches the effect's `in` type (the catch for
 * `emit cancel(slotOfWrongType)`).
 */
function checkEmitTarget(
  effect: string,
  args: Expr[],
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
  pos: Pos,
): void {
  const eff = sym.effects.get(effect);
  if (!eff && !BUILTIN_EFFECT_CAPS.has(effect)) {
    errors.push({
      code: "E0104",
      kind: "undef-effect",
      message: `Reference to undefined effect "${effect}"`,
      pos,
    });
    return;
  }
  // A built-in effect has no `effect` declaration to read a `cap=` off, so the
  // requirement comes from the table instead — the DOM runtime gates it either
  // way. `null` is the one entry that asks for nothing; an empty `cap=` on a
  // declared effect is not that, and stays reportable.
  const cap = eff ? eff.cap : (BUILTIN_EFFECT_CAPS.get(effect) ?? null);
  if (cap !== null && ctx.capsAvailable && !ctx.capsAvailable.has(cap)) {
    errors.push({
      code: "E0301",
      kind: "missing-capability",
      message: `Effect "${effect}" requires capability "${cap}" which is not declared in app.caps`,
      pos,
    });
  }
  if (!eff) return;
  // `in=Unit` is the "no input" declaration, so the effect takes no argument;
  // every other `in=` takes exactly one. Codegen destructures the argument, so
  // a missing one is `Cannot destructure property 'key' of 'input'` at the
  // first dispatch rather than a diagnostic.
  const wants = isPrimNamed(eff.inType, sym, "Unit") ? 0 : 1;
  if (args.length !== wants) {
    errors.push({
      code: "E0213",
      kind: "call-arity-mismatch",
      message: `Effect "${effect}" expects ${wants} argument(s) but got ${args.length}`,
      pos,
    });
    return;
  }
  const arg = args[0];
  if (!arg) return;
  // The EffectId case keeps its own wording: the fix is never "convert the
  // value" but "pass the handle an earlier emit returned".
  if (isPrimNamed(eff.inType, sym, "EffectId")) {
    const actual = inferType(arg, sym, ctx);
    if (actual && !isPrimNamed(actual, sym, "EffectId")) {
      errors.push({
        code: "E0202",
        kind: "emit-arg-type-mismatch",
        message: `emit "${effect}" expects an EffectId argument`,
        pos,
      });
    }
    return;
  }
  checkAgainst(arg, eff.inType, sym, errors, ctx, "E0202");
}

// Closed set of theme token namespaces (spec/style.md §4.2). The token name
// itself (the path beneath the group) is intentionally NOT validated here:
// themes can be slot-driven and swap at runtime, so the runtime resolver does
// the lookup with a graceful fallback to the spec's built-in defaults.
const KNOWN_TOKEN_GROUPS: ReadonlySet<string> = new Set([
  "colors",
  "spacing",
  "radius",
  "shadow",
  "typography",
  "breakpoints",
]);

// ===== Receiver type inference (ADR-002, #23) =====
// A minimal, dispatch-directed inferencer: just enough to tell a record field
// from a stdlib method shortcut, and to flag an unknown member on a known
// receiver type (E0108). It returns `null` whenever the type can't be decided —
// inference never guesses, so an untyped receiver keeps the historical
// name-based shortcut dispatch with no diagnostic.

const SCALAR_PRIMS = new Set(["Int", "Float", "Text", "Bool", "Time", "Bytes", "File"]);
const STDLIB_CONTAINERS = new Set(["List", "Map", "Set", "Option", "Result"]);

/**
 * Structural fields exposed by built-in prim types. `File` is treated as a
 * scalar at the type system level (its handle is opaque, never inspected by
 * the compiler) but the runtime stores it as a record so Kumiki expressions
 * can read its metadata — `f.name : Text`, `f.size : Int`, `f.type : Text`
 * (docs/spec/stdlib.md §2.1). Without this table classifyFieldAccess would
 * emit E0108 on every legitimate File field read.
 */
const PRIM_FIELDS: Record<string, Record<string, "Text" | "Int">> = {
  File: { name: "Text", size: "Int", type: "Text" },
};

function primFieldType(primName: string, field: string, pos: Pos): TypeExpr | null {
  const name = PRIM_FIELDS[primName]?.[field];
  if (!name) return null;
  return { kind: "TypePrim", name, pos };
}

const prim = (name: PrimName, pos: Pos): TypeExpr => ({ kind: "TypePrim", name, pos });
const container = (name: string, args: TypeExpr[], pos: Pos): TypeExpr => ({
  kind: "TypeApp",
  name,
  args,
  pos,
});

type PrimName = Extract<TypeExpr, { kind: "TypePrim" }>["name"];

/** True when `t` is a number — the operand family arithmetic is defined on. */
function isNumeric(t: TypeExpr | null, sym: SymbolTable): boolean {
  const u = unaliasType(t, sym);
  return u?.kind === "TypePrim" && (u.name === "Int" || u.name === "Float");
}

/** True when `t` resolved to a concrete shape, so a mismatch against it is real. */
function isKnown(t: TypeExpr | null, sym: SymbolTable): boolean {
  return t !== null && !isOpaque(t, sym);
}

/** How a resolved type is named in a diagnostic. */
function typeName(t: TypeExpr | null, sym: SymbolTable): string {
  const u = unaliasType(t, sym);
  if (!u) return "unknown";
  if (u.kind === "TypePrim") return u.name;
  if (u.kind === "TypeApp") return u.name;
  if (u.kind === "TypeRecord") return "record";
  return "unknown";
}

function isPrimNamed(t: TypeExpr | null, sym: SymbolTable, name: PrimName): boolean {
  const u = unaliasType(t, sym);
  return u?.kind === "TypePrim" && u.name === name;
}

/**
 * Result types of the methods whose answer is fixed regardless of the receiver
 * (docs/spec/stdlib.md §2.2). Deliberately short: a method whose result depends
 * on the receiver's type argument (`.head`, `.map`, `.filter`) stays undecidable
 * rather than being guessed, because a wrong answer here becomes a wrong
 * diagnostic on a working program.
 */
const METHOD_RESULT: ReadonlyMap<string, PrimName> = new Map<string, PrimName>([
  ["show", "Text"],
  ["to-int", "Int"],
  ["to-float", "Float"],
  ["floor", "Int"],
  ["ceil", "Int"],
  ["round", "Int"],
  ["sqrt", "Float"],
  ["log", "Float"],
  ["exp", "Float"],
  // `pow` is absent because it has no fixed result: `2.pow(3)` is an Int and
  // `2.pow(-1)` is 0.5, so the receiver does not decide it either. Nothing else
  // assigns it one, so a `pow` expression is accepted against any target — the
  // permissiveness `min` / `max` / `clamp` have always had.
]);

/**
 * Result types of the built-in calls that have one. `panic` never returns and
 * `Decoder.*` produce an opaque sentinel, so both stay undecidable.
 */
const CALL_RESULT: ReadonlyMap<string, PrimName> = new Map<string, PrimName>([
  ["now", "Time"],
  ["random", "Float"],
  ["fmt", "Text"],
  ["file-url", "Text"],
  ["prefers-dark", "Bool"],
  ["EffectId.none", "EffectId"],
]);

/**
 * The type an arithmetic expression produces. `/` is the exception: it is
 * JavaScript's `/` at runtime, so `5 / 2` is `2.5` and the type has to say so
 * (docs/spec/language.md §1.9.4). Anything else is `Float` when either operand
 * is, and `Int` otherwise — including when an operand was rejected above, so a
 * bad operand costs one diagnostic instead of cascading into the surrounding
 * expression.
 */
function arithmeticResult(
  op: string,
  lt: TypeExpr | null,
  rt: TypeExpr | null,
  sym: SymbolTable,
  pos: Pos,
): TypeExpr {
  if (op === "/") return prim("Float", pos);
  const float = isPrimNamed(lt, sym, "Float") || isPrimNamed(rt, sym, "Float");
  return prim(float ? "Float" : "Int", pos);
}

/** Best-effort static type of an expression; `null` = undecidable / dynamic. */
function inferType(e: Expr, sym: SymbolTable, ctx: Ctx): TypeExpr | null {
  switch (e.kind) {
    case "Num":
      // The lexer has no exponent form, so an integral value came from integral
      // digits. `1.0` reads as `Int`, which costs nothing: Int widens to Float.
      return prim(Number.isInteger(e.value) ? "Int" : "Float", e.pos);
    case "Str":
      return { kind: "TypePrim", name: "Text", pos: e.pos };
    case "Bool":
      return { kind: "TypePrim", name: "Bool", pos: e.pos };
    case "Ref": {
      const bound = ctx.localTypes.get(e.name);
      if (bound) return bound;
      return sym.slots.get(e.name)?.type ?? null;
    }
    case "FieldAccess": {
      const base = unaliasType(inferType(e.base, sym, ctx), sym);
      if (!base) return null;
      if (base.kind === "TypeRecord") return recordFieldType(base, e.field);
      if (base.kind === "TypePrim") {
        const t = primFieldType(base.name, e.field, e.pos);
        if (t) return t;
      }
      // `.get` unwraps Option(T) / Result(T,E) → T
      if (e.field === "get") {
        const inner = unwrappedType(base);
        if (inner) return inner;
      }
      // Paren-less method shortcut (`n.show`, `f.to-int`) — same table as the
      // called form, reached here because the parser produces a FieldAccess
      // for a member with no argument list.
      const fixed = METHOD_RESULT.get(e.field);
      return fixed ? prim(fixed, e.pos) : null;
    }
    case "Index": {
      const base = unaliasType(inferType(e.base, sym, ctx), sym);
      if (base?.kind === "TypeApp") {
        if (base.name === "List" || base.name === "Set") return base.args[0] ?? null;
        if (base.name === "Map") return base.args[1] ?? null;
      }
      return null;
    }
    case "MethodCall": {
      // `.get(k)` on a Map → Option(V) (spec: a missing key is None — the common
      // `m.get(k).get` / `.get-or(d)` shape relies on this). `.get()` on
      // Option/Result → inner. Anything else stays dynamic (conservative).
      if (e.method === "get") {
        const recv = unaliasType(inferType(e.receiver, sym, ctx), sym);
        if (recv?.kind === "TypeApp") {
          if (recv.name === "Map")
            return recv.args[1] ? container("Option", [recv.args[1]], e.pos) : null;
          if (recv.name === "Option" || recv.name === "Result") return recv.args[0] ?? null;
        }
      }
      // `.get-or(d)` resolves from its receiver the way `.get` does, and a Map
      // lookup with a fallback answers V. Without this the unwrapped value was
      // assignable to the container it came out of.
      if (e.method === "get-or") {
        const recv = unaliasType(inferType(e.receiver, sym, ctx), sym);
        return getOrResultType(recv, e.args.length);
      }
      // `r.copy(f=v)` is record update — same type in, same type out.
      if (e.method === "copy") return inferType(e.receiver, sym, ctx);
      const fixed = METHOD_RESULT.get(e.method);
      return fixed ? prim(fixed, e.pos) : null;
    }
    case "RecordLit":
      return {
        kind: "TypeRecord",
        fields: e.fields.map((f) => ({
          name: f.name,
          // A field whose value cannot be typed must stay unknown, not become
          // `Unit`: `Unit` is a real type and would be compared as one, so an
          // undecidable field would read as a mismatch against every declared
          // field type.
          type: inferType(f.value, sym, ctx) ?? unknownType(f.value.pos),
          pos: f.pos ?? f.value.pos,
        })),
        pos: e.pos,
      };
    case "ListLit": {
      // Only a literal whose items all agree yields an element type; a mixed
      // literal is wrong wherever it lands, and the site that has a declared
      // type reports it precisely (`checkAgainst` walks the items).
      const elem = commonType(
        e.items.map((it) => inferType(it, sym, ctx)),
        sym,
      );
      return container("List", [elem ?? unknownType(e.pos)], e.pos);
    }
    case "TupleLit":
      // Position by position, unlike a list: a tuple's items are allowed to
      // disagree, which is the whole reason to write one.
      return container(
        "Tuple",
        e.items.map((it) => inferType(it, sym, ctx) ?? unknownType(it.pos)),
        e.pos,
      );
    case "MapLit": {
      // `{}` is both the empty map and the only set literal the grammar has,
      // so an entry-less literal says nothing about which it is.
      if (e.entries.length === 0) return null;
      const k = commonType(
        e.entries.map((ent) => inferType(ent.key, sym, ctx)),
        sym,
      );
      const v = commonType(
        e.entries.map((ent) => inferType(ent.value, sym, ctx)),
        sym,
      );
      return container("Map", [k ?? unknownType(e.pos), v ?? unknownType(e.pos)], e.pos);
    }
    case "Variant": {
      const inner = e.payload[0]
        ? (inferType(e.payload[0], sym, ctx) ?? unknownType(e.pos))
        : unknownType(e.pos);
      if (e.name === "Some") return container("Option", [inner], e.pos);
      // `None` says nothing about the element type — `Option(Unit)` would make
      // it a mismatch against every `Option(T)` there is.
      if (e.name === "None") return container("Option", [unknownType(e.pos)], e.pos);
      if (e.name === "Ok") return container("Result", [inner, unknownType(e.pos)], e.pos);
      if (e.name === "Err") return container("Result", [unknownType(e.pos), inner], e.pos);
      // A user union's tag names its type only via the declared side, which
      // `checkAgainst` has; from the expression alone it is undecidable.
      return null;
    }
    case "BinOp":
      return binOpResult(e, sym, ctx);
    case "UnaryOp": {
      if (e.op === "!") return prim("Bool", e.pos);
      const rt = inferType(e.rhs, sym, ctx);
      return isNumeric(rt, sym) ? rt : null;
    }
    case "IfExpr": {
      return commonType([inferType(e.consequent, sym, ctx), inferType(e.alternate, sym, ctx)], sym);
    }
    case "EmitExpr":
      // spec http.md §6.4 / stdlib §2.1.1.1: `emit X(...)` as an expression
      // yields the dispatched effect's EffectId.
      return prim("EffectId", e.pos);
    case "Call": {
      const fixed = CALL_RESULT.get(e.callee);
      if (fixed) return prim(fixed, e.pos);
      // `Duration.ms(500)` and friends build the standard library's `Duration`;
      // `Bytes.from-text(t)` builds `Bytes` (stdlib §2.2.10).
      const qualifier = e.callee.includes(".") ? e.callee.slice(0, e.callee.indexOf(".")) : null;
      if (qualifier === "Duration") return { kind: "TypeRef", name: "Duration", pos: e.pos };
      if (qualifier === "Bytes") return prim("Bytes", e.pos);
      return sym.fns.get(e.callee)?.ret ?? null;
    }
    default:
      return null;
  }
}

/**
 * The single type a set of inferred types all agree on, or `null` when they do
 * not — including when any of them is undecidable. Used where a form has
 * several sources for one type (list items, `if` branches) and guessing one of
 * them would be worse than saying nothing.
 */
function commonType(types: (TypeExpr | null)[], sym: SymbolTable): TypeExpr | null {
  const first = types[0];
  if (types.length === 0 || !first) return null;
  for (const t of types.slice(1)) {
    if (!t) return null;
    if (!assignable(t, first, sym) || !assignable(first, t, sym))
      return sharedBase(types, first, sym);
  }
  return first;
}

/**
 * The base every one of `types` meets, when they do not all meet each other.
 *
 * Assignability is not transitive across `nominal`: a `Cents` and a `Yen` both
 * meet `Int` and refuse each other. Answering `null` there loses every check
 * that needs the whole expression to have a type — the member on
 * `(if flag then cents else yen).x` stops being resolved — and makes a list
 * literal's answer depend on which item came first.
 *
 * Reached only after a disagreement, so the common case pays nothing. That
 * matters more than it looks: `commonType` runs at every level of a nested
 * list literal, and comparing a deep type against itself once per level took
 * the 255-deep parser-limit case from 2ms to over a second.
 */
function sharedBase(
  types: (TypeExpr | null)[],
  first: TypeExpr,
  sym: SymbolTable,
): TypeExpr | null {
  const base = unaliasType(first, sym);
  if (base === null) return null;
  const meets = (t: TypeExpr | null): boolean =>
    t !== null && assignable(t, base, sym) && assignable(base, t, sym);
  return types.every(meets) ? base : null;
}

/**
 * Decide whether `recv.field` is a record field read or a method shortcut, and
 * annotate the node so codegen lowers the right thing (ADR-002). Emits E0108
 * when the receiver type is KNOWN and `field` is neither a member nor a record
 * field; stays silent (shortcut) when the type is undecidable.
 */
function classifyFieldAccess(
  e: Expr & { kind: "FieldAccess" },
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  const t = unaliasType(inferType(e.base, sym, ctx), sym);
  if (!t) return; // dynamic — keep name-based shortcut dispatch, no diagnostic
  if (t.kind === "TypeRecord") {
    if (recordFieldType(t, e.field)) {
      e.accessKind = "field";
      return;
    }
    if (e.field === "show") {
      e.accessKind = "shortcut";
      return;
    }
    errors.push({
      code: "E0108",
      kind: "undef-member",
      message: `Record type has no field or method ".${e.field}"`,
      pos: e.pos,
    });
    return;
  }
  const isKnownReceiver =
    (t.kind === "TypePrim" && SCALAR_PRIMS.has(t.name)) ||
    (t.kind === "TypeApp" && STDLIB_CONTAINERS.has(t.name));
  if (isKnownReceiver) {
    if (t.kind === "TypePrim" && PRIM_FIELDS[t.name]?.[e.field]) {
      e.accessKind = "field";
      return;
    }
    if (KNOWN_MEMBERS.has(e.field)) {
      if (NUMERIC_MEMBERS.has(e.field) && !isNumeric(t, sym)) {
        errors.push({
          code: "E0108",
          kind: "undef-member",
          message: `Type "${typeName(t, sym)}" has no member ".${e.field}" — it is a method of Int / Float`,
          pos: e.pos,
        });
        return;
      }
      // Written without the arguments it needs. The parser produces a field
      // access when there is no argument list, so the arity check on the
      // method-call branch never saw this shape: `f.pow` reached codegen's
      // bracket fallback and wrote `undefined` into the slot. A member that is
      // legitimately argument-less is exempt by being a shortcut — `o.get` and
      // `m.get(k)` are one name with two arities.
      const min = METHOD_MIN_ARGS.get(e.field);
      if (min !== undefined && !FIELD_ACCESS_SHORTCUTS.has(e.field)) {
        errors.push({
          code: "E0213",
          kind: "call-arity-mismatch",
          message: `Method ".${e.field}" expects ${min} argument(s) but got 0`,
          pos: e.pos,
        });
        return;
      }
      e.accessKind = "shortcut";
      return;
    }
    const tn = t.kind === "TypeApp" ? t.name : (t as { name: string }).name;
    errors.push({
      code: "E0108",
      kind: "undef-member",
      message: `Type "${tn}" has no member ".${e.field}"`,
      pos: e.pos,
    });
  }
  // Any other resolved type (union, opaque type param) → leave as shortcut, no
  // diagnostic (we only flag members of types we fully understand).
}

function currentFnName(ctx: Ctx): string {
  return (ctx as Ctx & { fnName?: string }).fnName ?? "<fn>";
}

function checkFn(fn: FnDef, sym: SymbolTable, errors: KumikiError[]): void {
  const ctx: Ctx = {
    kind: "fn",
    localBinds: new Set(),
    localTypes: new Map(fn.params.map((p) => [p.name, p.type])),
    routeBind: "no-payload",
  };
  (ctx as Ctx & { fnName?: string }).fnName = fn.name;
  for (const p of fn.params) ctx.localBinds.add(p.name);
  // also bind $1, $2 used in expression-fragment style
  ctx.localBinds.add("$1");
  ctx.localBinds.add("$2");
  for (const p of fn.params) resolveType(p.type, sym, errors);
  if (fn.ret) resolveType(fn.ret, sym, errors);
  checkExpr(fn.body, sym, errors, ctx);
  checkAgainst(fn.body, fn.ret ?? null, sym, errors, ctx);
}

function checkEffect(eff: EffectDef, sym: SymbolTable, errors: KumikiError[]): void {
  resolveType(eff.inType, sym, errors);
  resolveType(eff.outType, sym, errors);
  // §6.4: an effect bound to `cap=http.cancel` cancels an in-flight effect by
  // EffectId and returns nothing. Any other shape is a misuse of the cap.
  // `policy` / `retry` / `map-request` are silently ignored by the dispatcher
  // (the cancel path returns before any of them apply), so declaring them is
  // a user-intent mismatch that we reject up front rather than let it pass.
  if (eff.cap === "http.cancel") {
    const inOk = eff.inType.kind === "TypePrim" && eff.inType.name === "EffectId";
    const outOk = eff.outType.kind === "TypePrim" && eff.outType.name === "Unit";
    if (!inOk || !outOk) {
      errors.push({
        code: "E0303",
        kind: "invalid-cancel-target",
        message: `effect "${eff.name}" with cap=http.cancel must declare in=EffectId out=Unit`,
        pos: eff.pos,
      });
    }
    if (eff.policy) {
      errors.push({
        code: "E0303",
        kind: "invalid-cancel-target",
        message: `effect "${eff.name}" with cap=http.cancel cannot declare a policy`,
        pos: eff.pos,
      });
    }
    if (eff.retry) {
      errors.push({
        code: "E0303",
        kind: "invalid-cancel-target",
        message: `effect "${eff.name}" with cap=http.cancel cannot declare retry`,
        pos: eff.pos,
      });
    }
    if (eff.mapRequest) {
      errors.push({
        code: "E0303",
        kind: "invalid-cancel-target",
        message: `effect "${eff.name}" with cap=http.cancel cannot declare map-request`,
        pos: eff.pos,
      });
    }
  }
  if (eff.mapRequest)
    checkExpr(eff.mapRequest, sym, errors, {
      kind: "slot-init", // treat as pure context (no slots, no fns)
      localBinds: new Set(["$1"]),
      routeBind: "no-payload",
      localTypes: new Map(),
    });
}

function wildcardText(e: Expr & { kind: "Wildcard" }): string {
  return e.wild === "any-id" ? "<any-id>" : `<slots.${e.slot}>`;
}

/**
 * Report a name that one pattern binds twice.
 *
 * The binds of a pattern are peers: nothing nests them, so there is no scope
 * between them for the second to shadow the first — the same reason an
 * `effect-event` bind list cannot take a positional binding's name
 * ([E0121](../../../docs/spec/errors.md#e0121-reserved-bind-name)). Left to
 * codegen's shadowing rule the repeat takes an identifier of its own and every
 * read in the arm silently resolves to the *later* positional, with `check`
 * and `smoke` both clean. Before that rule reached patterns it was a module
 * that did not load, which is louder but no more useful: either way one of the
 * two positionals the pattern names is unreadable.
 *
 * The whole pattern is one namespace, so a tuple's items are checked against
 * each other too. `_` is exempt — it names nothing, and a pattern is expected
 * to carry several.
 */
function checkPatternBindsAreDistinct(pat: Pattern, errors: KumikiError[]): void {
  const seen = new Set<string>();
  const walk = (p: Pattern): void => {
    switch (p.kind) {
      case "PWildcard":
        return;
      case "PBind":
        report(p.name, p.pos);
        return;
      case "PVariant":
        // `PVariant.binds` are bare names with no position of their own, so the
        // report lands on the pattern that wrote them and names the bind.
        for (const b of p.binds) report(b, p.pos);
        return;
      case "PTuple":
        for (const it of p.items) walk(it);
        return;
      default: {
        const exhaustive: never = p;
        void exhaustive;
        return;
      }
    }
  };
  const report = (name: string, pos: Pos): void => {
    if (name === "_") return;
    if (seen.has(name)) {
      errors.push({
        code: "E0122",
        kind: "duplicate-pattern-bind",
        message:
          `"${name}" is bound twice in this pattern. The two binds are peers — nothing ` +
          `nests them, so the second does not shadow the first — and one of the two ` +
          `values the pattern names would be unreadable. Rename one`,
        pos,
      });
      return;
    }
    seen.add(name);
  };
  walk(pat);
}

/**
 * Validate that `pat` is structurally compatible with `scrutType`, push
 * diagnostics for any mismatch, and bring every bind name into `scope` — with
 * its type when that is known, and explicitly without one when it is not, so
 * an arm binding cannot inherit the type of a same-named binding outside it.
 *
 * When `scrutType` is null (undecidable), we still collect bind names — the
 * arm body must remain usable — but skip the structural checks (consistent
 * with the rest of the type checker's "dynamic ⇒ no diagnostic" stance).
 *
 * Without this structural check, a mismatched arm lowers to a guard that
 * always fails at runtime — the arm silently never fires.
 */
function checkPatternAgainstType(
  pat: Pattern,
  scrutType: TypeExpr | null,
  sym: SymbolTable,
  errors: KumikiError[],
  scope: Ctx,
): void {
  const t = unaliasType(scrutType, sym);
  // Diagnostics prefer the user-written name (`Light`) over its expanded body
  // (`Red | Green`). Fall back to the unaliased shape when no original was
  // passed (e.g. when recursing into an inferred element type).
  const display = scrutType ?? t;

  if (pat.kind === "PWildcard") return;

  if (pat.kind === "PBind") {
    bindLocal(scope, pat.name, t);
    return;
  }

  if (pat.kind === "PTuple") {
    const tupleT = resolveToTuple(t, sym);
    if (tupleT === null) {
      // Undecidable scrutinee — still walk the items so nested binds land in
      // scope; just skip the per-element type check.
      for (const it of pat.items) {
        checkPatternAgainstType(it, null, sym, errors, scope);
      }
      return;
    }
    if (tupleT === "not-a-tuple") {
      errors.push({
        code: "E0208",
        kind: "pat-type-mismatch",
        message: `Tuple pattern cannot match scrutinee of type "${typeToString(display as TypeExpr)}"`,
        pos: pat.pos,
      });
      for (const it of pat.items) {
        checkPatternAgainstType(it, null, sym, errors, scope);
      }
      return;
    }
    if (tupleT.args.length !== pat.items.length) {
      errors.push({
        code: "E0207",
        kind: "pat-arity-mismatch",
        message: `Tuple pattern has ${pat.items.length} item(s) but scrutinee type "${typeToString(tupleT)}" has ${tupleT.args.length}`,
        pos: pat.pos,
      });
    }
    // Even on an arity mismatch, walk every item so nested binds land in the
    // arm body's scope. Extra items get a null element type, which silences
    // further structural diagnostics under them — the outer E0207 already
    // names the root cause.
    for (let i = 0; i < pat.items.length; i++) {
      const item = pat.items[i];
      if (!item) continue;
      const elemType = tupleT.args[i] ?? null;
      checkPatternAgainstType(item, elemType, sym, errors, scope);
    }
    return;
  }

  // PVariant
  if (!t) {
    // Undecidable scrutinee — register binds without types and stop.
    for (const b of pat.binds) if (b !== "_") bindLocal(scope, b, null);
    return;
  }
  const payloads = lookupVariantPayloads(pat.name, t, sym);
  if (payloads === null) {
    for (const b of pat.binds) if (b !== "_") bindLocal(scope, b, null);
    return;
  }
  if (payloads === "unknown-tag") {
    errors.push({
      code: "E0209",
      kind: "pat-unknown-variant",
      message: `Variant "${pat.name}" is not a member of scrutinee type "${typeToString(display as TypeExpr)}"`,
      pos: pat.pos,
    });
    for (const b of pat.binds) if (b !== "_") bindLocal(scope, b, null);
    return;
  }
  if (payloads === "not-a-union") {
    errors.push({
      code: "E0208",
      kind: "pat-type-mismatch",
      message: `Variant pattern "${pat.name}" cannot match scrutinee of type "${typeToString(display as TypeExpr)}"`,
      pos: pat.pos,
    });
    for (const b of pat.binds) if (b !== "_") bindLocal(scope, b, null);
    return;
  }
  if (pat.binds.length !== payloads.length) {
    errors.push({
      code: "E0207",
      kind: "pat-arity-mismatch",
      message: `Variant "${pat.name}" pattern has ${pat.binds.length} bind(s) but the variant carries ${payloads.length} payload(s)`,
      pos: pat.pos,
    });
  }
  for (let i = 0; i < pat.binds.length; i++) {
    const name = pat.binds[i];
    if (!name || name === "_") continue;
    bindLocal(scope, name, payloads[i] ?? null);
  }
}

/**
 * Resolve the expected payload type list for a variant tag against a
 * scrutinee type. Return values:
 *   - `TypeExpr[]` — the variant exists; one entry per payload (may be empty).
 *   - `"unknown-tag"` — scrutinee IS a union shape but has no such tag.
 *   - `"not-a-union"` — scrutinee is a concrete non-union type (e.g. Int).
 *   - `null` — scrutinee type is undecidable; caller skips diagnostics.
 *
 * Built-in `Option(T)` and `Result(T,E)` are handled here so they don't need
 * to be desugared into a user TypeUnion first.
 */
function lookupVariantPayloads(
  tag: string,
  scrut: TypeExpr | null,
  sym: SymbolTable,
  seen: Set<string> = new Set(),
): TypeExpr[] | "unknown-tag" | "not-a-union" | null {
  if (!scrut) return null;
  if (scrut.kind === "TypeApp") {
    if (scrut.name === "Option") {
      const inner = scrut.args[0];
      if (tag === "Some") return inner ? [inner] : [];
      if (tag === "None") return [];
      return "unknown-tag";
    }
    if (scrut.name === "Result") {
      const okT = scrut.args[0];
      const errT = scrut.args[1];
      if (tag === "Ok") return okT ? [okT] : [];
      if (tag === "Err") return errT ? [errT] : [];
      return "unknown-tag";
    }
    // User-defined generic union, e.g. `type LoadResult(T) = Idle | …`.
    // Substitute the type params in the variant's payloads before returning.
    const def = sym.types.get(scrut.name);
    if (def) {
      if (seen.has(scrut.name)) return null;
      const sub = paramSubstitution(def.params, scrut.args);
      const next = new Set(seen);
      next.add(scrut.name);
      return lookupVariantPayloads(tag, substituteType(def.body, sub), sym, next);
    }
    // Stdlib containers (List, Map, Set, Tuple) and unknown names — no union shape.
    return "not-a-union";
  }
  if (scrut.kind === "TypeUnion") {
    const v = scrut.variants.find((x) => x.name === tag);
    if (!v) return "unknown-tag";
    return v.payloads;
  }
  if (scrut.kind === "TypeRef") {
    if (seen.has(scrut.name)) return null;
    const def = sym.types.get(scrut.name);
    if (!def) return null; // unknown name / type param — opaque
    const next = new Set(seen);
    next.add(scrut.name);
    return lookupVariantPayloads(tag, def.body, sym, next);
  }
  if (scrut.kind === "TypeNominal" || scrut.kind === "TypeRefinement") {
    return lookupVariantPayloads(tag, scrut.inner, sym, seen);
  }
  // TypePrim / TypeRecord — variants can't live on these.
  return "not-a-union";
}

/**
 * Reduce a scrutinee type to a `Tuple(...)` shape if it is one (transitively
 * through user generic aliases). Mirrors `lookupVariantPayloads` for symmetry
 * — a `type Pair(A, B) = Tuple(A, B)` should accept a `(a, b)` pattern.
 */
function resolveToTuple(
  scrut: TypeExpr | null,
  sym: SymbolTable,
  seen: Set<string> = new Set(),
): (TypeExpr & { kind: "TypeApp"; name: "Tuple" }) | "not-a-tuple" | null {
  if (!scrut) return null;
  if (scrut.kind === "TypeApp") {
    if (scrut.name === "Tuple") {
      return scrut as TypeExpr & { kind: "TypeApp"; name: "Tuple" };
    }
    const def = sym.types.get(scrut.name);
    if (def) {
      if (seen.has(scrut.name)) return null;
      const sub = paramSubstitution(def.params, scrut.args);
      const next = new Set(seen);
      next.add(scrut.name);
      return resolveToTuple(substituteType(def.body, sub), sym, next);
    }
    return "not-a-tuple";
  }
  if (scrut.kind === "TypeRef") {
    if (seen.has(scrut.name)) return null;
    const def = sym.types.get(scrut.name);
    if (!def) return null;
    const next = new Set(seen);
    next.add(scrut.name);
    return resolveToTuple(def.body, sym, next);
  }
  if (scrut.kind === "TypeNominal" || scrut.kind === "TypeRefinement") {
    return resolveToTuple(scrut.inner, sym, seen);
  }
  return "not-a-tuple";
}

/**
 * Visit every node of an expression tree (pre-order). A test's `given` / `expect`
 * are not routed through `checkExpr`, so wildcard enforcement walks them directly;
 * a generic walk keeps a wildcard from escaping under any nesting (e.g. a
 * `FieldAccess` base), which a per-form scan would miss as the grammar grows.
 */
function walkExpr(e: Expr | undefined, visit: (n: Expr) => void): void {
  if (!e) return;
  visit(e);
  switch (e.kind) {
    case "BinOp":
      walkExpr(e.lhs, visit);
      walkExpr(e.rhs, visit);
      return;
    case "UnaryOp":
      walkExpr(e.rhs, visit);
      return;
    case "FieldAccess":
      walkExpr(e.base, visit);
      return;
    case "Index":
      walkExpr(e.base, visit);
      walkExpr(e.index, visit);
      return;
    case "Call":
      for (const a of e.args) walkExpr(a, visit);
      return;
    case "MethodCall":
      walkExpr(e.receiver, visit);
      for (const a of e.args) walkExpr(a, visit);
      return;
    case "RecordLit":
      for (const f of e.fields) walkExpr(f.value, visit);
      return;
    case "ListLit":
    case "TupleLit":
      for (const it of e.items) walkExpr(it, visit);
      return;
    case "MapLit":
      for (const en of e.entries) {
        walkExpr(en.key, visit);
        walkExpr(en.value, visit);
      }
      return;
    case "MatchExpr":
      walkExpr(e.scrutinee, visit);
      for (const arm of e.arms) walkExpr(arm.body, visit);
      return;
    case "IfExpr":
      walkExpr(e.cond, visit);
      walkExpr(e.consequent, visit);
      walkExpr(e.alternate, visit);
      return;
    case "LetIn":
      walkExpr(e.value, visit);
      walkExpr(e.body, visit);
      return;
    case "Variant":
      for (const p of e.payload) walkExpr(p, visit);
      return;
    case "EmitExpr":
      for (const a of e.args) walkExpr(a, visit);
      return;
  }
}

function checkTest(t: TestDef, sym: SymbolTable, errors: KumikiError[]): void {
  checkTestNames(t, sym, errors);
  // Wildcards are legal only in a reducer-test `expect`. The `given` (both kinds)
  // and a tile-test `expect` must not use them (E0109); a reducer-test `expect`
  // may, but a `<slots.X>` there must name a real slot (E0103).
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
    // §8.6: each `mocks` key must name a declared effect — same
    // no-silent-typo guard as reducer-test mocks. The value must be one of
    // `from-log` / `ignore` / `ok(...)` / `err(...)`; codegen would otherwise
    // silently fall back to `{ policy: "ignore" }` for a typo like
    // `from_log`, which makes the test pass by skipping the very effect it
    // was supposed to replay.
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
    // The `for-all` types must resolve, and every `run-reducer(name)` in the
    // invariant must name a declared reducer.
    for (const f of t.forAll ?? []) resolveType(f.type, sym, errors);
    // `run-reducer` is the one callee `checkExpr` does not walk, so its argument
    // and its count are resolved here or nowhere. `reducerNameArg` reads a bare
    // name and answers `""` for anything else, and the runner then throws
    // `reducer "" not found` — which the property runner renders as a
    // counterexample, blaming the code under test for the test's own mistake.
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
    if (!sym.reducers.has(t.target ?? "")) {
      errors.push({
        code: "E0102",
        kind: "undef-reducer",
        message: `Reference to undefined reducer "${t.target}"`,
        pos: t.pos,
      });
    }
    // §8.5: each `given.mocks` key must name a declared effect — a typo would
    // otherwise silently never match an emit (the M1-review no-silent-typo rule).
    const given = t.given;
    if (given.kind === "RecordLit") {
      const mocks = given.fields.find((f) => f.name === "mocks")?.value;
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
    }
    return;
  }
  // tile-test
  const tileTarget = t.target ?? "";
  if (!BUILTIN_TILES.has(tileTarget) && !sym.tiles.has(tileTarget)) {
    errors.push({
      code: "E0105",
      kind: "undef-tile",
      message: `Reference to undefined tile "${t.target}"`,
      pos: t.pos,
    });
  }
  // The `expect` is a tile expression — validate its tile references.
  checkTileExpr(t.expect as TileExpr, sym, errors, {
    kind: "tile",
    localBinds: new Set(),
    localTypes: new Map(),
    routeBind: "no-payload",
  });
}

/**
 * The names a `test` definition writes.
 *
 * A test body is a schema, not an expression. `event: {type: ui.click,
 * target: B}` is an event pattern, `effects: [persist(x)]` is a list of
 * effects rather than of calls, and `mocks: {persist: err("x")}` names an
 * effect and an outcome — so handing the whole record to `checkExpr` reports
 * the schema itself: a slot called `ui`, a function called `persist`. Each
 * position is instead checked as what `codegen/emit-test.ts` lowers it as, and
 * that file is the other half of this one.
 *
 * What this adds is the positions nothing looked at: the slot keys, the event
 * target, the effect names, and every expression the lowering evaluates. The
 * reducer target, the `mocks` keys, a `<slots.X>` in a reducer-test `expect`,
 * the `for-all` types and the `run-reducer` target were resolved before it.
 *
 * The lowering drops what it cannot read, which is why the gap was invisible:
 * a slot key that names nothing left the test passing against the default it
 * never set.
 */
function checkTestNames(t: TestDef, sym: SymbolTable, errors: KumikiError[]): void {
  const base: Ctx = {
    kind: "test",
    localBinds: new Set(),
    localTypes: new Map(),
    routeBind: "no-payload",
  };
  // `for-all` names are binds in `given` and in the invariant, with the type
  // the generator declares — codegen binds them the same way, one per trial.
  for (const f of t.forAll ?? []) bindLocal(base, f.name, f.type);
  // `checkTest` walks the whole of `given` for E0109 and the whole of a
  // reducer-test `expect` for E0103, so a wildcard in either is already
  // reported. Nothing walks an invariant or an `episode-test` expect.
  const owned: Ctx = { ...base, wildcardsReportedElsewhere: true };

  for (const f of recordFieldsOf(t.given)) {
    if (f.name === "slots") checkTestSlotMap(f.value, sym, errors, owned);
    else if (f.name === "event") checkTestEvent(f.value, sym, errors, owned);
    else if (f.name === "mocks") checkTestMockValues(f.value, sym, errors, owned);
    // `in` (tile-test), and any key other than the three above.
    else checkExpr(f.value, sym, errors, owned);
  }
  if (t.invariant) checkExpr(t.invariant, sym, errors, { ...base, runReducerScope: true });
  if (t.testKind === "reducer-test") {
    for (const f of recordFieldsOf(t.expect)) {
      if (f.name === "slots") checkTestSlotMap(f.value, sym, errors, owned);
      else if (f.name === "effects") checkTestEffects(f.value, sym, errors, owned);
      else checkExpr(f.value, sym, errors, owned); // `panic`
    }
  }
  if (t.testKind === "episode-test") {
    for (const f of recordFieldsOf(t.expect)) {
      if (f.name === "slots-equal" || f.name === "slotsEqual") {
        // `from-log` is the literal that means "take the log's own values".
        if (f.value.kind === "Ref" && f.value.name === "from-log") continue;
        checkTestSlotMap(f.value, sym, errors, base);
      } else checkExpr(f.value, sym, errors, base);
    }
    checkTestMockValues(t.mocks, sym, errors, base, true);
  }
  // A tile-test's `expect` is a tile expression, checked by `checkTileExpr`.
}

/** The fields of `e` when it is a record literal, and none when it is not. */
function recordFieldsOf(e: Expr | TileExpr | undefined): { name: string; value: Expr; pos: Pos }[] {
  if (e === undefined || isTileExpr(e) || e.kind !== "RecordLit") return [];
  return e.fields;
}

/** `{<slot>: <expr>}` — the shape of a `given.slots` / `expect.slots`. */
function checkTestSlotMap(rec: Expr, sym: SymbolTable, errors: KumikiError[], ctx: Ctx): void {
  if (rec.kind !== "RecordLit") {
    checkExpr(rec, sym, errors, ctx);
    return;
  }
  for (const f of rec.fields) {
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
  }
}

/**
 * `{type: <event>, target: <tile>, ...}` — the event a test drives with.
 *
 * The lowering reads neither `type` nor `target`: `eventPayloadJs` filters both
 * out, and the reducer the runner applies comes from the test's own target. So
 * the `target` rule below is about what the test *says* rather than what it
 * does — and it only says a tile when the trigger is a `ui.*` one. A reducer
 * driven by a timer names the timer, and one driven by an effect outcome or a
 * lifecycle event has no name to give at all.
 */
function checkTestEvent(event: Expr, sym: SymbolTable, errors: KumikiError[], ctx: Ctx): void {
  const uiEvent = isUiEventType(recordFieldsOf(event).find((f) => f.name === "type")?.value);
  for (const f of recordFieldsOf(event)) {
    // `type` names an event, whose vocabulary is the trigger grammar's, not an
    // expression's.
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
    // A missing pair of brackets does not weaken the assertion, it replaces
    // it: `effectListJs` lowers anything that is not a list to `[]`, which
    // says "no effects were emitted" — so a test that named one passes against
    // a reducer that emits nothing, and the name inside is never resolved.
    errors.push({
      code: "E0713",
      kind: "test-shape-invalid",
      message: "`expect.effects` must be a list of effects",
      pos: list.pos,
    });
    return;
  }
  for (const item of list.items) {
    // A call pins the arguments, a bare name matches by name alone. Anything
    // else lowers to a sentinel that matches no effect, which the runner
    // reports as a failed expectation rather than a silence.
    const name = item.kind === "Call" ? item.callee : item.kind === "Ref" ? item.name : undefined;
    if (name === undefined) continue;
    // The standard effects (`navigate`, `toast`, `log`, …) are declared by no
    // program, so the table they live in is the capability one.
    if (!sym.effects.has(name) && !BUILTIN_EFFECT_CAPS.has(name)) {
      errors.push({
        code: "E0104",
        kind: "undef-effect",
        message: `Reference to undefined effect "${name}"`,
        pos: item.pos,
      });
    }
    if (item.kind === "Call") for (const a of item.args) checkExpr(a, sym, errors, ctx);
  }
}

/**
 * The payloads of `{<effect>: ok(v) | err(e) | delay(ms, ok(v)) | from-log | ignore}`.
 *
 * The keys are resolved where the two mock forms are validated; `from-log` and
 * `ignore` are bare names the lowering reads as policies, not references, and
 * belong to an `episode-test` only.
 *
 * The shape is checked here for the same reason E0712 checks an episode's:
 * `mockScriptJs` answers a value it does not recognise with
 * `{outcome: "ok", value: null}`, so a mock written to drive the failure path
 * drove the success one instead — and a test asserting what happens when an
 * effect fails passed, permanently, having never failed it.
 */
function checkTestMockValues(
  rec: Expr | undefined,
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
  episode = false,
): void {
  for (const f of recordFieldsOf(rec)) {
    const v = f.value;
    if (episode && v.kind === "Ref" && (v.name === "from-log" || v.name === "ignore")) continue;
    const outcome = v.kind === "Call" && (v.callee === "ok" || v.callee === "err") ? v : undefined;
    if (outcome) {
      for (const a of outcome.args) checkExpr(a, sym, errors, ctx);
      continue;
    }
    if (v.kind === "Call" && v.callee === "delay" && !episode) {
      const [ms, inner] = v.args;
      if (ms) checkExpr(ms, sym, errors, ctx);
      if (inner?.kind === "Call" && (inner.callee === "ok" || inner.callee === "err")) {
        for (const a of inner.args) checkExpr(a, sym, errors, ctx);
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

/**
 * What every E0120 says, whether the read is written in the argument or sits
 * behind a `fn` call. `chain` is the route from the called `fn` to the read —
 * `["here"]`, or `["outer", "inner"]` — and naming only the first of those
 * would send the author to a `fn` that is not itself wrong.
 */
function routeInAppInitMessage(name: string, chain?: readonly string[]): string {
  const through =
    chain === undefined ? "" : ` through "${chain[0]}" (${[...chain, name].join(" → ")})`;
  return (
    `"${name}" is not available in an app.init argument${through}: these arguments are ` +
    `evaluated once, while the app object is being built, and the runtime installs ` +
    `the route during the mount that follows. Take the route from a route.enter ` +
    `reducer, which runs with the route the app landed on`
  );
}

/**
 * Would this `fn` body read the runtime's route if it were evaluated in an
 * `app.init` argument — and under which spelling?
 *
 * Asked of the gate itself, in that position, so that which `route` counts is
 * decided in one place. The scope is `checkFn`'s, with the position swapped:
 * `routeBind` is the `no-payload` a `fn` body really has, and says nothing
 * either way here — the E0120 gate returns before the branch that reads it, so
 * a `$route` in a `fn` collects E0120 from this probe and E0103 from `checkFn`,
 * which is right: the call site is wrong even once the body is.
 *
 * Running `checkExpr` twice over one body is safe because `inferType` reads no
 * field of the scope but `localTypes`, which this builds the way `checkFn`
 * does. That matters beyond the diagnostics, which are discarded: `checkExpr`
 * also writes `accessKind` onto field accesses for codegen, and definitions are
 * checked in source order, so a decision that depended on anything else here
 * would make the emitted module depend on where the `fn` was written.
 */
function fnReadsRoute(fn: FnDef, sym: SymbolTable): string | null {
  const seen: string[] = [];
  const ctx: Ctx = {
    kind: "app-init",
    localBinds: new Set([...fn.params.map((p) => p.name), "$1", "$2"]),
    localTypes: new Map(fn.params.map((p) => [p.name, p.type])),
    routeBind: "no-payload",
    routeNamesSeen: seen,
  };
  checkExpr(fn.body, sym, [], ctx);
  return seen[0] ?? null;
}

/**
 * The `fn` definitions an expression calls, in the order they are written, each
 * positioned at the call rather than at the expression that contains it — two
 * calls in one argument are two things to fix.
 *
 * Deliberately narrower than the edges the cycle check follows: those come from
 * `referencesIn`, which counts a bare `fn` name as a reference too. A bare name
 * lowers to the function itself and is never applied, so nothing it mentions is
 * evaluated — counting one here would report a call that does not happen.
 */
function fnCallsIn(e: Expr, sym: SymbolTable): { name: string; pos: Pos }[] {
  const out: { name: string; pos: Pos }[] = [];
  walkExpr(e, (n) => {
    if (n.kind === "Call" && sym.fns.has(n.callee)) out.push({ name: n.callee, pos: n.pos });
  });
  return out;
}

/**
 * Resolve, for a `fn` name, the shortest chain of calls from it to a body that
 * reads the route, and the name that body read.
 *
 * Breadth-first and iterative. A `fn` graph is a program's to declare, so a
 * chain may be longer than the call stack and a cycle may exist — E0006
 * reports one, but this pass runs whether or not that report is there, so it
 * has to terminate on its own. Re-entering a name cannot add reachability,
 * which is what makes the visited set safe to prune with.
 *
 * The per-`fn` answer is memoised across the app's arguments. The search is
 * not: it is a walk over a graph the memo already answers for, and each call
 * site is reported by the caller either way.
 */
function routeChainResolver(
  sym: SymbolTable,
): (start: string) => { chain: string[]; name: string } | null {
  const direct = new Map<string, string | null>();
  const readsRoute = (name: string): string | null => {
    const cached = direct.get(name);
    if (cached !== undefined) return cached;
    const fn = sym.fns.get(name);
    const answer = fn ? fnReadsRoute(fn, sym) : null;
    direct.set(name, answer);
    return answer;
  };

  return (start: string) => {
    const parent = new Map<string, string | null>([[start, null]]);
    const queue: string[] = [start];
    for (let i = 0; i < queue.length; i++) {
      const name = queue[i];
      // Unreachable — `i` is bounded by the queue's own length — and present
      // for the index type. `continue` rather than `break` so that if it ever
      // does fire it costs one entry rather than every chain left to find.
      if (name === undefined) continue;
      const read = readsRoute(name);
      if (read !== null) {
        const chain: string[] = [];
        for (let at: string | null | undefined = name; at != null; at = parent.get(at)) {
          chain.unshift(at);
        }
        return { chain, name: read };
      }
      const fn = sym.fns.get(name);
      if (!fn) continue;
      for (const callee of fnCallsIn(fn.body, sym)) {
        if (parent.has(callee.name)) continue;
        parent.set(callee.name, name);
        queue.push(callee.name);
      }
    }
    return null;
  };
}

function checkApp(
  app: AppDef,
  sym: SymbolTable,
  errors: KumikiError[],
  registeredCaps: Set<string>,
): void {
  // Each declared capability must be standard or registered via a manifest.
  for (const cap of app.caps) {
    if (!STANDARD_CAPABILITIES.has(cap) && !registeredCaps.has(cap)) {
      errors.push({
        code: "E0302",
        kind: "unknown-capability",
        message: `Unknown capability "${cap}" in app.caps — use a standard capability or register it in kumiki.caps.json`,
        pos: app.pos,
      });
    }
  }
  let saw404 = false;
  for (const r of app.routes) {
    if (r.tile.startsWith(">>")) continue; // redirect
    if (!sym.tiles.has(r.tile)) {
      errors.push({
        code: "E0105",
        kind: "undef-tile",
        message: `Route "${r.path}" targets undefined tile "${r.tile}"`,
        pos: app.pos,
      });
    }
    checkRouteTargetArity(r, `Route "${r.path}"`, sym, errors);
    if (r.path === "/404") saw404 = true;
  }
  if (!saw404) {
    errors.push({
      code: "E0001",
      kind: "missing-404",
      message: `app.routes must include a "/404" entry`,
      pos: app.pos,
    });
  }
  const initCtx: Ctx = {
    // The scope codegen lowers these arguments in. It used to say `reducer`,
    // which let an `emit` expression through the check and into the app object
    // literal, where the `_emits` it lowers to is a binding local to a reducer
    // body — a ReferenceError at import, so nothing mounted.
    kind: "app-init",
    localBinds: new Set(),
    localTypes: new Map(),
    capsAvailable: new Set(app.caps),
    // The runtime evaluates these entries with no payload at all. E0120 answers
    // an unshadowed `$route` here first, and a shadowed one belongs to its
    // binding, so nothing in this position reads the field today — it is set to
    // what is true rather than to what is load-bearing, because the field is
    // required and every other value would be a lie about the payload.
    routeBind: "unbound",
  };
  const routeChain = routeChainResolver(sym);
  for (const e of app.init) {
    // An init entry is an effect call by the grammar (§1.12). `checkExpr` would
    // resolve the callee as a `fn` and send `fix` hunting in the wrong
    // namespace, so it goes through the same validation as `emit` instead —
    // which is also what makes the built-in effects (`toast`, `navigate`, …)
    // legal here, and what brings the capability and argument-type checks that
    // an `emit` of the same effect has always had.
    if (e.kind !== "Call") {
      errors.push({
        code: "E0104",
        kind: "init-not-effect-call",
        message: "app.init entries must be effect calls",
        pos: e.pos,
      });
      continue;
    }
    checkEmitTarget(e.callee, e.args, sym, errors, initCtx, e.pos);
    for (const a of e.args) {
      checkExpr(a, sym, errors, initCtx);
      // A `fn` hop walks past the gate above: the spelling in the argument is
      // a call, and what it reads is in another definition. The `fn` itself is
      // right — a tile, a reducer and an effect's `map-request` all run after
      // the mount that installs the route — so the report belongs here, at the
      // call.
      for (const call of fnCallsIn(a, sym)) {
        const reached = routeChain(call.name);
        if (reached === null) continue;
        errors.push({
          code: "E0120",
          kind: "route-in-app-init",
          message: routeInAppInitMessage(reached.name, reached.chain),
          pos: call.pos,
        });
      }
    }
  }
  checkAppHttp(app, sym, errors);
  checkAppTheme(app, sym, errors);
}

/**
 * The reducers `app.http` routes a 401 / 403 / 5xx response to.
 *
 * They are named the same way a `button(onClick=…)` names one, and were the
 * one such site with nothing resolving the name — a misspelling left the
 * response with no handler, which looks exactly like a response the app chose
 * not to handle.
 */
/**
 * `app.http` has two kinds of field: three reducer names, resolved here, and
 * four expressions, walked here.
 *
 * The expressions are checked in the position `slot-init` names — pure and
 * payloadless, so `$route` is a name that does not exist rather than a bind
 * read out of scope, and `emit` has no dispatch to reach. Nothing else looks
 * at them, and codegen lowers each into a getter or a thunk read at request
 * time, so a name that resolves to nothing would otherwise reach the runtime:
 * the read throws inside the request, the dispatcher turns the throw into an
 * `err` result, and an app with an `.err` reducer absorbs it. A misspelt slot
 * would pass check, build and smoke alike.
 */
function checkAppHttp(app: AppDef, sym: SymbolTable, errors: KumikiError[]): void {
  const http = app.http;
  if (!http) return;
  for (const handler of [http.on401, http.on403, http.on5xx]) {
    if (handler === undefined || sym.reducers.has(handler.name)) continue;
    errors.push({
      code: "E0102",
      kind: "undef-reducer",
      message: `Reference to undefined reducer "${handler.name}"`,
      pos: handler.pos,
    });
  }
  const fieldCtx: Ctx = {
    kind: "slot-init",
    localBinds: new Set(),
    localTypes: new Map(),
    routeBind: "no-payload",
  };
  for (const e of [http.baseUrl, http.headers, http.timeout, http.credentials]) {
    if (e !== undefined) checkExpr(e, sym, errors, fieldCtx);
  }
}

/**
 * `app.theme = X`, where `X` is either a `theme` definition or the slot whose
 * value selects one (spec §4.6). Resolving to neither leaves the runtime with
 * a name that matches no registered theme, and it renders with the built-in
 * defaults — an app that looks merely unstyled rather than misconfigured.
 *
 * The *value* a slot holds is deliberately not checked, though §4.6 says it
 * must name a declared theme. An app that picks its theme on `app.start` — the
 * shape §4.6.1 prescribes — has to give the slot some initial value first, and
 * every theme name would be a lie there; the honest one is a sentinel that
 * names no theme. That sentinel and a misspelling are the same program, so
 * separating them takes intent, which a check does not have.
 */
function checkAppTheme(app: AppDef, sym: SymbolTable, errors: KumikiError[]): void {
  const theme = app.theme;
  if (theme === undefined || sym.themes.has(theme.name) || sym.slots.has(theme.name)) return;
  errors.push({
    code: "E0118",
    kind: "undef-theme",
    message: `Reference to undefined theme "${theme.name}"`,
    pos: theme.pos,
  });
}

/**
 * Walk a type written in the program and report the names in it that resolve to
 * nothing.
 *
 * `typeParams` is what makes this possible without false positives: the body of
 * `type Box(T) = {v: T}` may name `T`, and nothing else may. Every other
 * declaration site — `slot`, `fn`, `effect`, `tile in=` — has no type
 * parameters, so it passes an empty scope and every unresolved name there is a
 * real one. Tracking them is what makes reporting possible at all: without a
 * scope the only safe answer for an unknown name is to accept it, and
 * accepting `NoSuchType` turns off value checking for everything it types.
 */
function resolveType(
  t: TypeExpr,
  sym: SymbolTable,
  errors: KumikiError[],
  typeParams: ReadonlySet<string> = EMPTY_SCOPE,
): void {
  switch (t.kind) {
    case "TypePrim":
      return;
    case "TypeRef": {
      if (typeParams.has(t.name)) return;
      if (!isKnownTypeName(t.name, sym)) {
        errors.push({
          code: "E0117",
          kind: "undef-type",
          message: `Reference to undefined type "${t.name}"`,
          pos: t.pos,
        });
        return;
      }
      // A generic named without its arguments is the same hole E0117 closes,
      // through a different door: `Box` on `type Box(T) = {v: T}` expands with
      // `T` unsubstituted, and an unsubstituted parameter is opaque, so
      // everything typed by it stops being checked.
      checkTypeArity(t.name, 0, t.pos, sym, errors);
      return;
    }
    case "TypeApp": {
      if (!typeParams.has(t.name)) {
        if (!isKnownTypeName(t.name, sym)) {
          errors.push({
            code: "E0117",
            kind: "undef-type",
            message: `Reference to undefined type "${t.name}"`,
            pos: t.pos,
          });
        } else {
          checkTypeArity(t.name, t.args.length, t.pos, sym, errors);
        }
      }
      for (const a of t.args) resolveType(a, sym, errors, typeParams);
      return;
    }
    case "TypeRecord":
      for (const f of t.fields) resolveType(f.type, sym, errors, typeParams);
      return;
    case "TypeUnion":
      for (const v of t.variants)
        for (const p of v.payloads) resolveType(p, sym, errors, typeParams);
      return;
    case "TypeNominal":
      resolveType(t.inner, sym, errors, typeParams);
      return;
    case "TypeRefinement":
      resolveType(t.inner, sym, errors, typeParams);
      return;
  }
}

/**
 * Report a type constructor applied to the wrong number of arguments. `Tuple`
 * is the one variadic constructor, and `constructorArity` answers `null` for
 * it — so does an unknown name, which is why the caller resolves the name
 * first and this only decides the count.
 */
function checkTypeArity(
  name: string,
  given: number,
  pos: Pos,
  sym: SymbolTable,
  errors: KumikiError[],
): void {
  const arity = constructorArity(name, sym);
  if (arity === null || arity === given) return;
  errors.push({
    code: "E0210",
    kind: "type-arity-mismatch",
    message: `Type "${name}" expects ${arity} type argument(s) but got ${given}`,
    pos,
  });
}

const EMPTY_SCOPE: ReadonlySet<string> = new Set();

function checkTypeDef(def: TypeDef, sym: SymbolTable, errors: KumikiError[]): void {
  resolveType(def.body, sym, errors, new Set(def.params));
}
