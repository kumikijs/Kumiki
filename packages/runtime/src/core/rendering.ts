import type { AppShape, MountedApp } from "./types.ts";

const ROOT_ATTR = "data-kumiki-root";

const appByRoot = new WeakMap<Element, MountedApp>();

/** Non-null only while a mount's synchronous render pass is running. */
let renderingApp: MountedApp | null = null;

export function registerAppRoot(target: Element, app: AppShape): void {
  appByRoot.set(target, app as MountedApp);
  target.setAttribute(ROOT_ATTR, "");
}

/** No-op unless `app` is the current registrant, so disposing an older mount
 *  of the same target never unhooks a newer one. */
export function unregisterAppRoot(target: Element, app: AppShape): void {
  if (appByRoot.get(target) !== app) return;
  appByRoot.delete(target);
  target.removeAttribute(ROOT_ATTR);
}

export function resolveApp(el: Element | null | undefined): MountedApp | undefined {
  let node: Element | null = el ?? null;
  while (node) {
    const root = node.closest(`[${ROOT_ATTR}]`);
    if (root) {
      const app = appByRoot.get(root);
      if (app) return app;
      node = root.parentElement ?? shadowHost(root);
      continue;
    }
    node = shadowHost(node);
  }
  return renderingApp ?? undefined;
}

function shadowHost(el: Element): Element | null {
  const rootNode = el.getRootNode();
  return typeof ShadowRoot !== "undefined" && rootNode instanceof ShadowRoot ? rootNode.host : null;
}

/** The app whose synchronous render pass is currently executing, if any. */
export function getRenderingApp(): MountedApp | undefined {
  return renderingApp ?? undefined;
}

/** Non-null only while one view's render pass is running: that view's host. */
let renderingView: Element | null = null;

export function getRenderingView(): Element | undefined {
  return renderingView ?? undefined;
}

/** Bracket one view's render pass; saved/restored like {@link withRenderingApp}. */
export function withRenderingView<T>(view: Element, fn: () => T): T {
  const prev = renderingView;
  renderingView = view;
  try {
    return fn();
  } finally {
    renderingView = prev;
  }
}

type RenderEpisodeHost = {
  __kumikiRenderEpisode__?: (() => string | undefined) | null | undefined;
};

export function currentEpisodeId(): string | undefined {
  return (globalThis as RenderEpisodeHost).__kumikiRenderEpisode__?.();
}

export function withRenderingApp<T>(app: AppShape, fn: () => T): T {
  const prev = renderingApp;
  const host = globalThis as RenderEpisodeHost;
  const prevEpisode = host.__kumikiRenderEpisode__;
  // Renders only run from mountCore, after the imperative seams are attached.
  renderingApp = app as MountedApp;
  host.__kumikiRenderEpisode__ = (app as MountedApp)._episodeId;
  try {
    return fn();
  } finally {
    renderingApp = prev;
    host.__kumikiRenderEpisode__ = prevEpisode;
  }
}

const warnedUnresolved = new WeakSet<Element>();

export function warnUnresolvedEvent(el: Element, what: string): void {
  if (warnedUnresolved.has(el)) return;
  warnedUnresolved.add(el);
  console.warn(`kumiki: ${what} fired on an element outside any mount root; ignored`, el);
}
