import type { ReconcileDiag } from "./reconcile-diag.ts";
import { patchCommonProps, patchPropStyle } from "./style.ts";
import type { TileElementMap } from "./tile-ctx.ts";
import { tileFieldsEqual, tileTouchedId } from "./tile-equality.ts";
import type {
  ReconcileFallback,
  TileCtx,
  TileNode,
  TilePatcher,
  TilePatchers,
  TileProps,
} from "./types.ts";
import { refreshUiHandlerSlot } from "./ui-events.ts";

export class PatchRequiresRebuild extends Error {
  readonly isPatchRequiresRebuild = true as const;
  constructor(reason: string) {
    super(`patcher declined in-place update: ${reason}`);
    this.name = "PatchRequiresRebuild";
  }
}

export function reconcileTree(args: {
  oldNode: TileNode;
  oldEl: HTMLElement;
  oldMap: TileElementMap;
  newNode: TileNode;
  newMap: TileElementMap;
  ctx: TileCtx;
  patchers: TilePatchers;
  diag?: ReconcileDiag | undefined;
}): { el: HTMLElement; touched: string[] } {
  const touched: string[] = [];
  const el = reconcileNode(
    args.oldNode,
    args.oldEl,
    args.oldMap,
    args.newNode,
    args.newMap,
    args.ctx,
    args.patchers,
    touched,
    args.diag,
  );
  return { el, touched };
}

function reconcileNode(
  oldNode: TileNode,
  oldEl: HTMLElement,
  oldMap: TileElementMap,
  newNode: TileNode,
  newMap: TileElementMap,
  ctx: TileCtx,
  patchers: TilePatchers,
  touched: string[],
  diag?: ReconcileDiag | undefined,
): HTMLElement {
  if (oldNode.kind !== newNode.kind) {
    return replaceWithFreshTile(oldEl, newNode, ctx, touched);
  }
  if (!tileFieldsEqual(oldNode, newNode)) {
    diag?.neverEqual(oldNode, newNode);
    const patcher = (patchers as Record<string, TilePatcher | undefined>)[newNode.kind];
    if (patcher) {
      try {
        patcher(oldEl, oldNode as never, newNode as never, ctx);
      } catch (e) {
        if (e instanceof PatchRequiresRebuild) {
          return replaceWithFreshTile(oldEl, newNode, ctx, touched);
        }
        throw e;
      }
      refreshUiHandlerSlot(oldEl, (newNode as { props?: TileProps }).props);
      patchCommonProps(
        oldEl,
        (oldNode as { props?: TileProps }).props,
        (newNode as { props?: TileProps }).props,
      );
      patchPropStyle(
        oldEl,
        (oldNode as { props?: TileProps }).props,
        (newNode as { props?: TileProps }).props,
        newNode.kind,
      );
      touched.push(tileTouchedId(newNode));
    } else {
      diag?.fallback({ reason: "no-patcher" }, newNode);
      return replaceWithFreshTile(oldEl, newNode, ctx, touched);
    }
  } else if (newNode.kind === "error") {
    try {
      patchers.error?.(oldEl, oldNode as never, newNode as never, ctx);
    } catch (e) {
      if (e instanceof PatchRequiresRebuild) {
        return replaceWithFreshTile(oldEl, newNode, ctx, touched);
      }
      throw e;
    }
  }
  const oldChildren = getTileChildren(oldNode);
  const newChildren = getTileChildren(newNode);
  if (oldChildren.length === 0 && newChildren.length === 0) {
    newMap.set(newNode, oldEl);
    return oldEl;
  }
  if (oldChildren.length === 0 || newChildren.length === 0) {
    return adoptFreshChildren(oldEl, newNode, newChildren, ctx, newMap, touched);
  }
  if (allChildrenKeyed(oldChildren) && allChildrenKeyed(newChildren)) {
    const decision = decideKeyedPass(oldEl, newNode, oldChildren, newChildren, oldMap);
    if (!decision.run) {
      diag?.fallback(decision.fallback, newNode);
    } else {
      reconcileKeyedChildren(
        oldEl,
        oldChildren,
        decision.oldEls,
        newChildren,
        oldMap,
        newMap,
        ctx,
        patchers,
        touched,
        diag,
      );
      newMap.set(newNode, oldEl);
      return oldEl;
    }
  }
  if (oldChildren.length !== newChildren.length) {
    diag?.fallback(
      {
        reason: "child-count-change",
        oldCount: oldChildren.length,
        newCount: newChildren.length,
      },
      newNode,
    );
    return replaceWithFreshTile(oldEl, newNode, ctx, touched);
  }
  const resolved = resolvePositionalChildren(oldChildren, newChildren, oldMap);
  if (!resolved.paired) {
    diag?.fallback(resolved.fallback, newNode);
    return replaceWithFreshTile(oldEl, newNode, ctx, touched);
  }
  for (const pair of resolved.pairs) {
    reconcileNode(
      pair.oldNode,
      pair.oldEl,
      oldMap,
      pair.newNode,
      newMap,
      ctx,
      patchers,
      touched,
      diag,
    );
  }
  newMap.set(newNode, oldEl);
  return oldEl;
}

function allChildrenKeyed(nodes: TileNode[]): boolean {
  if (nodes.length === 0) return false;
  for (const n of nodes) if (!n || typeof n.key !== "string") return false;
  return true;
}

function adoptFreshChildren(
  oldEl: HTMLElement,
  newNode: TileNode,
  newChildren: TileNode[],
  ctx: TileCtx,
  newMap: TileElementMap,
  touched: string[],
): HTMLElement {
  const fresh = ctx.render(newNode);
  oldEl.replaceChildren(...Array.from(fresh.childNodes));
  newMap.set(newNode, oldEl);
  if (newChildren.length === 0) {
    touched.push(tileTouchedId(newNode));
  } else {
    for (const child of newChildren) if (child) touched.push(tileTouchedId(child));
  }
  return oldEl;
}

export const WRAPPING_TILE_KINDS: readonly string[] = Object.freeze([
  "overlay",
  "modal",
  "drawer",
  "popover",
]);

const WRAPPING_TILE_KIND_SET: ReadonlySet<string> = new Set(WRAPPING_TILE_KINDS);

type KeyedPassDecision =
  | { readonly run: true; readonly oldEls: readonly HTMLElement[] }
  | { readonly run: false; readonly fallback: ReconcileFallback };

function decideKeyedPass(
  parentEl: HTMLElement,
  parentNode: TileNode,
  oldChildren: TileNode[],
  newChildren: TileNode[],
  oldMap: TileElementMap,
): KeyedPassDecision {
  const wrapped = firstWrappedChild(parentEl, oldChildren, oldMap);
  if (wrapped) {
    return {
      run: false,
      fallback: { reason: "wrapped-children", index: wrapped.index, childKind: wrapped.childKind },
    };
  }
  const oldEls: HTMLElement[] = [];
  for (const oldChild of oldChildren) {
    const el = oldMap.get(oldChild);
    if (!el) {
      throw new Error(
        `reconcile: keyed old tile "${oldChild.key}" has no live element mapping — invariant violation in makeMappingTileCtx`,
      );
    }
    oldEls.push(el);
  }
  if (!WRAPPING_TILE_KIND_SET.has(parentNode.kind)) return { run: true, oldEls };
  const newcomer = firstUnmatchedChild(oldChildren, newChildren);
  if (!newcomer) return { run: true, oldEls };
  return {
    run: false,
    fallback: {
      reason: "unplaceable-insert",
      index: newcomer.index,
      childKind: newcomer.childKind,
    },
  };
}

/** One positional child pair, with the live element the old side is mounted as. */
type PositionalChildPair = {
  readonly oldNode: TileNode;
  readonly oldEl: HTMLElement;
  readonly newNode: TileNode;
};

type PositionalChildFallback = Extract<
  ReconcileFallback,
  { reason: "child-hole" | "child-unmapped" }
>;

/** Either the whole child list paired up, or the reason none of it did. */
type PositionalChildResult =
  | { readonly paired: true; readonly pairs: readonly PositionalChildPair[] }
  | { readonly paired: false; readonly fallback: PositionalChildFallback };

function resolvePositionalChildren(
  oldChildren: TileNode[],
  newChildren: TileNode[],
  oldMap: TileElementMap,
): PositionalChildResult {
  const pairs: PositionalChildPair[] = [];
  for (let i = 0; i < newChildren.length; i++) {
    const oldNode = oldChildren[i];
    const newNode = newChildren[i];
    if (!oldNode || !newNode) {
      return { paired: false, fallback: { reason: "child-hole", index: i } };
    }
    const oldEl = oldMap.get(oldNode);
    if (!oldEl) {
      return {
        paired: false,
        fallback: { reason: "child-unmapped", index: i, childKind: oldNode.kind },
      };
    }
    pairs.push({ oldNode, oldEl, newNode });
  }
  return { paired: true, pairs };
}

function firstUnmatchedChild(
  oldChildren: TileNode[],
  newChildren: TileNode[],
): { index: number; childKind: string } | undefined {
  const oldKeys = new Set<string>();
  for (const child of oldChildren) if (typeof child?.key === "string") oldKeys.add(child.key);
  for (let i = 0; i < newChildren.length; i++) {
    const child = newChildren[i];
    if (child && !oldKeys.has(child.key as string)) return { index: i, childKind: child.kind };
  }
  return undefined;
}

function firstWrappedChild(
  parentEl: HTMLElement,
  oldChildren: TileNode[],
  oldMap: TileElementMap,
): { index: number; childKind: string } | undefined {
  for (let i = 0; i < oldChildren.length; i++) {
    const child = oldChildren[i];
    if (!child) continue;
    const el = oldMap.get(child);
    if (el && el.parentNode !== parentEl) return { index: i, childKind: child.kind };
  }
  return undefined;
}

function reconcileKeyedChildren(
  parentEl: HTMLElement,
  oldChildren: TileNode[],
  oldEls: readonly HTMLElement[],
  newChildren: TileNode[],
  oldMap: TileElementMap,
  newMap: TileElementMap,
  ctx: TileCtx,
  patchers: TilePatchers,
  touched: string[],
  diag?: ReconcileDiag | undefined,
): void {
  const seenNew = new Set<string>();
  for (const nc of newChildren) {
    const k = nc.key as string;
    if (seenNew.has(k)) {
      throw new Error(
        `reconcile: duplicate TileNode.key "${k}" among sibling tiles — keys must be unique within a parent's children list`,
      );
    }
    seenNew.add(k);
  }
  const tailAnchor = childListEnd(oldEls);
  const byKey = new Map<string, { node: TileNode; index: number }>();
  for (let i = 0; i < oldChildren.length; i++) {
    const oc = oldChildren[i] as TileNode;
    if (typeof oc.key === "string") byKey.set(oc.key, { node: oc, index: i });
  }
  const targetEls: HTMLElement[] = [];
  const oldIndexOf: number[] = [];
  const matched = new Set<TileNode>();
  for (const newChild of newChildren) {
    const key = newChild.key as string;
    const pairing = byKey.get(key);
    if (pairing) {
      const oldChild = pairing.node;
      matched.add(oldChild);
      const el = reconcileNode(
        oldChild,
        oldEls[pairing.index] as HTMLElement,
        oldMap,
        newChild,
        newMap,
        ctx,
        patchers,
        touched,
        diag,
      );
      targetEls.push(el);
      oldIndexOf.push(pairing.index);
    } else {
      touched.push(tileTouchedId(newChild));
      targetEls.push(ctx.render(newChild));
      oldIndexOf.push(-1);
    }
  }
  for (let i = 0; i < oldChildren.length; i++) {
    if (matched.has(oldChildren[i] as TileNode)) continue;
    parentEl.removeChild(oldEls[i] as HTMLElement);
  }
  const stays = childrenAlreadyInOrder(oldIndexOf);
  for (let i = targetEls.length - 1; i >= 0; i--) {
    if (stays.has(i)) continue;
    parentEl.insertBefore(targetEls[i] as HTMLElement, targetEls[i + 1] ?? tailAnchor);
  }
}

function childListEnd(oldEls: readonly HTMLElement[]): ChildNode | null {
  return (oldEls[oldEls.length - 1] as HTMLElement).nextSibling;
}

function childrenAlreadyInOrder(oldIndexOf: number[]): Set<number> {
  const survivors: number[] = [];
  let ascending = true;
  let highest = -1;
  for (let i = 0; i < oldIndexOf.length; i++) {
    const old = oldIndexOf[i] as number;
    if (old < 0) continue;
    if (old < highest) ascending = false;
    else highest = old;
    survivors.push(i);
  }
  if (ascending) return new Set(survivors);

  const predecessor = new Array<number>(survivors.length).fill(-1);
  const runEnds: number[] = [];
  for (let s = 0; s < survivors.length; s++) {
    const value = oldIndexOf[survivors[s] as number] as number;
    let lo = 0;
    let hi = runEnds.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((oldIndexOf[survivors[runEnds[mid] as number] as number] as number) < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) predecessor[s] = runEnds[lo - 1] as number;
    runEnds[lo] = s;
  }
  const stays = new Set<number>();
  let cursor = runEnds.length > 0 ? (runEnds[runEnds.length - 1] as number) : -1;
  while (cursor >= 0) {
    stays.add(survivors[cursor] as number);
    cursor = predecessor[cursor] as number;
  }
  return stays;
}

function replaceWithFreshTile(
  oldEl: HTMLElement,
  newNode: TileNode,
  ctx: TileCtx,
  touched: string[],
): HTMLElement {
  touched.push(tileTouchedId(newNode));
  const fresh = ctx.render(newNode);
  const parent = oldEl.parentNode;
  if (!parent) {
    throw new Error(
      `reconcile: cannot splice new tile "${newNode.kind}" — old element has no parent (subtree detached from live DOM)`,
    );
  }
  parent.replaceChild(fresh, oldEl);
  return fresh;
}

const EMPTY_TILES: TileNode[] = [];

function getTileChildren(node: TileNode): TileNode[] {
  const c = (node as { children?: TileNode[] }).children;
  return Array.isArray(c) ? c : EMPTY_TILES;
}
