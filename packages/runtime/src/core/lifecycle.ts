import type { AppShape, ReducerSpec, TileNode } from "./types.ts";

export function installLifecycleListeners(
  app: AppShape,
  applyReducer: (r: ReducerSpec, payload: Record<string, unknown>) => void,
): Array<() => void> {
  if (typeof window === "undefined") return [];
  const has = (name: string): boolean =>
    app.reducers.some((r) => r.event.kind === "lifecycle" && r.event.name === name);
  const fire = (name: string): void => {
    for (const r of app.reducers) {
      if (r.event.kind === "lifecycle" && r.event.name === name) applyReducer(r, {});
    }
  };
  const unsubs: Array<() => void> = [];
  if (has("app.stop")) {
    const onUnload = (): void => fire("app.stop");
    window.addEventListener("beforeunload", onUnload);
    unsubs.push(() => window.removeEventListener("beforeunload", onUnload));
  }
  if (has("app.visible") || has("app.hidden")) {
    const onVis = (): void => {
      // `document` is available alongside `window` in every DOM host.
      fire(document.visibilityState === "visible" ? "app.visible" : "app.hidden");
    };
    document.addEventListener("visibilitychange", onVis);
    unsubs.push(() => document.removeEventListener("visibilitychange", onVis));
  }
  if (has("app.online")) {
    const onOnline = (): void => fire("app.online");
    window.addEventListener("online", onOnline);
    unsubs.push(() => window.removeEventListener("online", onOnline));
  }
  if (has("app.offline")) {
    const onOffline = (): void => fire("app.offline");
    window.addEventListener("offline", onOffline);
    unsubs.push(() => window.removeEventListener("offline", onOffline));
  }
  return unsubs;
}

/**
 * The user tiles a rendered node is the whole tree of, outermost first: `_named` writes one name, or
 * a list when a tile's whole body is another user tile (`tile Outer = Inner`).
 */
export function tileNames(node: TileNode): string[] {
  return [(node as { props?: Record<string, unknown> }).props?._tile]
    .flat()
    .filter((name): name is string => typeof name === "string");
}

export function collectMountedTiles(root: TileNode): Set<string> {
  const out = new Set<string>();
  const visit = (n: TileNode | null | undefined): void => {
    if (!n || typeof n !== "object") return;
    for (const name of tileNames(n)) out.add(name);
    const children = (n as { children?: TileNode[] }).children;
    if (Array.isArray(children)) for (const c of children) visit(c);
  };
  visit(root);
  return out;
}
