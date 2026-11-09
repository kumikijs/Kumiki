import type { EpisodeLogger } from "../episode.ts";
import { type PanicRecord, panicInfo } from "./panic.ts";
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

/** `episodeId` is the episode the `panic` step landed on; `undefined` with no logger, no open episode, or a logger that threw. */
export type RenderPanic = { rec: PanicRecord; episodeId: string | undefined };

/**
 * Where a panic an `error-boundary` caught in a render pass goes: records it as a handled `panic`
 * step at `site` (or, in the render that ends hydration, records nothing) and returns the id of
 * the episode its fallback names.
 */
export type RenderPanicSink = (e: unknown, site: string) => string | undefined;

let warnedLogger = false;

/**
 * `read` against a host logger, or `undefined` once it throws: a boundary records from inside
 * the tile's own catch, so a logger that throws costs the episode id rather than the fallback.
 */
export function fromLogger<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch (e) {
    if (!warnedLogger) {
      warnedLogger = true;
      console.warn("kumiki: the episode logger threw; episode-id will be None", e);
    }
    return undefined;
  }
}

export function recordRenderPanic(
  logger: EpisodeLogger | null | undefined,
  e: unknown,
  site: string,
  handled?: boolean,
): RenderPanic {
  const rec = panicInfo(e, "tile-render");
  // A host logger's `recordPanic` may record the step and return no id, so fall back to the
  // open episode as `fireAppError` does.
  const episodeId = fromLogger(
    () => logger?.recordPanic({ ...rec, location: site, handled }) ?? logger?.currentId(),
  );
  return { rec, episodeId };
}

// On globalThis because a `bundle: true` app carries its own inlined runtime: the
// `_s.boundaryPanic` that reports belongs to that copy, the `mount` that renders to the tool's,
// and a module-local would record the panic nowhere. Shared with other runtime copies: keep the
// signature primitive, and change the key when it changes.
const PANICS = "__kumikiRenderPanic__";
const host = globalThis as { [PANICS]?: RenderPanicSink | null | undefined };

export function recordInRenderPass(e: unknown, site: string): RenderPanic {
  const id = host[PANICS]?.(e, site);
  return { rec: panicInfo(e, "tile-render"), episodeId: typeof id === "string" ? id : undefined };
}

// `panics` is the caller's rather than the app's: `renderToString` renders the same AppShape a
// mount does, into its own bootstrap log.
export function withRenderingApp<T>(app: AppShape, panics: RenderPanicSink, fn: () => T): T {
  const prev = renderingApp;
  const prevPanics = host[PANICS];
  renderingApp = app as MountedApp;
  host[PANICS] = panics;
  try {
    return fn();
  } finally {
    renderingApp = prev;
    host[PANICS] = prevPanics;
  }
}

const warnedUnresolved = new WeakSet<Element>();

export function warnUnresolvedEvent(el: Element, what: string): void {
  if (warnedUnresolved.has(el)) return;
  warnedUnresolved.add(el);
  console.warn(`kumiki: ${what} fired on an element outside any mount root; ignored`, el);
}
