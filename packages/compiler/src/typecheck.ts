import {
  assignable,
  constructorArity,
  elementType,
  forwardedHead,
  isKnownTypeName,
  isOpaque,
  nominallyComparable,
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
  FragmentShape,
  KeyKind,
  Lvalue,
  MatchArm,
  Pattern,
  Pos,
  Program,
  ReducerDef,
  Refinement,
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
  isQualifierName,
  QUALIFIED_BUILTIN_CALLS,
  QUALIFIED_CALL_NAMESPACES,
  TYPE_MEMBER_CALLS,
  UNIMPLEMENTED_CALLS,
} from "./builtin-calls.ts";
import { BUILTIN_TILES, contentArg, contentReading, positionalIsTile } from "./builtins.ts";
import {
  BUILTIN_EFFECTS,
  builtinFieldOmittable,
  failsWithText,
  REDUCER_REF,
  STANDARD_CAPABILITIES,
} from "./capabilities.ts";
import {
  FIELD_ACCESS_SHORTCUTS,
  FRAGMENT_ARGUMENTS,
  KNOWN_METHODS,
  METHOD_MIN_ARGS,
} from "./codegen.ts";
import {
  aliasTarget,
  boundaryTarget,
  expansionTargets,
  findCycles,
  type GraphEdge,
} from "./def-graph.ts";
import { type FnScopeBind, fnScope } from "./fn-scope.ts";
import { INPUT_BIND_TYPES, inputBindBase } from "./input-bind.ts";
import { keyRepresentation } from "./key-representation.ts";
import { PARSE_READINGS_PHRASE, parseQualifier, qualifierType } from "./parse-reading.ts";
import { buildDefIndex, type DefIndex, referencesIn } from "./references.ts";
import { GENERIC_SELF_NESTING_LIMIT, scanPositions } from "./refinement-positions.ts";
import { type RefinementProblem, refinementBaseProblem, refinementProblem } from "./refinements.ts";
import { RESERVED_BIND_NAMES } from "./reserved-binds.ts";
import {
  hasMember,
  isOwnMember,
  isReceiver,
  type Receiver,
  receiversOf,
  UNIVERSAL_MEMBERS,
} from "./stdlib-members.ts";
import { isPrimTypeName, STDLIB_TYPES } from "./stdlib-types.ts";
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
} from "./test-sections.ts";
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
  severity?: "error" | "warning";
  unrendered?: "positional" | "text-prop" | "text-shadowed";
};

export const A11Y_CODES = new Set(["E0701", "E0702", "E0703", "E0705"]);

const STRICT_ICONS_CODES = new Set(["E0704"]);

const STRICT_SELECTOR_ID_CODES = new Set(["E0212"]);

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
    errors.push({
      code: "E0003",
      kind: "missing-app",
      message: "Program has no app definition",
      pos: { line: 1, col: 1 },
    });
  }
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
  prefetchTargets: Set<string>;
  /** Names declared by `motion N = {…}` — the `motion` prop namespace. */
  motions: Set<string>;
  /** Names declared by `theme N = {…}` — the `app.theme` namespace. */
  themes: Set<string>;
  iconDomain: Set<string>;
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

  for (const def of program.defs) {
    if (def.kind === "TileDef") collectPrefetchTargets(def.body, sym.prefetchTargets);
    if (def.kind === "TileDef") collectElementIds(def.body, sym.elementIds);
  }

  const index = buildDefIndex(program);
  const routeChain = routeChainResolver(sym);
  for (const def of program.defs) {
    if (def.kind === "TypeDef") checkTypeDef(def, sym, errors);
    if (def.kind === "SlotDef") checkSlot(def, sym, errors, index, routeChain);
    if (def.kind === "TileDef") checkTile(def, sym, errors);
    if (def.kind === "ReducerDef") checkReducer(def, sym, errors);
    if (def.kind === "FnDef") checkFn(def, sym, errors);
    if (def.kind === "EffectDef") checkEffect(def, sym, errors);
    if (def.kind === "AppDef") checkApp(def, sym, errors, registeredCaps, routeChain);
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

  const types = program.defs.filter((d): d is TypeDef => d.kind === "TypeDef");
  const typeOf = (name: string): TypeDef | undefined => sym.types.get(name);
  const typeEdges = (name: string): readonly GraphEdge[] => {
    const def = typeOf(name);
    if (!def) return [];
    const target = aliasTarget(def, typeOf);
    return target && sym.types.has(target.to) ? [target] : [];
  };
  for (const cycle of findCycles(
    types.map((t) => t.name),
    typeEdges,
  )) {
    errors.push({
      code: "E0009",
      kind: "type-cycle",
      message: `type "${cycle.path[0]}" resolves to itself (${cycle.path.join(" → ")})`,
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

const RESERVED_SLOT_NAMES: ReadonlyMap<string, string> = new Map([
  ["route", "the router-maintained route slot"],
]);

function isTestSlot(name: string, sym: SymbolTable): boolean {
  return sym.slots.has(name) || RESERVED_SLOT_NAMES.has(name);
}

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

function checkSlot(
  slot: SlotDef,
  sym: SymbolTable,
  errors: KumikiError[],
  index: DefIndex,
  routeChain: RouteChainResolver,
): void {
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
  checkNestedLowering(slot, sym, errors);
  for (const ref of referencesIn(slot, index)) {
    if (ref.layer !== "slot") continue;
    errors.push({
      code: "E0304",
      kind: "derived-slot",
      message: `Slot "${slot.name}" reads slot "${ref.name}" in its initial value; derived slots are prohibited — compute it in a fn instead`,
      pos: ref.pos ?? slot.pos,
    });
  }
  for (const read of routeReadsIn(slot.init, sym)) {
    if (read.name !== "route") continue;
    errors.push({
      code: "E0304",
      kind: "derived-slot",
      message: routeInSlotInitMessage(slot.name, read.name),
      pos: read.pos,
    });
  }
  for (const hop of routeReachedThroughCalls(slot.init, sym, routeChain)) {
    errors.push({
      code: "E0304",
      kind: "derived-slot",
      message: routeInSlotInitMessage(slot.name, hop.name, hop.chain),
      pos: hop.pos,
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
  if (tile.errorBoundary !== undefined && !sym.tiles.has(tile.errorBoundary)) {
    errors.push({
      code: "E0105",
      kind: "undef-tile",
      message: `Tile "${tile.name}" declares error-boundary "${tile.errorBoundary}", which is not a tile`,
      pos: tile.errorBoundaryPos ?? tile.pos,
    });
  }
  checkBoundaryFallback(tile, sym, errors);
  if (tile.subRoutes) checkSubRoutes(tile, sym, errors);
}

function checkBoundaryFallback(tile: TileDef, sym: SymbolTable, errors: KumikiError[]): void {
  if (tile.errorBoundary === undefined) return;
  const fallback = sym.tiles.get(tile.errorBoundary);
  if (fallback === undefined) return; // E0105
  let declared: string;
  if (fallback.in === undefined) {
    if (!readsUndeclaredInput(fallback, sym)) return;
    declared = "declares no in= but reads $1";
  } else {
    const panicInfo: TypeExpr = { kind: "TypeRef", name: "PanicInfo", pos: fallback.pos };
    if (assignable(panicInfo, fallback.in, sym)) return;
    declared = `declares in=${typeToString(fallback.in)}`;
  }
  errors.push({
    code: "E0220",
    kind: "boundary-fallback-input",
    message:
      `Tile "${tile.name}" uses "${fallback.name}" as its error-boundary, which ${declared} — ` +
      `a fallback is applied to the panic, so it receives a PanicInfo as $1 and must declare ` +
      `in=PanicInfo`,
    pos: tile.errorBoundaryPos ?? tile.pos,
  });
}

function readsUndeclaredInput(tile: TileDef, sym: SymbolTable): boolean {
  const seen: Pos[] = [];
  const ctx: Ctx = {
    kind: "tile",
    localBinds: new Set(),
    localTypes: new Map(),
    routeBind: "no-payload",
    undeclaredInputReads: seen,
  };
  checkTileExpr(tile.body, sym, [], ctx);
  return seen.length > 0;
}

function checkRouteTargetArity(
  entry: { path: string; tile: string; tilePos?: Pos; pathPos: Pos },
  where: string,
  sym: SymbolTable,
  errors: KumikiError[],
): void {
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
  for (const dup of duplicateSubRoutes(subRoutes)) {
    errors.push({
      code: "E0112",
      kind: "duplicate-sub-route",
      message: `Sub-route path "${dup.name}" is declared more than once in tile "${tile.name}"`,
      pos: dup.pos,
    });
  }
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
  kind: "slot-init" | "tile" | "reducer" | "fn" | "app-init" | "test";
  localBinds: Set<string>;
  capsAvailable?: Set<string>; // for reducer context
  localTypes: Map<string, TypeExpr>;
  runReducerScope?: boolean;
  wildcardsReportedElsewhere?: boolean;
  routeBind: "bound" | "unbound" | "no-payload";
  routeReadsSeen?: { name: string; pos: Pos }[];
  fragmentFnCallsSeen?: { name: string; pos: Pos }[];
  undeclaredInputReads?: Pos[];
  oneValueFragment?: { method: string; hides: boolean };
};

function bindLocal(ctx: Ctx, name: string, type: TypeExpr | null): void {
  ctx.localBinds.add(name);
  if (type) ctx.localTypes.set(name, type);
  else ctx.localTypes.delete(name);
}

/** The type one iteration of `for x in iter` binds, given the iterated expression. */
function elementTypeOf(iter: Expr, sym: SymbolTable, ctx: Ctx): TypeExpr | null {
  return elementType(inferType(iter, sym, ctx), sym);
}

function checkIterationTarget(iter: Expr, sym: SymbolTable, errors: KumikiError[], ctx: Ctx): void {
  const t = unaliasType(inferType(iter, sym, ctx), sym);
  if (t?.kind !== "TypeApp") return;
  const remedy = t.name === "Map" ? "keys" : t.name === "Set" ? "to-list" : null;
  if (!remedy) return;
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

/** The controls `bind` writes back from (forms.md §5.1.1, plus `editable`). */
const BIND_CONTROLS = new Set([
  "input",
  "textarea",
  "select",
  "slider",
  "check",
  "switch",
  "radio",
  "editable",
]);

function checkBindTargetSteps(t: TileExpr & { kind: "TileCall" }, errors: KumikiError[]): void {
  const bind = t.args.find((a) => a.name === "bind");
  let cur = bind?.value as Expr | undefined;
  while (cur && (cur.kind === "FieldAccess" || cur.kind === "MethodCall" || cur.kind === "Index")) {
    if (cur.kind === "MethodCall") {
      const hint =
        cur.method === "get" && cur.args.length === 0
          ? ' — the unwrap step is written ".get"'
          : " — a member derives a value, so there is no place in the receiver for the control to write";
      errors.push({
        code: "E0602",
        kind: "unassignable-member",
        message: `Cannot bind through ".${cur.method}(${cur.args.length === 0 ? "" : "…"})": a bind target is a path, and a call is not a step of one${hint}`,
        pos: cur.pos,
      });
    }
    cur = cur.kind === "MethodCall" ? cur.receiver : cur.base;
  }
}

function checkBindStrictProp(t: TileExpr & { kind: "TileCall" }, errors: KumikiError[]): void {
  if (!BIND_CONTROLS.has(t.name)) return;
  const written = [
    ...t.args.flatMap((a) => (a.name === "strict" ? [{ pos: a.namePos }] : [])),
    ...t.props.flatMap((p) => (p.name === "strict" ? [{ pos: p.pos }] : [])),
  ];
  for (const { pos } of written) {
    errors.push({
      code: "E0219",
      kind: "bind-strict-prop",
      message: `"strict" is not a prop of ${t.name}: a value its refinement refuses is always refused, and error(field=…) shows why (see docs/spec/forms.md §5.1.2)`,
      pos,
    });
  }
}

const TOGGLE_BIND_CONTROLS = new Set(["check", "switch", "radio"]);

/** The argument each toggle reads for its selection when it has no `bind=`. */
const TOGGLE_UNBOUND_SELECTION: Readonly<Record<string, string>> = {
  check: "value",
  switch: "value",
  radio: "selected",
};

function checkToggleBind(
  t: TileExpr & { kind: "TileCall" },
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  if (!TOGGLE_BIND_CONTROLS.has(t.name)) return;
  const bindArg = t.args.find((a) => a.name === "bind");
  if (!bindArg || isTileExpr(bindArg.value)) return;
  const bindExpr = bindArg.value;
  const unread = TOGGLE_UNBOUND_SELECTION[t.name];
  for (const arg of t.args) {
    if (arg.name !== unread) continue;
    errors.push({
      code: "W0216",
      kind: "selection-beside-bind",
      severity: "warning",
      message: `"${unread}" on ${t.name}() is not read beside bind= — the bound value decides whether it is ${t.name === "radio" ? "chosen" : "ticked"}. Remove it (see docs/spec/forms.md §5.1.1)`,
      pos: arg.namePos ?? (arg.value as Expr).pos,
    });
  }
  const valueArg = t.name === "radio" ? t.args.find((a) => a.name === "value") : undefined;
  if (t.name === "radio" && !valueArg) {
    errors.push({
      code: "E0225",
      kind: "radio-bind-without-value",
      message: `radio(bind=…) has no value= — a bound radio writes its own value when it is chosen, so it needs one (see docs/spec/forms.md §5.1.1)`,
      pos: bindArg.namePos ?? bindExpr.pos,
    });
  }
  const bound = inferType(bindExpr, sym, ctx);
  if (bound === null) return;
  if (t.name === "radio") {
    if (valueArg && !isTileExpr(valueArg.value)) {
      checkAgainst(valueArg.value, bound, sym, errors, ctx);
    }
    return;
  }
  if (assignable(bound, prim("Bool", bindExpr.pos), sym)) return;
  pushMismatch(
    errors,
    "E0201",
    `${t.name}(bind=…) writes a Bool, but the bound value is ${typeToString(bound)} (see docs/spec/forms.md §5.1.1)`,
    bindExpr.pos,
  );
}

function checkInputBindType(
  t: TileExpr & { kind: "TileCall" },
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  if (t.name !== "input") return;
  const bindArg = t.args.find((a) => a.name === "bind");
  if (!bindArg || isTileExpr(bindArg.value)) return;
  const typeArg = t.args.find((a) => a.name === "type")?.value;
  const literal =
    typeArg === undefined
      ? "text"
      : !isTileExpr(typeArg) && typeArg.kind === "Str"
        ? typeArg.value
        : null;
  if (literal === "file") return;
  const bound = inferType(bindArg.value, sym, ctx);
  const u = unaliasType(bound, sym);
  if (!u || u.kind === "TypeRef") return;
  const base = u.kind === "TypePrim" ? inputBindBase(u.name) : null;
  if (base !== null && (literal === null || INPUT_BIND_TYPES[base].includes(literal))) return;
  const typeName = bound ? typeToString(bound) : "?";
  const see = "(see docs/spec/forms.md §5.1.1)";
  if (base === null) {
    const payload =
      u.kind === "TypeApp" && (u.name === "Option" || u.name === "Result")
        ? ` — bind its payload with ".get"`
        : "";
    errors.push({
      code: "E0226",
      kind: "input-bind-type",
      message: `input(bind=…) cannot bind a value of type ${typeName}: an input binds a Text, Int, Float or Time${payload} ${see}`,
      pos: bindArg.value.pos,
    });
    return;
  }
  const field = typeArg === undefined ? `no type= (a "text" field)` : `type="${literal}"`;
  const kinds = INPUT_BIND_TYPES[base].map((v) => `type="${v}"`).join(" / ");
  errors.push({
    code: "E0226",
    kind: "input-bind-type",
    message: `input(bind=…) with ${field} cannot bind a value of type ${typeName}: ${base === "Int" ? "an" : "a"} ${base} binds with ${kinds} ${see}`,
    pos: typeArg !== undefined && !isTileExpr(typeArg) ? typeArg.pos : bindArg.value.pos,
  });
}

function armScope(arm: MatchArm, scrutType: TypeExpr | null, sym: SymbolTable, ctx: Ctx): Ctx {
  const inner = innerScope(ctx);
  checkPatternAgainstType(arm.pattern, scrutType, sym, [], inner);
  return inner;
}

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

function checkIconName(
  t: TileExpr & { kind: "TileCall" },
  sym: SymbolTable,
  errors: KumikiError[],
): void {
  if (t.name !== "icon") return;
  const nameArg = contentArg(t);
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
    const hasText = contentArg(t) !== undefined || t.props.some((p) => p.name === "text");
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

function checkContentArgs(t: TileExpr & { kind: "TileCall" }, errors: KumikiError[]): void {
  const reading = contentReading(t.name);
  if (!reading) return;
  const positional = t.args.filter((a) => a.name === undefined);
  const read = reading.positional ? 1 : 0;
  positional.slice(read).forEach((a, i) => {
    errors.push({
      code: "E0129",
      kind: "unrendered-arg",
      message: reading.positional
        ? `${t.name} renders its first positional argument only — positional argument ` +
          `${i + read + 1} is never rendered. Join the values (\`a + b\`, \`fmt(…)\`) or give ` +
          `each its own ${t.name}`
        : `${t.name} takes its ${reading.named} as \`${reading.named}=\` — a positional ` +
          `argument is never rendered. Write \`${t.name}(${reading.named}=…)\``,
      pos: a.value.pos,
      unrendered: "positional",
    });
  });
  if (!reading.positional) return;
  const named = t.args.find((a) => a.name === "text");
  if (!named?.name) return;
  if (reading.named === "text" && positional.length > 0) {
    errors.push({
      code: "E0129",
      kind: "unrendered-arg",
      message:
        `${t.name} renders its positional argument, so \`text=\` is never rendered — it is ` +
        `read only when no positional argument is written. Remove \`text=\` or the ` +
        `positional argument`,
      pos: named.namePos,
      unrendered: "text-shadowed",
    });
    return;
  }
  if (reading.named !== undefined || positional.length > 0) return;
  errors.push({
    code: "E0129",
    kind: "unrendered-arg",
    message:
      `content is positional: write \`${t.name}("…")\` — \`text=\` is a prop on ${t.name} ` +
      `and never renders (it is the label argument of button, link, label and editable)`,
    pos: named.namePos,
    unrendered: "text-prop",
  });
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
  checkContentArgs(t, errors);
  checkIconName(t, sym, errors);
  checkButtonType(t, errors);
  checkBindStrictProp(t, errors);
  checkBindTargetSteps(t, errors);
  checkToggleBind(t, sym, errors, ctx);
  checkInputBindType(t, sym, errors, ctx);
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
    if (arg.name !== undefined && HANDLER_NAMES.has(arg.name)) {
      checkHandlerBinding(t.name, arg.name, "arg", v, sym, errors);
      continue;
    }
    if (isTileExpr(v)) {
      checkTileExpr(v, sym, errors, ctx);
      continue;
    }
    if (
      arg.name === undefined &&
      positionalIsTile(t.name) &&
      !(v.kind === "Ref" && sym.tiles.has(v.name))
    ) {
      errors.push({
        code: "E0128",
        kind: "value-as-child",
        message:
          `A value is not a tile: ${t.name} renders a positional argument only when it is a ` +
          "tile, so this one renders nothing. Show the value with a tile — `text(…)` — or, " +
          "for a `let`, write the value where it is used or compute it in a `fn`",
        pos: v.pos,
      });
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

function checkHandlerBinding(
  tileName: string,
  handler: string,
  form: "arg" | "prop",
  value: Expr | TileExpr,
  sym: SymbolTable,
  errors: KumikiError[],
): void {
  checkHandlerTarget(tileName, handler, value.pos, sym, errors);
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

function checkHandlerTarget(
  tileName: string,
  handler: string,
  pos: Pos,
  sym: SymbolTable,
  errors: KumikiError[],
): void {
  const allowed = HANDLER_PROP_TILES[handler];
  if (allowed == null) return;
  if (BUILTIN_TILES.has(tileName)) {
    if (allowed.has(tileName)) return;
    errors.push(inertHandler(tileName, handler, `${tileName} does not fire it`, allowed, pos));
    return;
  }
  if (!sym.tiles.has(tileName)) return;
  const kinds = collectTileBuiltinKinds(tileName, sym);
  if (kinds.size === 0) return;
  if ([...kinds].some((k) => allowed.has(k))) return;
  errors.push(
    inertHandler(
      tileName,
      handler,
      `${tileName} renders nothing that fires it (observed in body: ${[...kinds].sort().join(", ")})`,
      allowed,
      pos,
    ),
  );
}

/** One W0213, whichever side — builtin or user tile — asked for it. */
function inertHandler(
  tileName: string,
  handler: string,
  because: string,
  allowed: ReadonlySet<string>,
  pos: Pos,
): KumikiError {
  return {
    code: "W0213",
    kind: "handler-on-inert-tile",
    severity: "warning",
    message: `"${handler}" on ${tileName}() is dropped — ${because}. Put it on ${[...allowed].sort().join(" / ")}, or subscribe with a reducer's on=ui.<event>(<Tile>)`,
    pos,
  };
}

function collectTileBuiltinKinds(
  tileName: string,
  sym: SymbolTable,
  visited: Set<string> = new Set(),
): Set<string> {
  if (visited.has(tileName)) return new Set();
  visited.add(tileName);
  if (BUILTIN_TILES.has(tileName)) return new Set([tileName]);
  const def = sym.tiles.get(tileName);
  if (!def) return new Set();
  const out = new Set<string>();
  for (const target of expansionTargets(def.body)) {
    for (const kind of collectTileBuiltinKinds(target.to, sym, visited)) out.add(kind);
  }
  return out;
}

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

function collectTileDeclaredIds(def: TileDef): TileIdCollection {
  return walkTileExprForDeclaredIds(def.body);
}

function walkTileExprForDeclaredIds(expr: TileExpr): TileIdCollection {
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

function bindsRoute(r: ReducerDef, sym: SymbolTable): boolean {
  if (r.on.kind === "LifecycleEvent" && r.on.name.startsWith("route.")) return true;
  return sym.prefetchTargets.has(r.name);
}

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

function effectPayloadType(
  effect: string,
  outcome: "ok" | "err",
  sym: SymbolTable,
): TypeExpr | null {
  const eff = sym.effects.get(effect);
  const out = eff?.outType;
  if (!eff || !out) return null;
  const u = unaliasType(out, sym);
  const result = u?.kind === "TypeApp" && u.name === "Result" ? u : null;
  if (outcome === "err") {
    if (!result || result.args.length !== 2 || !failsWithText(eff.cap)) return null;
    return { kind: "TypePrim", name: "Text", pos: eff.pos };
  }
  if (result) return result.args.length === 2 ? (result.args[0] ?? null) : null;
  return out;
}

function effectOutcomeType(
  effect: string,
  outcome: "ok" | "err",
  sym: SymbolTable,
): TypeExpr | null {
  if (outcome === "ok") return effectPayloadType(effect, "ok", sym);
  const out = unaliasType(sym.effects.get(effect)?.outType ?? null, sym);
  return out?.kind === "TypeApp" && out.name === "Result" && out.args.length === 2
    ? (out.args[1] ?? null)
    : null;
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
    const boundAt = new Map<string, number>();
    const trigger = r.on;
    trigger.binds.forEach((b, i) => {
      if (b.name === "_") return;
      if (RESERVED_BIND_NAMES.has(b.name)) {
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
      const type =
        i === 0 && !RESERVED_BIND_NAMES.has(b.name)
          ? effectPayloadType(trigger.effect, trigger.outcome, sym)
          : null;
      bindLocal(ctx, b.name, type);
    });
    if (!sym.effects.has(r.on.effect) && !BUILTIN_EFFECTS.has(r.on.effect)) {
      errors.push({
        code: "E0104",
        kind: "undef-effect",
        message: `Reference to undefined effect "${r.on.effect}"`,
        pos: r.on.effectPos,
      });
    }
  }
  const lifecycleTile = r.on.kind === "LifecycleEvent" ? r.on.tileTarget : undefined;
  if (lifecycleTile && !sym.tiles.has(lifecycleTile.name)) {
    errors.push({
      code: "E0211",
      kind: "undef-tile-in-selector",
      message: `Reducer "${r.name}" subscribes to ${lifecycleTile.event}(${lifecycleTile.name}) but tile "${lifecycleTile.name}" is not declared`,
      pos: lifecycleTile.pos,
    });
  }
  if (r.on.kind === "UiEvent" && r.on.selector.tile !== "_" && !sym.tiles.has(r.on.selector.tile)) {
    errors.push({
      code: "E0211",
      kind: "undef-tile-in-selector",
      message: `Reducer "${r.name}" subscribes to ui.${r.on.ev}(${r.on.selector.tile}) but tile "${r.on.selector.tile}" is not declared`,
      pos: r.on.pos,
    });
  }
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
  if (r.on.kind === "UiEvent" && r.on.selector.tile !== "_") {
    const allowed = UI_EVENT_TILE_KINDS[r.on.ev];
    if (allowed != null) {
      const descendants = collectTileBuiltinKinds(r.on.selector.tile, sym);
      const hasMatch = [...descendants].some((k) => allowed.has(k));
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
    const bodyWrites = new Set<string>(writtenRoots);
    for (const st of s.body) checkStmt(st, sym, errors, inner, bodyWrites);
    for (const r of bodyWrites) writtenRoots.add(r);
    return;
  }
  if (s.kind === "IfStmt") {
    checkExpr(s.cond, sym, errors, ctx);
    checkCondition(s.cond, inferType(s.cond, sym, ctx), sym, errors, '"if"');
    const thenWrites = new Set<string>(writtenRoots);
    const thenScope = innerScope(ctx);
    for (const st of s.consequent) checkStmt(st, sym, errors, thenScope, thenWrites);
    const elseWrites = new Set<string>(writtenRoots);
    const elseScope = innerScope(ctx);
    for (const st of s.alternate) checkStmt(st, sym, errors, elseScope, elseWrites);
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
  if (lv.kind === "LIndex") {
    checkExpr(lv.index, sym, errors, ctx);
    checkIndexLvalue(lv, sym, errors, ctx);
  } else {
    const raw = lvalueType(lv.base, sym);
    const base = unaliasType(raw, sym);
    if (base) {
      lv.accessKind = "shortcut";
      checkMemberLvalue(lv, raw, base, sym, errors);
    }
  }
  checkLvalue(lv.base, sym, errors, ctx);
}

function checkIndexLvalue(
  lv: Lvalue & { kind: "LIndex" },
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  const base = unaliasType(lvalueType(lv.base, sym), sym);
  checkListIndex(base, lv.index, sym, errors, ctx);
  if (base?.kind !== "TypeApp" || base.name !== "Set") return;
  errors.push({
    code: "E0602",
    kind: "unassignable-member",
    message: `Cannot assign through an index into "${typeName(base, sym)}": a Set has members, not places — use .add / .remove / .toggle`,
    pos: lv.pos,
  });
}

function checkListIndex(
  base: TypeExpr | null,
  index: Expr,
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  if (base?.kind !== "TypeApp" || base.name !== "List") return;
  checkAgainst(index, prim("Int", index.pos), sym, errors, ctx);
}

function checkMemberLvalue(
  lv: Lvalue & { kind: "LField" },
  raw: TypeExpr | null,
  base: TypeExpr,
  sym: SymbolTable,
  errors: KumikiError[],
): void {
  switch (classifyMember(raw, lv.field, sym)) {
    case "field":
      lv.accessKind = "field";
      return;

    case "member":
      if (lv.field === "get" && unwrappedType(base) !== null) return;
      errors.push({
        code: "E0602",
        kind: "unassignable-member",
        message: `Cannot assign through ".${lv.field}": it is a member of "${receiverName(raw, base, sym)}", not a field`,
        pos: lv.pos,
      });
      return;

    case "unknown":
      errors.push(undefMemberError(raw, base, lv.field, lv.pos, sym));
      return;

    case "undecidable":
      // A receiver we do not fully understand. Silent, exactly as on the read
      // side: a false error on a dynamic receiver is worse than the silence.
      return;
  }
}

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
  if (!fn && UNIMPLEMENTED_CALLS.has(callee)) {
    errors.push({
      code: "E0802",
      kind: "unimplemented-function",
      message: `Function "${callee}" is documented but not implemented by the runtime`,
      pos,
    });
    return;
  }
  const dot = callee.indexOf(".");
  if (
    dot > 0 &&
    argCount === 0 &&
    QUALIFIED_CALL_NAMESPACES.has(callee.slice(0, dot)) &&
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
  if (dot > 0 && TYPE_MEMBER_CALLS.has(callee.slice(dot + 1))) {
    const qualifier = callee.slice(0, dot);
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
    const typeArity =
      isQualifierName(qualifier) && isKnownTypeName(qualifier, sym)
        ? constructorArity(qualifier, sym)
        : 0;
    if (typeArity !== 0) {
      const wanted =
        typeArity === null
          ? "type arguments"
          : `${typeArity} type argument${typeArity === 1 ? "" : "s"}`;
      const member = callee.slice(dot + 1);
      const readable =
        member === "parse"
          ? ` and whose base has a reading of a text (${PARSE_READINGS_PHRASE})`
          : member === "fresh"
            ? " and that a Text goes into"
            : "";
      errors.push({
        code: "E0124",
        kind: "type-constructor-qualifier",
        message: `Type "${qualifier}" takes ${wanted}, so it is not a type on its own — "${callee}" needs one that takes none${readable}`,
        pos,
      });
      return;
    }
    if (
      callee.slice(dot + 1) === "parse" &&
      isQualifierName(qualifier) &&
      parseQualifier(qualifier, sym).kind === "none"
    ) {
      errors.push({
        code: "E0802",
        kind: "unimplemented-function",
        message: `"${qualifier}" has no reading of a text — parse into ${PARSE_READINGS_PHRASE} and build it in a fn`,
        pos,
      });
      return;
    }
    if (
      callee.slice(dot + 1) === "fresh" &&
      isQualifierName(qualifier) &&
      qualifierType(qualifier, pos, sym) !== null &&
      freshResultType(qualifier, pos, sym) === null
    ) {
      errors.push({
        code: "E0802",
        kind: "unimplemented-function",
        message: `"${qualifier}" is not a Text, and fresh mints a uuid Text — declare the id nominal Text`,
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
      return;
    }
    if (callee === "fmt") reportFmtPlaceholders(args, pos, errors);
    const text = args[0];
    if (dot > 0 && callee.slice(dot + 1) === "parse" && text) {
      checkAgainst(text, prim("Text", pos), sym, errors, ctx);
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

function reportRunReducerPosition(ctx: Ctx, pos: Pos, errors: KumikiError[]): void {
  if (ctx.runReducerScope) return;
  errors.push({
    code: "E0116",
    kind: "undef-call",
    message: 'Call to "run-reducer" outside a property-test invariant',
    pos,
  });
}

function reportFmtPlaceholders(args: Expr[], pos: Pos, errors: KumikiError[]): void {
  const template = args[0];
  if (template?.kind !== "Str") return;
  const supplied = args.length - 1;
  const indices = new Set<number>();
  for (const m of template.value.matchAll(/\{(\d+)\}/g)) indices.add(Number(m[1]));
  const missing = [...indices].filter((i) => i >= supplied).sort((a, b) => a - b);
  const unused = [...Array(supplied).keys()].filter((i) => !indices.has(i));
  if (missing.length === 0 && unused.length === 0) return;
  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(
      `${missing.map((i) => `{${i}}`).join(", ")} ${missing.length === 1 ? "has" : "have"} no argument`,
    );
  }
  if (unused.length > 0) {
    parts.push(
      `argument${unused.length === 1 ? "" : "s"} ${unused.map((i) => i + 2).join(", ")} ${unused.length === 1 ? "is" : "are"} named by no placeholder`,
    );
  }
  errors.push({
    code: "W0214",
    kind: "fmt-placeholder-argument-mismatch",
    message: `fmt template and arguments disagree: ${parts.join("; ")}`,
    pos,
    severity: "warning",
  });
}

function wantedArguments(arity: BuiltinArity): string {
  const count = `${arity.min} argument(s)`;
  return arity.min === arity.max ? count : `at least ${count}`;
}

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
    case "Ref": {
      if (
        (e.name === "route" || e.name === "$route") &&
        ctx.kind === "app-init" &&
        !ctx.localBinds.has(e.name)
      ) {
        ctx.routeReadsSeen?.push({ name: e.name, pos: e.pos });
        errors.push({
          code: "E0120",
          kind: "route-in-app-init",
          message: routeInAppInitMessage(e.name),
          pos: e.pos,
        });
        return;
      }
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
      const fn = sym.fns.get(e.name);
      if (fn) {
        errors.push({
          code: "E0127",
          kind: "fn-as-value",
          message: `"${e.name}" is a fn, and a fn is not a value — write the call: ${e.name}(${fn.params.map((p) => p.name).join(", ")})`,
          pos: e.pos,
        });
        return;
      }
      // Could be a built-in like `route`
      if (e.name === "route" || e.name === "now" || e.name === "self") return;
      if (e.name === "$1" && ctx.kind === "tile") {
        ctx.undeclaredInputReads?.push(e.pos);
        errors.push({
          code: "E0103",
          kind: "undef-ref",
          message: `"$1" is undefined here — a tile can only use "$1" if it declares an "in=" argument (e.g. \`tile X in=SomeType = …\`)`,
          pos: e.pos,
        });
        return;
      }
      if (e.name === "$2" && ctx.oneValueFragment !== undefined) {
        const { method, hides } = ctx.oneValueFragment;
        errors.push({
          code: "E0103",
          kind: "undef-ref",
          message: hides
            ? `"$2" is not bound here — the .${method} fragment is handed one value, "$1", and its positionals hide the enclosing "$2": refer to that value by its name`
            : `"$2" is not bound here — the .${method} fragment is handed one value, "$1"; "$2" is bound only over a Map's filter or map, or a pair (Tuple(A, B), e.g. from .entries)`,
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
    }
    case "Variant":
      for (const p of e.payload) checkExpr(p, sym, errors, ctx);
      return;
    case "BinOp": {
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
      checkListIndex(unaliasType(inferType(e.base, sym, ctx), sym), e.index, sym, errors, ctx);
      return;
    case "Call":
      if (ctx.kind === "test" && e.callee === "run-reducer") {
        reportRunReducerPosition(ctx, e.pos, errors);
        return;
      }
      for (const a of e.args) checkExpr(a, sym, errors, ctx);
      checkCallee(e.callee, e.args, e.pos, sym, errors, ctx);
      return;
    case "MethodCall": {
      // The chained spelling of the same thing: `run-reducer(inc).run-reducer(dec)`.
      if (ctx.kind === "test" && e.method === "run-reducer") {
        checkExpr(e.receiver, sym, errors, ctx);
        reportRunReducerPosition(ctx, e.pos, errors);
        return;
      }
      let lacksMember = false;
      if (!KNOWN_METHODS.has(e.method)) {
        errors.push({
          code: "E0801",
          kind: "unimplemented-method",
          message: `Method ".${e.method}" is not implemented by the runtime`,
          pos: e.pos,
        });
      }
      else {
        const raw = inferType(e.receiver, sym, ctx);
        const rt = unaliasType(raw, sym);
        const recordUpdate = e.method === "copy" && rt?.kind === "TypeRecord";
        if (rt && !recordUpdate && classifyMember(raw, e.method, sym) === "unknown") {
          errors.push(undefMemberError(raw, rt, e.method, e.pos, sym));
          lacksMember = true;
        }
      }
      if (!lacksMember) {
        const min = METHOD_MIN_ARGS.get(e.method);
        if (e.method === "get") {
          checkGetArity(e, sym, errors, ctx);
        } else if (min !== undefined && e.args.length < min) {
          errors.push({
            code: "E0213",
            kind: "call-arity-mismatch",
            message: `Method ".${e.method}" expects ${min} argument(s) but got ${e.args.length}`,
            pos: e.pos,
          });
        } else if (e.method === "get-or") {
          checkGetOrArity(e, sym, errors, ctx);
        }
      }
      checkExpr(e.receiver, sym, errors, ctx);
      if (e.method === "copy") checkRecordUpdate(e, sym, errors, ctx);
      {
        const recvType =
          e.args.length > 0 || KEY_READER_NAMES.has(e.method)
            ? inferType(e.receiver, sym, ctx)
            : null;
        const kind = keyKindOfReader(recvType, e.method, sym);
        if (kind) e.keyKind = kind;
        const fragment = FRAGMENT_ARGUMENTS.get(e.method);
        const shape =
          fragment?.second === "pair-value" ? fragmentShape(recvType, e.method, sym) : undefined;
        if (shape !== undefined) e.fragmentShape = shape ?? "undecided";
        for (const [i, a] of e.args.entries()) {
          if (fragment?.index !== i) {
            checkExpr(a, sym, errors, ctx);
            const declared = memberArgType(recvType, e.method, i, sym);
            if (declared !== null) checkAgainst(a, declared, sym, errors, ctx);
            continue;
          }
          if (isFragmentFnName(a, sym, ctx)) {
            ctx.fragmentFnCallsSeen?.push({ name: a.name, pos: a.pos });
            if (lacksMember) continue;
            const fits = checkFragmentFnArity(a, e.method, fragment, recvType, shape, sym, errors);
            if (fits && e.method === "sort-by" && i === 0) {
              checkSortKey(sym.fns.get(a.name)?.ret ?? null, a.pos, recvType, sym, errors);
            }
            continue;
          }
          const [p1, p2] = fragmentBindings(recvType, e.method, i, sym);
          const inner = innerScope(ctx);
          bindLocal(inner, "$1", p1);
          if (shape === "value") {
            inner.localBinds.delete("$2");
            inner.localTypes.delete("$2");
            inner.oneValueFragment = { method: e.method, hides: ctx.localBinds.has("$2") };
          } else if (fragment.binds === 2) {
            bindLocal(inner, "$2", p2);
          }
          checkExpr(a, sym, errors, inner);
          if (e.method === "sort-by" && i === 0) {
            checkSortKey(inferType(a, sym, inner), a.pos, recvType, sym, errors);
          }
          const declared = memberArgType(recvType, e.method, i, sym);
          if (declared !== null) checkAgainst(a, declared, sym, errors, inner);
        }
      }
      if (e.method === "get-or") {
        const want = getOrResultType(
          unaliasType(inferType(e.receiver, sym, ctx), sym),
          e.args.length,
        );
        const fallback = e.args.at(-1);
        if (want !== null && fallback !== undefined) checkAgainst(fallback, want, sym, errors, ctx);
      }
      return;
    }
    case "Wildcard":
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
      checkExpr(e.body, sym, errors, letInScope(e, sym, ctx));
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

function isFragmentFnName(a: Expr, sym: SymbolTable, ctx: Ctx): a is Expr & { kind: "Ref" } {
  return (
    a.kind === "Ref" && !ctx.localBinds.has(a.name) && !sym.slots.has(a.name) && sym.fns.has(a.name)
  );
}

function checkFragmentFnArity(
  a: Expr & { kind: "Ref" },
  method: string,
  fragment: { binds: 1 | 2; second?: "element" | "pair-value" },
  receiver: TypeExpr | null,
  shape: FragmentShape | null | undefined,
  sym: SymbolTable,
  errors: KumikiError[],
): boolean {
  const n = sym.fns.get(a.name)?.params.length ?? 0;
  const report = (why: string): false => {
    errors.push({
      code: "E0213",
      kind: "call-arity-mismatch",
      message: `Function "${a.name}" expects ${n} argument(s) but ${why}`,
      pos: a.pos,
    });
    return false;
  };
  if (fragment.second === "element") {
    return n === 2 || report(`.${method} supplies exactly 2 — the accumulator and the element`);
  }
  if (n === 0) return report(`.${method} needs at least 1`);
  if (n > fragment.binds) return report(`.${method} supplies at most ${fragment.binds}`);
  if (n === 2 && (shape === "value" || shape === null)) {
    const on = receiver ? ` on "${typeToString(receiver)}"` : "";
    return report(
      `.${method}${on} supplies 1 — a second positional is bound only over a Map's filter or map, or a pair (Tuple(A, B), e.g. from .entries)`,
    );
  }
  return true;
}

const COMPARISON_OPS: ReadonlySet<string> = new Set(["<", ">", "<=", ">="]);
const BOOLEAN_OPS: ReadonlySet<string> = new Set(["&", "|"]);
const EQUALITY_OPS: ReadonlySet<string> = new Set(["==", "!="]);

function orderingFamily(t: TypeExpr | null, sym: SymbolTable): string | null {
  if (isNumeric(t, sym)) return "number";
  if (isPrimNamed(t, sym, "Text")) return "text";
  if (isPrimNamed(t, sym, "Time")) return "time";
  return null;
}

function checkSortKey(
  t: TypeExpr | null,
  pos: Pos,
  recv: TypeExpr | null,
  sym: SymbolTable,
  errors: KumikiError[],
): void {
  const r = unaliasType(recv, sym);
  if (r?.kind !== "TypeApp" || r.name !== "List") return;
  if (!isKnown(t, sym) || orderingFamily(t, sym) !== null) return;
  errors.push({
    code: "E0201",
    kind: "type-mismatch",
    message: `".sort-by" orders by its key as "<" does, which needs a number, Text or Time, but the key is ${typeToString(t as TypeExpr)}`,
    pos,
  });
}

function binOpResult(e: Expr & { kind: "BinOp" }, sym: SymbolTable, ctx: Ctx): TypeExpr | null {
  if (COMPARISON_OPS.has(e.op) || BOOLEAN_OPS.has(e.op) || EQUALITY_OPS.has(e.op))
    return prim("Bool", e.pos);
  const lt = inferType(e.lhs, sym, ctx);
  const rt = inferType(e.rhs, sym, ctx);
  if (e.op === "+") {
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
  const incomparable = (): void => {
    errors.push({
      code: "E0201",
      kind: "type-mismatch",
      message: `Operator "${e.op}" cannot compare ${typeToString(lt as TypeExpr)} with ${typeToString(rt as TypeExpr)}`,
      pos: e.pos,
    });
  };

  if (COMPARISON_OPS.has(e.op)) {
    if (!isKnown(lt, sym) || !isKnown(rt, sym)) return;
    const lf = orderingFamily(lt, sym);
    if (lf !== null && lf === orderingFamily(rt, sym) && nominallyComparable(lt, rt, sym)) return;
    incomparable();
    return;
  }
  if (EQUALITY_OPS.has(e.op)) {
    if (!nominallyComparable(lt, rt, sym)) incomparable();
  }
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

const MISMATCH_KIND = {
  E0201: "type-mismatch",
  E0202: "emit-arg-type-mismatch",
} as const;

type MismatchCode = keyof typeof MISMATCH_KIND;

function pushMismatch(errors: KumikiError[], code: MismatchCode, message: string, pos: Pos): void {
  errors.push({ code, kind: MISMATCH_KIND[code], message, pos });
}

/** The scope a `let … in` body is read in: the enclosing one, with the name bound. */
function letInScope(e: Expr & { kind: "LetIn" }, sym: SymbolTable, ctx: Ctx): Ctx {
  const inner: Ctx = {
    ...ctx,
    localBinds: new Set(ctx.localBinds),
    localTypes: new Map(ctx.localTypes),
  };
  bindLocal(inner, e.name, inferType(e.value, sym, ctx));
  return inner;
}

function memberArgType(
  recv: TypeExpr | null,
  member: string,
  index: number,
  sym: SymbolTable,
): TypeExpr | null {
  const t = unaliasType(recv, sym);
  if (t?.kind !== "TypeApp") return null;
  const [a, b] = t.args;
  switch (t.name) {
    case "List":
      return index === 0 && LIST_ELEMENT_ARGS.has(member) ? (a ?? null) : null;
    case "Map":
      return index === 1 && MAP_VALUE_ARGS.has(member) ? (b ?? null) : null;
    case "Set":
      return index === 0 && SET_OPERANDS.has(member) ? recv : null;
    default:
      return null;
  }
}

const LIST_ELEMENT_ARGS: ReadonlySet<string> = new Set(["contains", "push", "prepend"]);
const MAP_VALUE_ARGS: ReadonlySet<string> = new Set(["insert", "update"]);
const SET_OPERANDS: ReadonlySet<string> = new Set(["union", "intersect", "diff"]);

function checkAgainst(
  e: Expr,
  declared: TypeExpr | null,
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
  code: MismatchCode = "E0201",
  omittable?: Omittable,
): void {
  if (declared === null) return;
  if (declared === REDUCER_REF) {
    checkReducerRef(e, sym, errors, ctx, code);
    return;
  }
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
    if (d.name === "Set") e.asSet = true;
    for (const item of e.items) checkAgainst(item, d.args[0] ?? null, sym, errors, ctx, code);
    return;
  }
  if (d.kind === "TypeApp" && d.name === "Tuple" && e.kind === "TupleLit") {
    if (e.items.length !== d.args.length) {
      pushMismatch(
        errors,
        code,
        `Expected ${typeToString(declared)} but got a tuple of ${e.items.length} item(s)`,
        e.pos,
      );
      return;
    }
    for (let i = 0; i < e.items.length; i++) {
      checkAgainst(e.items[i] as Expr, d.args[i] ?? null, sym, errors, ctx, code);
    }
    return;
  }
  if (d.kind === "TypeApp" && e.kind === "MapLit") {
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
    checkRecordLit(e, d, sym, errors, ctx, code, omittable);
    return;
  }
  if (e.kind === "Variant") {
    checkVariantAgainst(e, d, declared, sym, errors, ctx, code);
    return;
  }
  if (e.kind === "IfExpr") {
    checkAgainst(e.consequent, declared, sym, errors, ctx, code, omittable);
    checkAgainst(e.alternate, declared, sym, errors, ctx, code, omittable);
    return;
  }
  if (e.kind === "LetIn") {
    // The body is the value that lands here, read with the name bound.
    checkAgainst(e.body, declared, sym, errors, letInScope(e, sym, ctx), code, omittable);
    return;
  }
  if (e.kind === "MatchExpr") {
    const scrutType = inferType(e.scrutinee, sym, ctx);
    for (const arm of e.arms) {
      const scope = armScope(arm, scrutType, sym, ctx);
      checkAgainst(arm.body, declared, sym, errors, scope, code, omittable);
    }
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
      message: `Int literal ${e.raw ?? e.value} is not exactly representable and was rounded to ${e.value}`,
      pos: e.pos,
    });
    return;
  }

  const actual = inferType(e, sym, ctx);
  if (actual === null || !isKnown(actual, sym)) return;
  const want = omittable ? withoutOmitted(d, actual, sym, omittable) : declared;
  if (!assignable(actual, want ?? declared, sym)) mismatch(e, actual);
}

function withoutOmitted(
  d: TypeExpr,
  actual: TypeExpr,
  sym: SymbolTable,
  omittable: Omittable,
): TypeExpr | null {
  const a = unaliasType(actual, sym);
  if (d.kind !== "TypeRecord" || a?.kind !== "TypeRecord") return null;
  const has = new Set(a.fields.map((f) => f.name));
  return { ...d, fields: d.fields.filter((f) => has.has(f.name) || !omittable(f)) };
}

function checkReducerRef(
  e: Expr,
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
  code: MismatchCode,
): void {
  if (e.kind === "Ref") return;
  const actual = inferType(e, sym, ctx);
  pushMismatch(
    errors,
    code,
    `Expected ${typeToString(REDUCER_REF)} but got ${actual ? typeToString(actual) : "an expression that is not a reducer name"}`,
    e.pos,
  );
}

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
  omittable?: Omittable,
): void {
  const given = new Set(e.fields.map((f) => f.name));
  for (const declaredField of d.fields) {
    if (given.has(declaredField.name) || omittable?.(declaredField)) continue;
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

function unwrappedType(t: TypeExpr): TypeExpr | null {
  if (t.kind !== "TypeApp") return null;
  if (t.name !== "Option" && t.name !== "Result") return null;
  return t.args[0] ?? null;
}

function checkGetOrArity(
  e: Expr & { kind: "MethodCall" },
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  const recv = unaliasType(inferType(e.receiver, sym, ctx), sym);
  const isMap = recv?.kind === "TypeApp" && recv.name === "Map";
  const unwraps = recv?.kind === "TypeApp" && (recv.name === "Option" || recv.name === "Result");

  if (recv?.kind === "TypeApp" && (isMap || unwraps)) {
    const want = isMap ? 2 : 1;
    if (e.args.length === want) return;

    const taken = isMap ? "(key, default)" : "(default)";
    const other = isMap
      ? '".get-or(default)" is the "Option" / "Result" reading'
      : '".get-or(key, default)" is the "Map" reading';
    errors.push({
      code: "E0213",
      kind: "call-arity-mismatch",
      message: `Method ".get-or" on "${recv.name}" expects ${want} argument(s) ${taken} but got ${e.args.length} — ${other}`,
      pos: e.pos,
    });
    return;
  }

  if (e.args.length > 2) {
    errors.push({
      code: "E0213",
      kind: "call-arity-mismatch",
      message: `Method ".get-or" expects 1 argument(s) (default) or 2 (key, default) but got ${e.args.length} — no receiver has a reading that takes more`,
      pos: e.pos,
    });
  }
}

function checkGetArity(
  e: Expr & { kind: "MethodCall" },
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  const recv = unaliasType(inferType(e.receiver, sym, ctx), sym);
  const keyed = recv?.kind === "TypeApp" && (recv.name === "Map" || recv.name === "List");
  const unwraps = recv?.kind === "TypeApp" && (recv.name === "Option" || recv.name === "Result");

  if (recv?.kind === "TypeApp" && (keyed || unwraps)) {
    if (e.args.length === (keyed ? 1 : 0)) return;
    const message = keyed
      ? `Method ".get" on "${recv.name}" expects 1 argument (${
          recv.name === "Map" ? "key" : "index"
        }) but got ${e.args.length} — ".get" with no arguments is the "Option" / "Result" reading`
      : `Method ".get" on "${recv.name}" takes no arguments and unwraps, but got ${e.args.length} — ".get(key)" is the "Map" reading and ".get(index)" the "List" one`;
    errors.push({ code: "E0213", kind: "call-arity-mismatch", message, pos: e.pos });
    return;
  }

  if (e.args.length > 1) {
    errors.push({
      code: "E0213",
      kind: "call-arity-mismatch",
      message: `Method ".get" takes no arguments or one, but got ${e.args.length} — no receiver has a reading that takes more`,
      pos: e.pos,
    });
  }
}

function getOrResultType(recv: TypeExpr | null, argCount: number): TypeExpr | null {
  if (recv?.kind !== "TypeApp") return null;
  if (recv.name === "Map") return argCount === 2 ? (recv.args[1] ?? null) : null;
  return argCount === 1 ? unwrappedType(recv) : null;
}

function lvalueType(lv: Lvalue, sym: SymbolTable): TypeExpr | null {
  if (lv.kind === "LSlot") return sym.slots.get(lv.name)?.type ?? null;
  const base = unaliasType(lvalueType(lv.base, sym), sym);
  if (!base) return null;
  if (lv.kind === "LField") {
    if (base.kind === "TypeRecord") return recordFieldType(base, lv.field);
    if (lv.field === "get") return unwrappedType(base);
    return null;
  }
  if (base.kind === "TypeApp") {
    // A `Set` index is not a place (`checkIndexLvalue`), so it has no type for
    // a right-hand side to be checked against.
    if (base.name === "List") return base.args[0] ?? null;
    if (base.name === "Map") return base.args[1] ?? null;
  }
  return null;
}
function checkEmitTarget(
  effect: string,
  args: Expr[],
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
  pos: Pos,
): void {
  const input = effectInput(effect, sym);
  if (!input) {
    errors.push({
      code: "E0104",
      kind: "undef-effect",
      message: `Reference to undefined effect "${effect}"`,
      pos,
    });
    return;
  }
  const { cap, inType, omittable } = input;
  if (cap !== null && ctx.capsAvailable && !ctx.capsAvailable.has(cap)) {
    errors.push({
      code: "E0301",
      kind: "missing-capability",
      message: `Effect "${effect}" requires capability "${cap}" which is not declared in app.caps`,
      pos,
    });
  }
  const wants = isPrimNamed(inType, sym, "Unit") ? 0 : 1;
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
  if (isPrimNamed(inType, sym, "EffectId")) {
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
  checkAgainst(arg, inType, sym, errors, ctx, "E0202", omittable);
}

type Omittable = (field: { readonly name: string; readonly type: TypeExpr }) => boolean;

function effectInput(
  name: string,
  sym: SymbolTable,
): { cap: string | null; inType: TypeExpr; omittable: Omittable | undefined } | undefined {
  const eff = sym.effects.get(name);
  if (eff) return { cap: eff.cap, inType: eff.inType, omittable: undefined };
  const builtin = BUILTIN_EFFECTS.get(name);
  if (!builtin) return undefined;
  return {
    cap: builtin.cap,
    inType: builtin.inType,
    omittable: (f) => builtinFieldOmittable(builtin, f),
  };
}

const KNOWN_TOKEN_GROUPS: ReadonlySet<string> = new Set([
  "colors",
  "spacing",
  "radius",
  "shadow",
  "typography",
  "breakpoints",
]);

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
]);

const CALL_RESULT: ReadonlyMap<string, PrimName> = new Map<string, PrimName>([
  ["now", "Time"],
  ["random", "Float"],
  ["fmt", "Text"],
  ["file-url", "Text"],
  ["prefers-dark", "Bool"],
  ["EffectId.none", "EffectId"],
]);

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

function freshResultType(qualifier: string, pos: Pos, sym: SymbolTable): TypeExpr | null {
  const named = qualifierType(qualifier, pos, sym);
  if (named === null) return null;
  return assignable(prim("Text", pos), named, sym) ? named : null;
}

function receiverMemberResult(
  recv: TypeExpr | null,
  member: string,
  argCount: number,
  sym: SymbolTable,
  pos: Pos,
): TypeExpr | null {
  const t = unaliasType(recv, sym);
  if (!t) return null;
  const receivers = memberReceivers(recv, t, sym);
  if (receivers === null || !receivers.some((r) => hasMember(r, member))) return null;

  const int = () => prim("Int", pos);
  const bool = () => prim("Bool", pos);
  const text = () => prim("Text", pos);
  const list = (of: TypeExpr) => container("List", [of], pos);
  const option = (of: TypeExpr) => container("Option", [of], pos);

  if (t.kind === "TypePrim" && t.name === "Text") {
    if (!isOwnMember("Text", member)) return null;
    switch (member) {
      case "length":
        return int();
      case "is-empty":
      case "starts-with":
      case "ends-with":
      case "contains":
        return bool();
      case "upper":
      case "lower":
      case "trim":
      case "replace":
      case "slice":
        return text();
      case "split":
        return list(text());
      case "parse-int":
        return option(int());
      case "parse-float":
        return option(prim("Float", pos));
      default:
        return unlisted(member);
    }
  }

  if (t.kind !== "TypeApp") return null;

  const a0 = t.args[0] ?? null;
  const a1 = t.args[1] ?? null;

  switch (t.name) {
    case "Map":
      if (!isOwnMember("Map", member)) return null;
      switch (member) {
        case "size":
          return int();
        case "is-empty":
        case "has":
          return bool();
        case "keys":
          return a0 && list(a0);
        case "values":
          return a1 && list(a1);
        case "entries":
          return a0 && a1 ? list(container("Tuple", [a0, a1], pos)) : null;
        case "get":
          return argCount === 1 && a1 ? option(a1) : null;
        case "get-or":
          return getOrResultType(t, argCount);
        case "insert":
        case "remove":
        case "update":
        case "merge":
        case "filter":
          return t;
        case "map":
          return null;
        default:
          return unlisted(member);
      }
    case "Set":
      if (!isOwnMember("Set", member)) return null;
      switch (member) {
        case "size":
          return int();
        case "has":
          return bool();
        case "add":
        case "remove":
        case "toggle":
        case "union":
        case "intersect":
        case "diff":
        case "filter":
          return t;
        case "to-list":
          return a0 && list(a0);
        default:
          return unlisted(member);
      }
    case "List":
      if (!isOwnMember("List", member)) return null;
      switch (member) {
        case "length":
          return int();
        case "is-empty":
        case "contains":
          return bool();
        case "get":
          return argCount === 1 && a0 ? option(a0) : null;
        case "head":
        case "last":
        case "find":
          return a0 && option(a0);
        case "tail":
        case "push":
        case "prepend":
        case "concat":
        case "slice":
        case "reverse":
        case "sort":
        case "sort-by":
        case "unique":
        case "filter":
          return t;
        case "join":
          return text();
        case "chunk":
          return list(t);
        case "map":
        case "fold":
        case "zip":
          return null;
        default:
          return unlisted(member);
      }
    case "Option":
      if (!isOwnMember("Option", member)) return null;
      switch (member) {
        case "is-some":
        case "is-none":
          return bool();
        case "get":
          return argCount === 0 ? unwrappedType(t) : null;
        case "get-or":
          return getOrResultType(t, argCount);
        case "filter":
        case "or":
          return t;
        case "to-list":
          return a0 && list(a0);
        case "map":
        case "flat-map":
          return null;
        default:
          return unlisted(member);
      }
    case "Result":
      if (!isOwnMember("Result", member)) return null;
      switch (member) {
        case "is-ok":
        case "is-err":
          return bool();
        case "get":
          return argCount === 0 ? unwrappedType(t) : null;
        case "get-err":
          return argCount === 0 ? a1 : null;
        case "get-or":
          return getOrResultType(t, argCount);
        case "or":
          return t;
        case "to-option":
          return a0 && option(a0);
        case "map":
        case "map-err":
        case "flat-map":
          return null;
        default:
          return unlisted(member);
      }
    default:
      return null;
  }
}

function unlisted(_member: never): null {
  return null;
}

/** Best-effort static type of an expression; `null` = undecidable / dynamic. */
function inferType(e: Expr, sym: SymbolTable, ctx: Ctx): TypeExpr | null {
  switch (e.kind) {
    case "Num":
      return prim(Number.isInteger(e.value) ? "Int" : "Float", e.pos);
    case "Str":
      return { kind: "TypePrim", name: "Text", pos: e.pos };
    case "Bool":
      return { kind: "TypePrim", name: "Bool", pos: e.pos };
    case "Unit":
      return prim("Unit", e.pos);
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
      const decided = receiverMemberResult(base, e.field, 0, sym, e.pos);
      if (decided) return decided;
      // A member whose result is the same whatever the receiver (`n.show`,
      // `f.to-int`).
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
      if (e.method === "copy") return inferType(e.receiver, sym, ctx);
      if (e.method === "run-reducer" && ctx.runReducerScope) return runReducerState(sym, e.pos);
      const decided = receiverMemberResult(
        inferType(e.receiver, sym, ctx),
        e.method,
        e.args.length,
        sym,
        e.pos,
      );
      if (decided) return decided;
      const fixed = METHOD_RESULT.get(e.method);
      return fixed ? prim(fixed, e.pos) : null;
    }
    case "RecordLit":
      return {
        kind: "TypeRecord",
        fields: e.fields.map((f) => ({
          name: f.name,
          type: inferType(f.value, sym, ctx) ?? unknownType(f.value.pos),
          pos: f.pos ?? f.value.pos,
        })),
        pos: e.pos,
      };
    case "ListLit": {
      const elem = commonType(
        e.items.map((it) => inferType(it, sym, ctx)),
        sym,
      );
      return container("List", [elem ?? unknownType(e.pos)], e.pos);
    }
    case "TupleLit":
      return container(
        "Tuple",
        e.items.map((it) => inferType(it, sym, ctx) ?? unknownType(it.pos)),
        e.pos,
      );
    case "MapLit": {
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
      if (e.name === "None") return container("Option", [unknownType(e.pos)], e.pos);
      if (e.name === "Ok") return container("Result", [inner, unknownType(e.pos)], e.pos);
      if (e.name === "Err") return container("Result", [unknownType(e.pos), inner], e.pos);
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
    case "MatchExpr": {
      const scrutType = inferType(e.scrutinee, sym, ctx);
      return commonType(
        e.arms.map((arm) => inferType(arm.body, sym, armScope(arm, scrutType, sym, ctx))),
        sym,
      );
    }
    case "EmitExpr":
      return prim("EffectId", e.pos);
    case "Call": {
      if (e.callee === "run-reducer" && ctx.runReducerScope) return runReducerState(sym, e.pos);
      const fixed = CALL_RESULT.get(e.callee);
      if (fixed) return prim(fixed, e.pos);
      const dot = e.callee.indexOf(".");
      const qualifier = dot > 0 ? e.callee.slice(0, dot) : null;
      const member =
        qualifier !== null && isQualifierName(qualifier) ? e.callee.slice(dot + 1) : null;
      if (member === "show") return prim("Text", e.pos);
      if (qualifier !== null && member === "parse") {
        const named = qualifierType(qualifier, e.pos, sym);
        return named === null ? null : container("Option", [named], e.pos);
      }
      if (qualifier === "Duration") return { kind: "TypeRef", name: "Duration", pos: e.pos };
      if (qualifier === "Bytes") return prim("Bytes", e.pos);
      if (qualifier !== null && member === "fresh") return freshResultType(qualifier, e.pos, sym);
      return sym.fns.get(e.callee)?.ret ?? null;
    }
    default:
      return null;
  }
}

function runReducerState(sym: SymbolTable, pos: Pos): TypeExpr {
  const declared = [...sym.slots.values()].map((s) => ({ name: s.name, type: s.type, pos: s.pos }));
  // The runtime's own slots (`route`) are in the state too, with a type the
  // program does not declare — present, and undecided.
  const reserved = [...RESERVED_SLOT_NAMES.keys()]
    .filter((name) => !sym.slots.has(name))
    .map((name) => ({ name, type: unknownType(pos), pos }));
  const slots: TypeExpr = { kind: "TypeRecord", fields: [...declared, ...reserved], pos };
  return { kind: "TypeRecord", fields: [{ name: "slots", type: slots, pos }], pos };
}

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

type MemberClass = "field" | "member" | "unknown" | "undecidable";

function classifyMember(raw: TypeExpr | null, field: string, sym: SymbolTable): MemberClass {
  const t = unaliasType(raw, sym);
  if (!t) return "undecidable";

  if (t.kind === "TypeRecord") {
    if (recordFieldType(t, field) !== null) return "field";
    return UNIVERSAL_MEMBERS.has(field) ? "member" : "unknown";
  }

  const receivers = memberReceivers(raw, t, sym);
  if (receivers === null) return "undecidable";

  if (t.kind === "TypePrim" && PRIM_FIELDS[t.name]?.[field]) return "field";

  return receivers.some((r) => hasMember(r, field)) ? "member" : "unknown";
}

function memberReceivers(raw: TypeExpr | null, t: TypeExpr, sym: SymbolTable): Receiver[] | null {
  const name = t.kind === "TypePrim" || t.kind === "TypeApp" ? t.name : null;
  if (name === null || !isReceiver(name)) return null;
  return isStdlibDuration(raw, sym) ? [name, "Duration"] : [name];
}

function receiverName(raw: TypeExpr | null, t: TypeExpr, sym: SymbolTable): string {
  return isStdlibDuration(raw, sym) ? "Duration" : typeName(t, sym);
}

const STDLIB_DURATION = STDLIB_TYPES.find((d) => d.name === "Duration");

function isStdlibDuration(t: TypeExpr | null, sym: SymbolTable): boolean {
  const seen = new Set<string>();
  let cur = t;
  while (cur !== null) {
    if (cur.kind === "TypeRefinement" || cur.kind === "TypeNominal") {
      cur = cur.inner;
      continue;
    }
    if (cur.kind !== "TypeRef" || seen.has(cur.name)) return false;
    const def = sym.types.get(cur.name);
    if (def === undefined) return false;
    if (def === STDLIB_DURATION) return true;
    seen.add(cur.name);
    cur = def.body;
  }
  return false;
}

function undefMemberError(
  raw: TypeExpr | null,
  t: TypeExpr,
  field: string,
  pos: Pos,
  sym: SymbolTable,
): KumikiError {
  const head =
    t.kind === "TypeRecord"
      ? `Record type has no field or method ".${field}"`
      : `Type "${receiverName(raw, t, sym)}" has no member ".${field}"`;
  const owners = receiversOf(field);
  return {
    code: "E0108",
    kind: "undef-member",
    message: owners.length > 0 ? `${head} — it is a member of ${owners.join(" / ")}` : head,
    pos,
  };
}

const KEY_READERS: Readonly<Record<string, ReadonlySet<string>>> = {
  Set: new Set(["to-list"]),
  Map: new Set(["keys", "entries", "filter", "map"]),
};

const KEY_READER_NAMES: ReadonlySet<string> = new Set(
  Object.values(KEY_READERS).flatMap((names) => [...names]),
);

function keyKindOfReader(
  recv: TypeExpr | null,
  member: string,
  sym: SymbolTable,
): KeyKind | undefined {
  const t = unaliasType(recv, sym);
  if (t?.kind !== "TypeApp" || !KEY_READERS[t.name]?.has(member)) return undefined;
  const rep = keyRepresentation(t.args[0] ?? null, sym);
  return rep === "text" || rep === null ? undefined : rep;
}

function fragmentBindings(
  recv: TypeExpr | null,
  method: string,
  argIndex: number,
  sym: SymbolTable,
): [TypeExpr | null, TypeExpr | null] {
  const none: [null, null] = [null, null];
  const t = unaliasType(recv, sym);
  if (t?.kind !== "TypeApp") return none;
  const [a, b] = t.args;
  switch (t.name) {
    case "List": {
      if (!a) return none;
      if (method === "fold") return argIndex === 1 ? [null, a] : none;
      if (argIndex !== 0 || !ELEMENT_FRAGMENTS.has(method)) return none;
      return pairOrElement(a, sym);
    }
    case "Option":
      if (argIndex !== 0 || !a) return none;
      if (method === "flat-map") return [a, null];
      return method === "map" || method === "filter" ? pairOrElement(a, sym) : none;
    case "Result":
      if (argIndex !== 0) return none;
      if (method === "map") return a ? pairOrElement(a, sym) : none;
      return method === "map-err" ? [b ?? null, null] : none;
    case "Map":
      if (method === "update") return argIndex === 1 ? [b ?? null, null] : none;
      if ((method !== "filter" && method !== "map") || argIndex !== 0) return none;
      return [keyRepresentation(a ?? null, sym) === null ? null : (a ?? null), b ?? null];
    default:
      return none;
  }
}

const ELEMENT_FRAGMENTS: ReadonlySet<string> = new Set(
  [...FRAGMENT_ARGUMENTS].filter(([, f]) => f.second === "pair-value").map(([m]) => m),
);

function fragmentShape(
  recv: TypeExpr | null,
  method: string,
  sym: SymbolTable,
): FragmentShape | null {
  if (isOpaque(recv, sym)) return "undecided";
  const t = unaliasType(recv, sym);
  if (t?.kind !== "TypeApp" || !ELEMENT_FRAGMENTS.has(method)) return null;
  const [a] = t.args;
  switch (t.name) {
    case "List":
      return elementShape(a ?? null, sym).shape;
    case "Option":
      return method === "map" || method === "filter" ? elementShape(a ?? null, sym).shape : null;
    case "Result":
      return method === "map" ? elementShape(a ?? null, sym).shape : null;
    case "Map":
      return method === "filter" || method === "map" ? "key-value" : null;
    default:
      return null;
  }
}

function elementShape(
  elem: TypeExpr | null,
  sym: SymbolTable,
):
  | { shape: "pair"; halves: [TypeExpr | null, TypeExpr | null] }
  | { shape: "value" | "undecided" } {
  const u = unaliasType(elem, sym);
  if (u === null || u.kind === "TypeRef") return { shape: "undecided" };
  if (u.kind === "TypeApp" && u.name === "Tuple" && u.args.length === 2) {
    return { shape: "pair", halves: [u.args[0] ?? null, u.args[1] ?? null] };
  }
  return { shape: "value" };
}

/** `$1` / `$2` for a fragment handed `elem`, typed the way {@link elementShape} binds them. */
function pairOrElement(elem: TypeExpr, sym: SymbolTable): [TypeExpr | null, TypeExpr | null] {
  const el = elementShape(elem, sym);
  if (el.shape === "pair") return el.halves;
  return el.shape === "value" ? [elem, null] : [null, null];
}

function classifyFieldAccess(
  e: Expr & { kind: "FieldAccess" },
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  const raw = inferType(e.base, sym, ctx);
  const t = unaliasType(raw, sym);
  if (!t) return; // dynamic — keep name-based shortcut dispatch, no diagnostic

  switch (classifyMember(raw, e.field, sym)) {
    case "field":
      e.accessKind = "field";
      return;

    case "member": {
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
      const kind = keyKindOfReader(t, e.field, sym);
      if (kind) e.keyKind = kind;
      return;
    }

    case "unknown":
      errors.push(undefMemberError(raw, t, e.field, e.pos, sym));
      return;

    case "undecidable":
      // A union or an opaque type param → leave as shortcut, no diagnostic.
      return;
  }
}

function currentFnName(ctx: Ctx): string {
  return (ctx as Ctx & { fnName?: string }).fnName ?? "<fn>";
}

function checkFn(fn: FnDef, sym: SymbolTable, errors: KumikiError[]): void {
  const scope = fnScope(fn);
  const ctx: Ctx = {
    kind: "fn",
    localBinds: new Set(scope.map((b) => b.name)),
    localTypes: new Map(scope.map((b) => [b.name, b.type])),
    routeBind: "no-payload",
  };
  (ctx as Ctx & { fnName?: string }).fnName = fn.name;
  for (const p of fn.params) resolveType(p.type, sym, errors);
  if (fn.ret) resolveType(fn.ret, sym, errors);
  checkExpr(fn.body, sym, errors, ctx);
  checkAgainst(fn.body, fn.ret ?? null, sym, errors, ctx);
}

function checkEffect(eff: EffectDef, sym: SymbolTable, errors: KumikiError[]): void {
  resolveType(eff.inType, sym, errors);
  resolveType(eff.outType, sym, errors);
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
  checkTextFailure(eff, sym, errors);
  if (eff.mapRequest) checkExpr(eff.mapRequest, sym, errors, pureScope(["$1"]));
  // The key runs at dispatch time, so a name unchecked here fails on the first
  // dispatch rather than at check time.
  if (eff.policy?.kind === "PolLatestKey")
    checkExpr(eff.policy.key, sym, errors, pureScope(["$1"]));
}

function checkTextFailure(eff: EffectDef, sym: SymbolTable, errors: KumikiError[]): void {
  if (!failsWithText(eff.cap)) return;
  const out = unaliasType(eff.outType, sym);
  if (out?.kind !== "TypeApp" || out.name !== "Result" || out.args.length !== 2) return;
  const [ok, declared] = out.args;
  const e = declared ? unaliasType(declared, sym) : null;
  if (!ok || !declared || (e?.kind === "TypePrim" && e.name === "Text")) return;
  errors.push({
    code: "E0306",
    kind: "err-type-not-text",
    message: `effect "${eff.name}" with cap=${eff.cap} declares its error as ${typeToString(declared)}, but ${eff.cap} delivers a failure as its message, a Text — declare out=Result(${typeToString(ok)}, Text)`,
    pos: eff.pos,
  });
}

function pureScope(binds: string[]): Ctx {
  return {
    kind: "slot-init",
    localBinds: new Set(binds),
    routeBind: "no-payload",
    localTypes: new Map(),
  };
}

function wildcardText(e: Expr & { kind: "Wildcard" }): string {
  return e.wild === "any-id" ? "<any-id>" : `<slots.${e.slot}>`;
}

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

function checkPatternAgainstType(
  pat: Pattern,
  scrutType: TypeExpr | null,
  sym: SymbolTable,
  errors: KumikiError[],
  scope: Ctx,
): void {
  const t = unaliasType(scrutType, sym);
  const display = scrutType ?? t;

  if (pat.kind === "PWildcard") return;

  if (pat.kind === "PBind") {
    bindLocal(scope, pat.name, t === null ? null : scrutType);
    return;
  }

  if (pat.kind === "PTuple") {
    const tupleT = resolveToTuple(t, sym);
    if (tupleT === null) {
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

function checkTest(t: TestDef, sym: SymbolTable, errors: KumikiError[]): void {
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
    const mocks = isRecordValue(t.given) ? givenSection(t, "reducer-test", "mocks") : undefined;
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
  // The `expect` is a tile expression — validate its tile references.
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

function routeChainText(name: string, chain?: readonly string[]): string {
  return chain === undefined ? "" : ` through "${chain[0]}" (${[...chain, name].join(" → ")})`;
}

/** What every E0120 says, whether the read is written in the argument or sits behind a `fn` call. */
function routeInAppInitMessage(name: string, chain?: readonly string[]): string {
  return (
    `"${name}" is not available in an app.init argument${routeChainText(name, chain)}: these ` +
    `arguments are evaluated once, while the app object is being built, and the runtime ` +
    `installs the route during the mount that follows. Take the route from a route.enter ` +
    `reducer, which runs with the route the app landed on`
  );
}

function routeInSlotInitMessage(slot: string, name: string, chain?: readonly string[]): string {
  return (
    `Slot "${slot}" reads "${name}"${routeChainText(name, chain)} in its initial value; ` +
    `derived slots are prohibited, and this one cannot be computed at all: initial values ` +
    `are evaluated while the module loads, and the runtime installs the route during the ` +
    `mount that follows. Take the route from a route.enter reducer, which runs with the ` +
    `route the app landed on`
  );
}

function routeReadsIn(
  e: Expr,
  sym: SymbolTable,
  params: readonly FnScopeBind[] = [],
): { name: string; pos: Pos }[] {
  return preMountProbe(e, sym, params).routeReads;
}

function preMountProbe(
  e: Expr,
  sym: SymbolTable,
  params: readonly FnScopeBind[],
): { routeReads: { name: string; pos: Pos }[]; fragmentFnCalls: { name: string; pos: Pos }[] } {
  const routeReads: { name: string; pos: Pos }[] = [];
  const fragmentFnCalls: { name: string; pos: Pos }[] = [];
  const ctx: Ctx = {
    kind: "app-init",
    localBinds: new Set(params.map((p) => p.name)),
    localTypes: new Map(params.map((p) => [p.name, p.type])),
    routeBind: "no-payload",
    routeReadsSeen: routeReads,
    fragmentFnCallsSeen: fragmentFnCalls,
  };
  checkExpr(e, sym, [], ctx);
  return { routeReads, fragmentFnCalls };
}

function fnCallsIn(
  e: Expr,
  sym: SymbolTable,
  params: readonly FnScopeBind[] = [],
): { name: string; pos: Pos }[] {
  const out: { name: string; pos: Pos }[] = [];
  walkExpr(e, (n) => {
    if (n.kind === "Call" && sym.fns.has(n.callee)) out.push({ name: n.callee, pos: n.pos });
  });
  out.push(...preMountProbe(e, sym, params).fragmentFnCalls);
  return out.sort((a, b) => a.pos.line - b.pos.line || a.pos.col - b.pos.col);
}

type RouteChainResolver = (start: string) => { chain: string[]; name: string } | null;

function routeReachedThroughCalls(
  e: Expr,
  sym: SymbolTable,
  routeChain: RouteChainResolver,
): { pos: Pos; chain: string[]; name: string }[] {
  const out: { pos: Pos; chain: string[]; name: string }[] = [];
  for (const call of fnCallsIn(e, sym)) {
    const reached = routeChain(call.name);
    if (reached !== null) out.push({ pos: call.pos, ...reached });
  }
  return out;
}

function routeChainResolver(sym: SymbolTable): RouteChainResolver {
  const direct = new Map<string, string | null>();
  const readsRoute = (name: string): string | null => {
    const cached = direct.get(name);
    if (cached !== undefined) return cached;
    const fn = sym.fns.get(name);
    const answer = fn ? (routeReadsIn(fn.body, sym, fnScope(fn))[0]?.name ?? null) : null;
    direct.set(name, answer);
    return answer;
  };
  const calls = new Map<string, readonly { name: string }[]>();
  const callsOf = (fn: FnDef): readonly { name: string }[] => {
    const cached = calls.get(fn.name);
    if (cached !== undefined) return cached;
    const answer = fnCallsIn(fn.body, sym, fnScope(fn));
    calls.set(fn.name, answer);
    return answer;
  };

  return (start: string) => {
    const parent = new Map<string, string | null>([[start, null]]);
    const queue: string[] = [start];
    for (let i = 0; i < queue.length; i++) {
      const name = queue[i];
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
      for (const callee of callsOf(fn)) {
        if (parent.has(callee.name)) continue;
        parent.set(callee.name, name);
        queue.push(callee.name);
      }
    }
    return null;
  };
}

export function servesNotFound(routes: AppDef["routes"]): boolean {
  return routes.some((r) => r.path === "/404" && !r.tile.startsWith(">>"));
}

function checkApp(
  app: AppDef,
  sym: SymbolTable,
  errors: KumikiError[],
  registeredCaps: Set<string>,
  routeChain: RouteChainResolver,
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
  }
  if (!servesNotFound(app.routes)) {
    errors.push({
      code: "E0001",
      kind: "missing-404",
      message: `app.routes must include a "/404" entry`,
      pos: app.pos,
    });
  }
  const initCtx: Ctx = {
    kind: "app-init",
    localBinds: new Set(),
    localTypes: new Map(),
    capsAvailable: new Set(app.caps),
    routeBind: "unbound",
  };
  for (const e of app.init) {
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
      for (const hop of routeReachedThroughCalls(a, sym, routeChain)) {
        errors.push({
          code: "E0120",
          kind: "route-in-app-init",
          message: routeInAppInitMessage(hop.name, hop.chain),
          pos: hop.pos,
        });
      }
    }
  }
  checkAppHttp(app, sym, errors);
  checkAppTheme(app, sym, errors);
}

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
  const fieldCtx = pureScope([]);
  for (const e of [http.baseUrl, http.headers, http.timeout, http.credentials]) {
    if (e !== undefined) checkExpr(e, sym, errors, fieldCtx);
  }
  // In the order of the walk above and of the field table in §6.3.1.
  if (http.baseUrl !== undefined)
    checkAgainst(http.baseUrl, prim("Text", http.baseUrl.pos), sym, errors, fieldCtx);
  if (http.headers !== undefined) {
    const pos = http.headers.pos;
    const text = prim("Text", pos);
    checkAgainst(http.headers, container("Map", [text, text], pos), sym, errors, fieldCtx);
  }
  if (http.timeout !== undefined)
    checkAgainst(http.timeout, prim("Int", http.timeout.pos), sym, errors, fieldCtx);
  if (http.credentials !== undefined) checkHttpCredentials(http.credentials, sym, errors, fieldCtx);
}

/** The `RequestCredentials` modes of the Fetch standard (http.md §6.3.1). */
const HTTP_CREDENTIALS = ["omit", "same-origin", "include"];

function checkHttpCredentials(e: Expr, sym: SymbolTable, errors: KumikiError[], ctx: Ctx): void {
  if (e.kind === "IfExpr") {
    checkHttpCredentials(e.consequent, sym, errors, ctx);
    checkHttpCredentials(e.alternate, sym, errors, ctx);
    return;
  }
  if (e.kind === "Str") {
    if (HTTP_CREDENTIALS.includes(e.value)) return;
    pushMismatch(
      errors,
      "E0201",
      `credentials "${e.value}" is not one of ${HTTP_CREDENTIALS.join(" / ")}; a browser refuses the request`,
      e.pos,
    );
    return;
  }
  checkAgainst(e, prim("Text", e.pos), sym, errors, ctx);
}

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
          checkApplication(t, sym, typeParams, errors);
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
    case "TypeRefinement":
      checkRefinement(t.refinement, t.inner, sym, typeParams, errors);
      resolveType(t.inner, sym, errors, typeParams);
      return;
  }
}

function checkNestedLowering(slot: SlotDef, sym: SymbolTable, errors: KumikiError[]): void {
  const { cut } = scanPositions(slot.type, sym);
  if (cut === undefined) return;
  errors.push({
    code: "E0803",
    kind: "unimplemented-refinement",
    message: `Refinement inside slot "${slot.name}" is not enforced by the runtime: "${cut}" applies itself to a growing argument more than ${GENERIC_SELF_NESTING_LIMIT} levels deep`,
    pos: slot.pos,
  });
}

function checkRefinement(
  r: Refinement | undefined,
  inner: TypeExpr,
  sym: SymbolTable,
  typeParams: ReadonlySet<string>,
  errors: KumikiError[],
): void {
  if (!r) return;
  const problem = refinementProblem(r) ?? baseProblem(r, inner, sym, typeParams);
  if (!problem) return;
  if (problem.kind === "unimplemented-refinement") {
    errors.push({
      code: "E0803",
      kind: "unimplemented-refinement",
      message: problem.message,
      pos: r.pos,
    });
    return;
  }
  errors.push({
    code: "E0804",
    kind: "refinement-args-invalid",
    message: problem.message,
    pos: r.pos,
  });
}

/** {@link refinementBaseProblem} for `r` over `inner`, as a checker problem. */
function baseProblem(
  r: Refinement,
  inner: TypeExpr,
  sym: SymbolTable,
  typeParams: ReadonlySet<string>,
): RefinementProblem | undefined {
  const base = judgedBase(substituteType(inner, opaqueParams(typeParams, inner.pos)), sym);
  const message = base ? refinementBaseProblem(r, base) : undefined;
  return message ? { kind: "refinement-args-invalid", message } : undefined;
}

/** Each of `params` mapped to the opaque type, so that nothing is concluded from it. */
function opaqueParams(params: Iterable<string>, pos: Pos): Map<string, TypeExpr> {
  return new Map([...params].map((p) => [p, unknownType(pos)]));
}

function judgedBase(t: TypeExpr, sym: SymbolTable): TypeExpr | undefined {
  const base = unaliasType(t, sym);
  if (base === null) return undefined;
  if (base.kind === "TypeApp" && !isKnownTypeName(base.name, sym)) return undefined;
  return base;
}

function checkApplication(
  app: TypeExpr & { kind: "TypeApp" },
  sym: SymbolTable,
  typeParams: ReadonlySet<string>,
  errors: KumikiError[],
): void {
  const def = sym.types.get(app.name);
  if (!def) return;
  const opaque = opaqueParams(typeParams, app.pos);
  const args = app.args.map((a) => substituteType(a, opaque));
  const unapplied = def.params.map(() => unknownType(app.pos));
  const run: AppliedRun = {
    shown: typeToString(app),
    sym,
    reported: new Map(),
    out: [],
  };
  appliedBaseProblems(app.name, args, unapplied, run, { entered: null, from: null, walked: null });
  for (const message of run.out) {
    errors.push({ code: "E0804", kind: "refinement-args-invalid", message, pos: app.pos });
  }
}

type AppliedRun = {
  readonly shown: string;
  readonly sym: SymbolTable;
  readonly reported: Map<Refinement, Set<string>>;
  readonly out: string[];
};

type AppliedScope = {
  readonly entered: string | null;
  readonly from: AppliedScope | null;
  walked: WalkedApplication[] | null;
};

/** Whether `name` was entered on the way to `scope`. */
function hasEntered(scope: AppliedScope, name: string): boolean {
  for (let s: AppliedScope | null = scope; s; s = s.from) if (s.entered === name) return true;
  return false;
}

type WalkedApplication = {
  readonly name: string;
  readonly args: readonly TypeExpr[];
  readonly judged: readonly TypeExpr[];
};

function sameNodes(a: readonly TypeExpr[], b: readonly TypeExpr[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** Whether `name` has been walked from `scope` with these very argument nodes. */
function walkedFrom(
  scope: AppliedScope,
  name: string,
  args: readonly TypeExpr[],
  judged: readonly TypeExpr[],
): boolean {
  if (!scope.walked) return false;
  for (const w of scope.walked) {
    if (w.name === name && sameNodes(w.args, args) && sameNodes(w.judged, judged)) return true;
  }
  return false;
}

/** Record `message` for `r`, unless `r` has already given it. */
function reportApplied(run: AppliedRun, r: Refinement, message: string): void {
  let given = run.reported.get(r);
  if (!given) {
    given = new Set();
    run.reported.set(r, given);
  }
  if (given.has(message)) return;
  given.add(message);
  run.out.push(message);
}

function appliedBaseProblems(
  name: string,
  writtenArgs: readonly TypeExpr[],
  writtenJudged: readonly TypeExpr[],
  run: AppliedRun,
  scope: AppliedScope,
): void {
  const { sym } = run;
  const def = sym.types.get(name);
  if (!def || hasEntered(scope, name) || def.params.length !== writtenArgs.length) return;
  const args = writtenArgs.map((a) => forwardedHead(a, sym));
  const judged = writtenJudged.map((a) => forwardedHead(a, sym));
  if (walkedFrom(scope, name, args, judged)) return;
  scope.walked ??= [];
  scope.walked.push({ name, args, judged });
  const applied = paramSubstitution(def.params, args);
  const before = paramSubstitution(def.params, judged);
  const inside: AppliedScope = { entered: name, from: scope, walked: null };
  const walk = (t: TypeExpr): void => {
    switch (t.kind) {
      case "TypePrim":
      case "TypeRef":
        return;
      case "TypeApp": {
        const nested = t.args.map((a) => substituteType(a, applied));
        const nestedBefore = t.args.map((a) => substituteType(a, before));
        appliedBaseProblems(t.name, nested, nestedBefore, run, inside);
        for (const a of t.args) walk(a);
        return;
      }
      case "TypeRecord":
        for (const f of t.fields) walk(f.type);
        return;
      case "TypeUnion":
        for (const v of t.variants) for (const p of v.payloads) walk(p);
        return;
      case "TypeNominal":
      case "TypeRefinement": {
        const r = t.refinement;
        // A problem with the arguments is the definition's, reported there.
        if (r && !refinementProblem(r)) {
          const was = judgedBase(substituteType(t.inner, before), sym);
          const now = judgedBase(substituteType(t.inner, applied), sym);
          if (now && !(was && refinementBaseProblem(r, was))) {
            const over = `${run.shown} applies it over ${typeToString(now)}`;
            const message = refinementBaseProblem(r, now, over);
            if (message) reportApplied(run, r, message);
          }
        }
        walk(t.inner);
        return;
      }
      default:
        assertNever(t);
    }
  };
  walk(def.body);
}

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
