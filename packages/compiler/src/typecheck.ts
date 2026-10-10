import type { AppDef, FnDef, Program, TileDef, TypeDef } from "./ast.ts";
import {
  aliasTarget,
  boundaryTarget,
  expansionTargets,
  findCycles,
  forwardedParams,
  type GraphEdge,
} from "./def-graph.ts";
import { buildDefIndex, type DefIndex, referencesIn } from "./references.ts";
import { STDLIB_TYPES } from "./stdlib-types.ts";
import { checkApp } from "./typecheck/app.ts";
import type { KumikiError, SymbolTable } from "./typecheck/context.ts";
import { checkEffect } from "./typecheck/effect.ts";
import { checkFn } from "./typecheck/fn.ts";
import { checkMotion } from "./typecheck/motion.ts";
import { checkReducer } from "./typecheck/reducer.ts";
import { routeChainResolver } from "./typecheck/route-chain.ts";
import { checkSlot } from "./typecheck/slot.ts";
import { checkTest } from "./typecheck/test.ts";
import { checkTile } from "./typecheck/tile.ts";
import { collectElementIds, collectPrefetchTargets } from "./typecheck/tile-collect.ts";
import { checkTypeDef } from "./typecheck/types.ts";
import { describeDuplicate, findDuplicateDefinitions, findDuplicateNames } from "./uniqueness.ts";

export type { KumikiError } from "./typecheck/context.ts";
export { servesNotFound } from "./typecheck/route-chain.ts";
export { ROUTE_SLOT_FIELDS } from "./typecheck/slot.ts";

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
  const forwarded = forwardedParams(typeOf, "through");
  const typeEdges = (name: string): readonly GraphEdge[] => {
    const def = typeOf(name);
    if (!def) return [];
    const target = aliasTarget(def, typeOf, forwarded);
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
