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
import { BUILTIN_TILES } from "./builtins.ts";
import { STANDARD_CAPABILITIES } from "./capabilities.ts";
import { KNOWN_MEMBERS, KNOWN_METHODS } from "./codegen.ts";
import { UI_EVENT_TILE_KINDS } from "./ui-lifts.ts";

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

const A11Y_CODES = new Set(["E0701", "E0702", "E0703"]);

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
 */
export function check(
  program: Program,
  opts?: {
    strictA11y?: boolean;
    strictIcons?: boolean;
    strictSelectorId?: boolean;
    iconNames?: Iterable<string>;
    capabilities?: string[];
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
  /** Names declared by `motion N = {…}` — the `motion` prop namespace. */
  motions: Set<string>;
  /**
   * Closed icon-name domain for `--strict-icons`: union of the
   * `@kumikijs/icons` registry passed by the toolchain and every key seen
   * in any `theme.icons` block in the program. Always populated; `E0704`
   * emission is gated by the strictIcons opt-in in `check()`.
   */
  iconDomain: Set<string>;
  app?: AppDef;
};

function checkAll(
  program: Program,
  registeredCaps: Set<string>,
  iconDomain: Set<string>,
): KumikiError[] {
  const errors: KumikiError[] = [];
  const sym: SymbolTable = {
    types: new Map(),
    slots: new Map(),
    reducers: new Map(),
    tiles: new Map(),
    fns: new Map(),
    effects: new Map(),
    timerNames: new Set(),
    motions: new Set(),
    iconDomain,
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
      case "AppDef":
        sym.app = def;
        break;
    }
  }

  for (const def of program.defs) {
    if (def.kind === "SlotDef") checkSlot(def, sym, errors);
    if (def.kind === "TileDef") checkTile(def, sym, errors);
    if (def.kind === "ReducerDef") checkReducer(def, sym, errors);
    if (def.kind === "FnDef") checkFn(def, sym, errors);
    if (def.kind === "EffectDef") checkEffect(def, sym, errors);
    if (def.kind === "AppDef") checkApp(def, sym, errors, registeredCaps);
    if (def.kind === "MotionDef") checkMotion(def, errors);
    if (def.kind === "TestDef") checkTest(def, sym, errors);
  }

  return errors;
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

function checkSlot(slot: SlotDef, sym: SymbolTable, errors: KumikiError[]): void {
  resolveType(slot.type, sym, errors);
  checkExpr(slot.init, sym, errors, { kind: "slot-init", localBinds: new Set() });
}

function checkTile(tile: TileDef, sym: SymbolTable, errors: KumikiError[]): void {
  const ctx: Ctx = { kind: "tile", localBinds: new Set(), localTypes: new Map() };
  if (tile.in) {
    ctx.localBinds.add("$1");
    ctx.localTypes?.set("$1", tile.in);
  }
  checkTileExpr(tile.body, sym, errors, ctx);
  if (tile.subRoutes) checkSubRoutes(tile, sym, errors);
}

function checkSubRoutes(tile: TileDef, sym: SymbolTable, errors: KumikiError[]): void {
  const subRoutes = tile.subRoutes;
  if (!subRoutes) return;
  // Each sub-route's target tile must exist (redirects skip).
  for (const sr of subRoutes) {
    if (sr.tile.startsWith(">>")) continue;
    if (!sym.tiles.has(sr.tile)) {
      errors.push({
        code: "E0105",
        kind: "undef-tile",
        message: `Sub-route "${sr.path}" in tile "${tile.name}" targets undefined tile "${sr.tile}"`,
        pos: tile.pos,
      });
    }
  }
  // Duplicate sub-route paths within the same tile.
  const seen = new Set<string>();
  for (const sr of subRoutes) {
    if (seen.has(sr.path)) {
      errors.push({
        code: "E0112",
        kind: "duplicate-sub-route",
        message: `Sub-route path "${sr.path}" is declared more than once in tile "${tile.name}"`,
        pos: tile.pos,
      });
    }
    seen.add(sr.path);
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
        code: "E0110",
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
  kind: "slot-init" | "tile" | "reducer" | "fn";
  localBinds: Set<string>;
  capsAvailable?: Set<string>; // for reducer context
  /**
   * Inferred types of in-scope local binds (ADR-002): fn params, tile `in`
   * (`$1`), and `let` bindings. Used by FieldAccess inference to dispatch
   * field-vs-shortcut and to flag E0108. Cloned alongside `localBinds` when a
   * narrower scope is entered. Absent for binds we don't type (reducer payloads,
   * `match` binds) — those infer as dynamic.
   */
  localTypes?: Map<string, TypeExpr>;
};

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

function checkA11y(t: TileExpr & { kind: "TileCall" }, errors: KumikiError[]): void {
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
      const inner: Ctx = {
        ...ctx,
        localBinds: new Set(ctx.localBinds),
        localTypes: new Map(ctx.localTypes ?? []),
      };
      inner.localBinds.add(t.bind);
      checkTileExpr(t.body, sym, errors, inner);
      return;
    }
    case "TileWhen":
      checkExpr(t.cond, sym, errors, ctx);
      checkTileExpr(t.body, sym, errors, ctx);
      return;
    case "TileIf":
      checkExpr(t.cond, sym, errors, ctx);
      checkTileExpr(t.consequent, sym, errors, ctx);
      checkTileExpr(t.alternate, sym, errors, ctx);
      return;
    case "TileMatch": {
      checkExpr(t.scrutinee, sym, errors, ctx);
      const scrutType = inferType(t.scrutinee, sym, ctx);
      for (const arm of t.arms) {
        const inner: Ctx = {
          ...ctx,
          localBinds: new Set(ctx.localBinds),
          localTypes: new Map(ctx.localTypes ?? []),
        };
        checkPatternAgainstType(
          arm.pattern,
          scrutType,
          sym,
          errors,
          inner.localBinds,
          inner.localTypes,
        );
        checkTileExpr(arm.body, sym, errors, inner);
      }
      return;
    }
    case "TileCall":
      checkTileCall(t, sym, errors, ctx);
      return;
  }
}

function checkTileCall(
  t: TileExpr & { kind: "TileCall" },
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  if (!BUILTIN_TILES.has(t.name) && !sym.tiles.has(t.name)) {
    errors.push({
      code: "E0105",
      kind: "undef-tile",
      message: `Reference to undefined tile "${t.name}"`,
      pos: t.pos,
    });
  }
  checkA11y(t, errors);
  checkIconName(t, sym, errors);
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
  const HANDLER_NAMES = new Set([
    "onClick",
    "onSubmit",
    "onChange",
    "onInput",
    "onFocus",
    "onBlur",
    "onClose",
  ]);
  for (const arg of t.args) {
    const v = arg.value;
    if (
      (v as TileExpr).kind === "TileCall" ||
      (v as TileExpr).kind === "TileFor" ||
      (v as TileExpr).kind === "TileWhen" ||
      (v as TileExpr).kind === "TileIf" ||
      (v as TileExpr).kind === "TileMatch"
    ) {
      checkTileExpr(v as TileExpr, sym, errors, ctx);
      continue;
    }
    // Named arg whose name is an event-handler binds a reducer rather than a slot ref.
    if (arg.name && HANDLER_NAMES.has(arg.name)) {
      const expr = v as Expr;
      if (expr.kind !== "Ref") {
        errors.push({
          code: "E0201",
          kind: "type-mismatch",
          message: `Event handler arg "${arg.name}" must be a reducer name`,
          pos: expr.pos,
        });
      } else if (!sym.reducers.has(expr.name)) {
        errors.push({
          code: "E0102",
          kind: "undef-reducer",
          message: `Reference to undefined reducer "${expr.name}"`,
          pos: expr.pos,
        });
      }
      continue;
    }
    checkExpr(v as Expr, sym, errors, ctx);
  }
  for (const prop of t.props) {
    if (HANDLER_NAMES.has(prop.name)) {
      const ref = prop.value;
      if (ref.kind !== "Ref") {
        errors.push({
          code: "E0201",
          kind: "type-mismatch",
          message: `Event handler prop "${prop.name}" must be a reducer name`,
          pos: prop.value.pos,
        });
      } else if (!sym.reducers.has(ref.name)) {
        errors.push({
          code: "E0102",
          kind: "undef-reducer",
          message: `Reference to undefined reducer "${ref.name}"`,
          pos: ref.pos,
        });
      }
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
  if (visited.has(tileName)) return new Set();
  visited.add(tileName);
  if (BUILTIN_TILES.has(tileName)) return new Set([tileName]);
  const def = sym.tiles.get(tileName);
  if (!def) return new Set();
  return walkTileExprForBuiltinKinds(def.body, sym, visited);
}

function walkTileExprForBuiltinKinds(
  expr: TileExpr,
  sym: SymbolTable,
  visited: Set<string>,
): Set<string> {
  if (expr.kind === "TileFor" || expr.kind === "TileWhen") {
    return walkTileExprForBuiltinKinds(expr.body, sym, visited);
  }
  if (expr.kind === "TileIf") {
    const a = walkTileExprForBuiltinKinds(expr.consequent, sym, visited);
    const b = walkTileExprForBuiltinKinds(expr.alternate, sym, visited);
    return new Set([...a, ...b]);
  }
  if (expr.kind === "TileMatch") {
    const out = new Set<string>();
    for (const arm of expr.arms) {
      for (const k of walkTileExprForBuiltinKinds(arm.body, sym, visited)) out.add(k);
    }
    return out;
  }
  // TileCall: include the call itself, then recurse into positional TileExpr-
  // typed args (children) and into `Ref` args that name another tile.
  const out = new Set<string>();
  if (BUILTIN_TILES.has(expr.name)) {
    out.add(expr.name);
  } else {
    for (const k of collectTileBuiltinKinds(expr.name, sym, visited)) out.add(k);
  }
  for (const a of expr.args) {
    if (a.name) continue; // skip named args — they're props, not children
    const v = a.value as { kind?: string };
    if (!v || typeof v !== "object" || !("kind" in v)) continue;
    if (
      v.kind === "TileCall" ||
      v.kind === "TileFor" ||
      v.kind === "TileWhen" ||
      v.kind === "TileIf" ||
      v.kind === "TileMatch"
    ) {
      for (const k of walkTileExprForBuiltinKinds(v as TileExpr, sym, visited)) out.add(k);
    } else if (v.kind === "Ref") {
      const refName = (v as Expr & { name: string }).name;
      if (sym.tiles.has(refName) || BUILTIN_TILES.has(refName)) {
        for (const k of collectTileBuiltinKinds(refName, sym, visited)) out.add(k);
      }
    }
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
type TileIdCollection = { known: true; ids: Set<string> } | { known: false };

const ID_COLL_UNKNOWN: TileIdCollection = { known: false };

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
 * site isn't foreclosed at compile time. Cycle-safe via `visited`.
 */
function collectTileDeclaredIds(tileName: string, sym: SymbolTable): TileIdCollection {
  const def = sym.tiles.get(tileName);
  if (!def) return ID_COLL_UNKNOWN;
  return walkTileExprForDeclaredIds(def.body);
}

function walkTileExprForDeclaredIds(expr: TileExpr): TileIdCollection {
  if (expr.kind === "TileFor" || expr.kind === "TileWhen") {
    return walkTileExprForDeclaredIds(expr.body);
  }
  if (expr.kind === "TileIf") {
    return mergeIdCollections(
      walkTileExprForDeclaredIds(expr.consequent),
      walkTileExprForDeclaredIds(expr.alternate),
    );
  }
  if (expr.kind === "TileMatch") {
    let acc: TileIdCollection = { known: true, ids: new Set() };
    for (const arm of expr.arms) {
      acc = mergeIdCollections(acc, walkTileExprForDeclaredIds(arm.body));
    }
    return acc;
  }
  // TileCall — the `{id}` prop lives on the outermost call.
  const idProp = expr.props.find((p) => p.name === "id");
  if (!idProp) return ID_COLL_UNKNOWN;
  if (idProp.value.kind !== "Str") return ID_COLL_UNKNOWN;
  return { known: true, ids: new Set([idProp.value.value]) };
}

function checkReducer(r: ReducerDef, sym: SymbolTable, errors: KumikiError[]): void {
  const ctx: Ctx = {
    kind: "reducer",
    localBinds: new Set(),
    capsAvailable: new Set(sym.app?.caps ?? []),
  };
  // event binds
  if (r.on.kind === "EffectEvent") {
    for (const b of r.on.binds) if (b !== "_") ctx.localBinds.add(b);
  }
  if (r.on.kind === "LifecycleEvent") {
    if (r.on.name.startsWith("route.")) ctx.localBinds.add("$route");
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
  if (
    r.on.kind === "UiEvent" &&
    r.on.selector.tile !== "_" &&
    r.on.selector.id !== undefined &&
    sym.tiles.has(r.on.selector.tile)
  ) {
    const decl = collectTileDeclaredIds(r.on.selector.tile, sym);
    if (decl.known && !decl.ids.has(r.on.selector.id)) {
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
  ctx.localBinds.add("$el");
  ctx.localBinds.add("$event");
  ctx.localBinds.add("$route");

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
    const inner: Ctx = {
      ...ctx,
      localBinds: new Set(ctx.localBinds),
      localTypes: new Map(ctx.localTypes ?? []),
    };
    inner.localBinds.add(s.bind);
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
      const inner: Ctx = {
        ...ctx,
        localBinds: new Set(ctx.localBinds),
        localTypes: new Map(ctx.localTypes ?? []),
      };
      checkPatternAgainstType(
        arm.pattern,
        scrutType,
        sym,
        errors,
        inner.localBinds,
        inner.localTypes,
      );
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
    ctx.localBinds.add(s.name);
    const rt = inferType(s.rhs, sym, ctx);
    if (rt) {
      if (!ctx.localTypes) ctx.localTypes = new Map();
      ctx.localTypes.set(s.name, rt);
    }
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
  checkLvalue(lv.base, sym, errors, ctx);
}

function checkExpr(e: Expr, sym: SymbolTable, errors: KumikiError[], ctx: Ctx): void {
  switch (e.kind) {
    case "Num":
    case "Str":
    case "Bool":
    case "Unit":
      return;
    case "Ref":
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
        message: `Reference to undefined name "${e.name}"`,
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
      if (e.op !== "==" && e.op !== "!=") {
        const lt = inferType(e.lhs, sym, ctx);
        const rt = inferType(e.rhs, sym, ctx);
        if (isEffectId(lt) || isEffectId(rt)) {
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
      return;
    }
    case "UnaryOp":
      checkExpr(e.rhs, sym, errors, ctx);
      return;
    case "FieldAccess":
      checkExpr(e.base, sym, errors, ctx);
      classifyFieldAccess(e, sym, errors, ctx);
      return;
    case "Index":
      checkExpr(e.base, sym, errors, ctx);
      checkExpr(e.index, sym, errors, ctx);
      return;
    case "Call":
      for (const a of e.args) checkExpr(a, sym, errors, ctx);
      return;
    case "MethodCall":
      if (!KNOWN_METHODS.has(e.method)) {
        errors.push({
          code: "E0801",
          kind: "unimplemented-method",
          message: `Method ".${e.method}" is not implemented by the runtime`,
          pos: e.pos,
        });
      }
      checkExpr(e.receiver, sym, errors, ctx);
      for (const a of e.args) {
        // Inside method call args, $1/$2 are implicit lambdas
        const inner: Ctx = {
          ...ctx,
          localBinds: new Set(ctx.localBinds),
          localTypes: new Map(ctx.localTypes ?? []),
        };
        inner.localBinds.add("$1");
        inner.localBinds.add("$2");
        checkExpr(a, sym, errors, inner);
      }
      return;
    case "Wildcard":
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
        const inner: Ctx = {
          ...ctx,
          localBinds: new Set(ctx.localBinds),
          localTypes: new Map(ctx.localTypes ?? []),
        };
        checkPatternAgainstType(
          arm.pattern,
          scrutType,
          sym,
          errors,
          inner.localBinds,
          inner.localTypes,
        );
        checkExpr(arm.body, sym, errors, inner);
      }
      return;
    }
    case "IfExpr":
      checkExpr(e.cond, sym, errors, ctx);
      checkExpr(e.consequent, sym, errors, ctx);
      checkExpr(e.alternate, sym, errors, ctx);
      return;
    case "LetIn": {
      checkExpr(e.value, sym, errors, ctx);
      const inner: Ctx = {
        ...ctx,
        localBinds: new Set(ctx.localBinds),
        localTypes: new Map(ctx.localTypes ?? []),
      };
      inner.localBinds.add(e.name);
      const vt = inferType(e.value, sym, inner);
      if (vt) inner.localTypes?.set(e.name, vt);
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
  const isBuiltinNav =
    effect === "navigate" ||
    effect === "navigate-replace" ||
    effect === "navigate-back" ||
    effect === "scroll-to" ||
    effect === "toast" ||
    effect === "confirm" ||
    effect === "log";
  if (!eff && !isBuiltinNav) {
    errors.push({
      code: "E0104",
      kind: "undef-effect",
      message: `Reference to undefined effect "${effect}"`,
      pos,
    });
    return;
  }
  if (eff && ctx.capsAvailable && !ctx.capsAvailable.has(eff.cap)) {
    errors.push({
      code: "E0301",
      kind: "missing-capability",
      message: `Effect "${effect}" requires capability "${eff.cap}" which is not declared in app.caps`,
      pos,
    });
  }
  if (eff && args.length > 0) {
    const declared = eff.inType;
    const actual = inferType(args[0] as Expr, sym, ctx);
    if (
      declared.kind === "TypePrim" &&
      declared.name === "EffectId" &&
      actual &&
      !(actual.kind === "TypePrim" && actual.name === "EffectId")
    ) {
      errors.push({
        code: "E0202",
        kind: "emit-arg-type-mismatch",
        message: `emit "${effect}" expects an EffectId argument`,
        pos,
      });
    }
  }
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

/** Unwrap type aliases (`TypeRef` → its `TypeDef` body) and nominal/refinement wrappers. */
function unaliasType(
  t: TypeExpr | null,
  sym: SymbolTable,
  seen: Set<string> = new Set(),
): TypeExpr | null {
  if (!t) return null;
  if (t.kind === "TypeRef") {
    if (seen.has(t.name)) return null;
    const def = sym.types.get(t.name);
    if (!def) return t; // unknown name / type param — opaque, treated as "other"
    seen.add(t.name);
    return unaliasType(def.body, sym, seen);
  }
  if (t.kind === "TypeNominal" || t.kind === "TypeRefinement")
    return unaliasType(t.inner, sym, seen);
  return t;
}

function recordFieldType(rec: TypeExpr & { kind: "TypeRecord" }, name: string): TypeExpr | null {
  return rec.fields.find((f) => f.name === name)?.type ?? null;
}

const unitType = (pos: Pos): TypeExpr => ({ kind: "TypePrim", name: "Unit", pos });

/** Best-effort static type of an expression; `null` = undecidable / dynamic. */
function inferType(e: Expr, sym: SymbolTable, ctx: Ctx): TypeExpr | null {
  switch (e.kind) {
    case "Num":
      return { kind: "TypePrim", name: "Int", pos: e.pos }; // Int/Float not split here
    case "Str":
      return { kind: "TypePrim", name: "Text", pos: e.pos };
    case "Bool":
      return { kind: "TypePrim", name: "Bool", pos: e.pos };
    case "Ref": {
      const bound = ctx.localTypes?.get(e.name);
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
      if (
        e.field === "get" &&
        base.kind === "TypeApp" &&
        (base.name === "Option" || base.name === "Result")
      )
        return base.args[0] ?? null;
      return null;
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
            return recv.args[1]
              ? { kind: "TypeApp", name: "Option", args: [recv.args[1]], pos: e.pos }
              : null;
          if (recv.name === "Option" || recv.name === "Result") return recv.args[0] ?? null;
        }
      }
      return null;
    }
    case "RecordLit":
      return {
        kind: "TypeRecord",
        fields: e.fields.map((f) => ({
          name: f.name,
          type: inferType(f.value, sym, ctx) ?? unitType(f.value.pos),
        })),
        pos: e.pos,
      };
    case "Variant": {
      const inner = e.payload[0]
        ? (inferType(e.payload[0], sym, ctx) ?? unitType(e.pos))
        : unitType(e.pos);
      if (e.name === "Some" || e.name === "None")
        return { kind: "TypeApp", name: "Option", args: [inner], pos: e.pos };
      if (e.name === "Ok") return { kind: "TypeApp", name: "Result", args: [inner], pos: e.pos };
      // Err carries E, not T — can't infer the success type, so stay dynamic.
      return null;
    }
    case "EmitExpr":
      // spec http.md §6.4 / stdlib §2.1.1.1: `emit X(...)` as an expression
      // yields the dispatched effect's EffectId.
      return { kind: "TypePrim", name: "EffectId", pos: e.pos };
    case "Call":
      // `EffectId.none` is the empty-handle sentinel for slot init / cancel
      // no-op. Treated as a builtin call so it sits beside `Duration.ms` /
      // `Decoder.Json` (same shape — uppercase qualifier + dot + member).
      if (e.callee === "EffectId.none") {
        return { kind: "TypePrim", name: "EffectId", pos: e.pos };
      }
      return null;
    default:
      return null;
  }
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
  };
  (ctx as Ctx & { fnName?: string }).fnName = fn.name;
  for (const p of fn.params) ctx.localBinds.add(p.name);
  // also bind $1, $2 used in expression-fragment style
  ctx.localBinds.add("$1");
  ctx.localBinds.add("$2");
  checkExpr(fn.body, sym, errors, ctx);
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
    });
}

function wildcardText(e: Expr & { kind: "Wildcard" }): string {
  return e.wild === "any-id" ? "<any-id>" : `<slots.${e.slot}>`;
}

/**
 * Validate that `pat` is structurally compatible with `scrutType`, push
 * diagnostics for any mismatch, and register every bind name into `binds` /
 * (when its type is known) `localTypes` so the arm body resolves names and
 * sees the right inner type.
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
  binds: Set<string>,
  localTypes: Map<string, TypeExpr> | undefined,
): void {
  const t = unaliasType(scrutType, sym);
  // Diagnostics prefer the user-written name (`Light`) over its expanded body
  // (`Red | Green`). Fall back to the unaliased shape when no original was
  // passed (e.g. when recursing into an inferred element type).
  const display = scrutType ?? t;

  if (pat.kind === "PWildcard") return;

  if (pat.kind === "PBind") {
    binds.add(pat.name);
    if (t && localTypes) localTypes.set(pat.name, t);
    return;
  }

  if (pat.kind === "PTuple") {
    const tupleT = resolveToTuple(t, sym);
    if (tupleT === null) {
      // Undecidable scrutinee — still walk the items so nested binds land in
      // scope; just skip the per-element type check.
      for (const it of pat.items) {
        checkPatternAgainstType(it, null, sym, errors, binds, localTypes);
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
        checkPatternAgainstType(it, null, sym, errors, binds, localTypes);
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
      checkPatternAgainstType(item, elemType, sym, errors, binds, localTypes);
    }
    return;
  }

  // PVariant
  if (!t) {
    // Undecidable scrutinee — register binds without types and stop.
    for (const b of pat.binds) if (b !== "_") binds.add(b);
    return;
  }
  const payloads = lookupVariantPayloads(pat.name, t, sym);
  if (payloads === null) {
    for (const b of pat.binds) if (b !== "_") binds.add(b);
    return;
  }
  if (payloads === "unknown-tag") {
    errors.push({
      code: "E0209",
      kind: "pat-unknown-variant",
      message: `Variant "${pat.name}" is not a member of scrutinee type "${typeToString(display as TypeExpr)}"`,
      pos: pat.pos,
    });
    for (const b of pat.binds) if (b !== "_") binds.add(b);
    return;
  }
  if (payloads === "not-a-union") {
    errors.push({
      code: "E0208",
      kind: "pat-type-mismatch",
      message: `Variant pattern "${pat.name}" cannot match scrutinee of type "${typeToString(display as TypeExpr)}"`,
      pos: pat.pos,
    });
    for (const b of pat.binds) if (b !== "_") binds.add(b);
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
    binds.add(name);
    const ty = payloads[i] ?? null;
    if (ty && localTypes) localTypes.set(name, ty);
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

function paramSubstitution(params: string[], args: TypeExpr[]): Map<string, TypeExpr> {
  const m = new Map<string, TypeExpr>();
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    const a = args[i];
    if (p && a) m.set(p, a);
  }
  return m;
}

/** Substitute type-param names (carried as `TypeRef`) inside `t` using `sub`. */
function substituteType(t: TypeExpr, sub: Map<string, TypeExpr>): TypeExpr {
  if (sub.size === 0) return t;
  switch (t.kind) {
    case "TypePrim":
      return t;
    case "TypeRef": {
      const r = sub.get(t.name);
      return r ?? t;
    }
    case "TypeApp":
      return { ...t, args: t.args.map((a) => substituteType(a, sub)) };
    case "TypeRecord":
      return {
        ...t,
        fields: t.fields.map((f) => ({ name: f.name, type: substituteType(f.type, sub) })),
      };
    case "TypeUnion":
      return {
        ...t,
        variants: t.variants.map((v) => ({
          name: v.name,
          payloads: v.payloads.map((p) => substituteType(p, sub)),
        })),
      };
    case "TypeNominal":
      return { ...t, inner: substituteType(t.inner, sub) };
    case "TypeRefinement":
      return { ...t, inner: substituteType(t.inner, sub) };
  }
}

/** Best-effort textual rendering of a type for diagnostic messages. */
function typeToString(t: TypeExpr): string {
  switch (t.kind) {
    case "TypePrim":
      return t.name;
    case "TypeRef":
      return t.name;
    case "TypeApp":
      return t.args.length === 0 ? t.name : `${t.name}(${t.args.map(typeToString).join(", ")})`;
    case "TypeRecord":
      return `{${t.fields.map((f) => `${f.name}: ${typeToString(f.type)}`).join(", ")}}`;
    case "TypeUnion":
      return t.variants
        .map((v) =>
          v.payloads.length === 0
            ? v.name
            : `${v.name}(${v.payloads.map(typeToString).join(", ")})`,
        )
        .join(" | ");
    case "TypeNominal":
      return `nominal ${typeToString(t.inner)}`;
    case "TypeRefinement":
      return typeToString(t.inner);
  }
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
    const checkRunReducer = (arg: Expr | undefined): void => {
      const rn = arg?.kind === "Ref" ? arg.name : arg?.kind === "Variant" ? arg.name : undefined;
      if (rn !== undefined && !sym.reducers.has(rn)) {
        errors.push({
          code: "E0102",
          kind: "undef-reducer",
          message: `Reference to undefined reducer "${rn}" in run-reducer`,
          pos: arg?.pos ?? t.pos,
        });
      }
    };
    walkExpr(t.invariant, (n) => {
      if (n.kind === "Call" && n.callee === "run-reducer") checkRunReducer(n.args[0]);
      if (n.kind === "MethodCall" && n.method === "run-reducer") checkRunReducer(n.args[0]);
    });
    return;
  }
  if (t.testKind === "reducer-test") {
    // A reducer-test `expect` is always an Expr (a tile-test's is a TileExpr).
    walkExpr(t.expect as Expr, (n) => {
      if (n.kind === "Wildcard" && n.wild === "slot" && !sym.slots.has(n.slot)) {
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
  checkTileExpr(t.expect as TileExpr, sym, errors, { kind: "tile", localBinds: new Set() });
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
  for (const e of app.init) {
    checkExpr(e, sym, errors, {
      kind: "reducer",
      localBinds: new Set(),
      capsAvailable: new Set(app.caps),
    });
  }
}

function resolveType(t: TypeExpr, sym: SymbolTable, errors: KumikiError[]): void {
  switch (t.kind) {
    case "TypePrim":
      return;
    case "TypeRef":
      if (!sym.types.has(t.name)) {
        // Could be an in-scope type param of an enclosing TypeDef; we don't track those yet.
        return;
      }
      return;
    case "TypeApp": {
      const def = sym.types.get(t.name);
      if (def && def.params.length !== t.args.length) {
        errors.push({
          code: "E0210",
          kind: "type-arity-mismatch",
          message: `Type "${t.name}" expects ${def.params.length} type argument(s) but got ${t.args.length}`,
          pos: t.pos,
        });
      }
      for (const a of t.args) resolveType(a, sym, errors);
      return;
    }
    case "TypeRecord":
      for (const f of t.fields) resolveType(f.type, sym, errors);
      return;
    case "TypeUnion":
      for (const v of t.variants) for (const p of v.payloads) resolveType(p, sym, errors);
      return;
    case "TypeNominal":
      resolveType(t.inner, sym, errors);
      return;
    case "TypeRefinement":
      resolveType(t.inner, sym, errors);
      return;
  }
}
