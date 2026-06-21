// Kumiki runtime core — mount, reducer/effect dispatch, theming, and the tile
// render seam. This module is the root of the granular runtime (#71): every
// other runtime module may value-import ONLY from here (plus `stdlib.ts` for
// the effect modules), so `kumiki build` can ship `core.js` + just the feature
// modules a compiled app actually uses. The assembled full API (classic
// `mount` with every tile/effect/router wired in) lives in `index.ts`.

import type { EpisodeLogger, SlotDiff } from "./episode.ts";

export type RefinementCheck = (v: unknown) => boolean;
export type EventHandler = (el: Record<string, unknown>) => void;

/**
 * A controlled panic — Kumiki's "stop the program" signal (docs/spec/stdlib.md §2.2:
 * `panic(message)`; `Option/Result.get` on the empty case; `Result.get-err` on
 * `Ok`). On the live path a panic is caught — the dispatch episode is rolled
 * back (no partial slot writes) and an error boundary / top-level fallback is
 * shown — instead of escaping the DOM event handler / render uncaught. The
 * reducer-test harness already catches it to power `expect = {panic: ...}`.
 */
export class KumikiPanic extends Error {
  readonly isKumikiPanic = true as const;
  readonly location: string | undefined;
  constructor(message: string, location?: string) {
    super(message);
    this.name = "KumikiPanic";
    this.location = location;
  }
}

/** True for a KumikiPanic — also matches across realms where `instanceof` fails. */
function isPanic(e: unknown): e is KumikiPanic {
  return (
    e instanceof KumikiPanic ||
    (typeof e === "object" &&
      e !== null &&
      (e as { isKumikiPanic?: boolean }).isKumikiPanic === true)
  );
}

export type TileNode =
  | { kind: "page" | "column" | "row" | "card" | "box"; children: TileNode[]; props?: TileProps }
  | { kind: "heading" | "text"; text: string; props?: TileProps }
  | { kind: "button"; text: string; props?: TileProps; loading?: boolean; disabled?: boolean }
  | {
      kind: "input";
      props?: TileProps;
      bind?: string;
      bindPath?: string[];
      value?: string;
      type?: string;
      placeholder?: string;
      required?: boolean;
      autoFocus?: boolean;
      id?: string;
      accept?: string;
      multiple?: boolean;
    }
  | {
      kind: "textarea";
      props?: TileProps;
      bind?: string;
      bindPath?: string[];
      value?: string;
      rows?: number;
      placeholder?: string;
      id?: string;
    }
  | { kind: "check"; checked: boolean; props?: TileProps }
  | { kind: "spinner"; props?: TileProps }
  | { kind: "skeleton"; props?: TileProps }
  | { kind: "form"; children: TileNode[]; props?: TileProps }
  | { kind: "label"; text: string; props?: TileProps }
  | {
      kind: "link";
      text: string;
      to: string;
      /** §3.8 prefetch: name of the reducer to dispatch on viewport entry. */
      prefetch?: string;
      /** §3.8 prefetch-args: payload passed to the reducer's `$el` / `$event` binding. */
      prefetchArgs?: Record<string, unknown>;
      props?: TileProps;
    }
  | { kind: "markdown"; text: string; props?: TileProps }
  | { kind: "image"; src: string; props?: TileProps }
  | { kind: "icon"; name: string; props?: TileProps }
  | {
      kind: "select";
      props?: TileProps;
      bind?: string;
      bindPath?: string[];
      value?: unknown;
      options?: Array<{ label: unknown; value: unknown }>;
      placeholder?: string;
    }
  | { kind: "radio"; props?: TileProps; group?: string; value?: unknown; selected?: boolean }
  | {
      kind: "grid" | "stack" | "region" | "scroll" | "panel" | "fieldset" | "overlay";
      children: TileNode[];
      props?: TileProps;
    }
  | { kind: "divider"; props?: TileProps }
  | { kind: "code"; text: string; lang?: string; props?: TileProps }
  | { kind: "video"; src?: string; controls?: boolean; autoplay?: boolean; props?: TileProps }
  | { kind: "list"; ordered?: boolean; children: TileNode[]; props?: TileProps }
  | {
      kind: "list-item" | "table" | "table-head" | "table-body" | "table-row";
      children: TileNode[];
      props?: TileProps;
    }
  | {
      kind: "table-cell";
      children: TileNode[];
      colspan?: number;
      rowspan?: number;
      props?: TileProps;
    }
  | {
      kind: "modal" | "drawer" | "popover";
      children: TileNode[];
      open?: boolean;
      title?: string;
      side?: string;
      placement?: string;
      props?: TileProps;
    }
  | { kind: "tooltip"; children: TileNode[]; text?: string; placement?: string; props?: TileProps }
  | { kind: "toast"; level?: string; text?: string; props?: TileProps }
  | { kind: "progress"; value?: number; max?: number; props?: TileProps }
  | {
      kind: "slider";
      props?: TileProps;
      bind?: string;
      bindPath?: string[];
      value?: number;
      min?: number;
      max?: number;
      step?: number;
    }
  | { kind: "switch"; checked: boolean; props?: TileProps }
  | { kind: "error"; field: string; props?: TileProps }
  | { kind: "route-outlet"; children: TileNode[]; props?: TileProps };

export type TileProps = Record<string, unknown> & {
  onClick?: EventHandler;
  onSubmit?: EventHandler;
  onChange?: EventHandler;
  onInput?: EventHandler;
  onClose?: EventHandler;
  onKeyDown?: EventHandler;
  onMouseEnter?: EventHandler;
  el?: Record<string, unknown>;
};

export type SlotMeta = {
  value: unknown;
  refine?: RefinementCheck;
  volatile?: boolean;
  /** Refinement predicate name + args — drives the `error` tile's message. */
  refineKind?: string;
  refineArgs?: (number | string)[];
};

export type ReducerSpec = {
  name: string;
  selector?: { tile: string; id?: string };
  event:
    | { kind: "ui"; ev: "click" | "submit" | "change" | "input" }
    | { kind: "effect"; effect: string; outcome: "ok" | "err" }
    | { kind: "timer"; intervalMs: number; name?: string }
    | { kind: "lifecycle"; name: string };
  apply: (
    slots: Record<string, unknown>,
    payload: Record<string, unknown>,
  ) => { slots: Record<string, unknown>; emits: EmitSpec[]; stopTimers?: string[] };
};

export type EmitSpec = { effect: string; args: unknown[] };

export type EffectSpec = {
  name: string;
  cap: string;
  policy?:
    | { kind: "latest" }
    | { kind: "latest-per-key"; keyOf: (input: unknown) => string }
    | { kind: "queue" }
    | { kind: "debounce"; ms: number }
    | { kind: "throttle"; ms: number }
    | { kind: "once" };
  /**
   * Retry policy (#83, spec http.md §6.5). Only 5xx / connection errors are
   * retried; 4xx is treated as a final failure. The dispatcher reads this on
   * each `launch` cycle — invoke itself stays single-shot.
   */
  retry?:
    | { kind: "linear"; n: number; ms: number }
    | { kind: "exponential"; n: number; ms: number; factor: number };
  invoke: (input: unknown, caps: CapabilityRegistry, signal?: AbortSignal) => Promise<EffectResult>;
};

export type EffectResult = { kind: "ok"; value: unknown } | { kind: "err"; value: unknown };

/**
 * A host-supplied implementation for a custom capability (one registered via
 * `kumiki.caps.json`). This is Kumiki's inbound ecosystem seam: arbitrary JS /
 * npm libraries live here, behind a typed, mockable capability boundary, so the
 * Kumiki core stays pure (no language-level FFI). `input` is the effect's
 * (already `map-request`-mapped) request; the return may be sync or async.
 */
export type CapabilityProvider = (
  input: unknown,
  caps: CapabilityRegistry,
  signal?: AbortSignal,
) => Promise<EffectResult> | EffectResult;

export type CapabilityRegistry = {
  has(cap: string): boolean;
  /** The host provider registered for `cap` at mount, or undefined. */
  provider(cap: string): CapabilityProvider | undefined;
};

/**
 * Renders one tile node into a DOM element. `ctx.render` is the recursion seam
 * — child tiles go back through the active registry, so a renderer never needs
 * to know which other tile modules are loaded.
 */
export type TileCtx = { render(node: TileNode): HTMLElement };

// `TileNode & { kind: K }` (not `Extract`) so kinds that share a variant
// (e.g. `page` / `column`) still narrow to their member: TS reduces the
// conflicting-discriminant intersections to never and keeps the right one.
export type TileRenderer<K extends TileNode["kind"] = TileNode["kind"]> = (
  node: TileNode & { kind: K },
  ctx: TileCtx,
) => HTMLElement;

/** A registry of tile renderers, keyed by `TileNode["kind"]`. */
export type TileRenderers = { [K in TileNode["kind"]]?: TileRenderer<K> };

/** Mount-internal navigation handles handed to builtin-effect installers. */
export type NavContext = {
  navigate: (path: string, replace: boolean) => void;
  back: () => void;
};

/**
 * Installs one or more built-in effects (e.g. `toast`) onto `app.effects` at
 * mount. Kept as a seam so `kumiki build` only ships the installers an app can
 * actually emit.
 */
export type BuiltinInstaller = (app: AppShape, nav: NavContext) => void;

/**
 * The routing feature module's surface (see `router.ts`). Optional at mount:
 * a routeless app never pays for router/nav-effect code (#71).
 */
export type RoutingImpl = {
  createRouter(mode: "history" | "memory" | undefined, initialPath?: string): Router;
  parseLocation(routes: AppShape["routes"], loc: LocationLike): ParsedRoute;
  matchPattern(pattern: string, path: string): Record<string, string> | null;
  /**
   * Resolve any static redirect (`->>`) that applies to the current location —
   * top-level entry, or one under a matched parent's `subRoutes`. Returns the
   * redirect target path, or `null` if no redirect applies. The runtime then
   * `router.replace`s before parsing so the URL bar stays in sync with what is
   * rendered.
   */
  findRedirect(routes: AppShape["routes"], loc: LocationLike): string | null;
  /** Register navigate / navigate-replace / navigate-back on `app.effects`. */
  installNavEffects(app: AppShape, nav: NavContext): void;
};

/** Options accepted by `mount`. */
export type MountOptions = {
  /** Host implementations for custom capabilities, keyed by capability name. */
  providers?: Record<string, CapabilityProvider>;
  /**
   * Where Kumiki injects its `<style>` nodes (motion / theme / state styles).
   * Defaults to `document` (styles go in `<head>`). Pass a `ShadowRoot` to keep
   * them encapsulated — used by `defineKumikiElement({ shadow: true })`.
   */
  styleRoot?: Document | ShadowRoot;
  /**
   * The element whose inline style carries theme background/foreground/font
   * (the `<body>` equivalent). Defaults to `document.body`; the shadow element
   * passes its in-shadow container so theming stays encapsulated.
   */
  styleHost?: HTMLElement;
  /**
   * Routing source (#36). `"history"` (default) reads/writes the ambient
   * document `location` / `history`. `"memory"` holds the current path in
   * memory and never touches `history.*` — for embedded / sandboxed hosts (the
   * docs playground `srcdoc`, a Web Component) where the Kumiki app does not own
   * the top-level URL and `history.pushState` throws in an opaque origin.
   */
  router?: "history" | "memory";
  /** Initial path for the memory router (default `"/"`). Ignored in history mode. */
  initialPath?: string;
  /**
   * Tile renderers available to this mount (#71). `mountCore` renders ONLY what
   * is registered here; the classic `mount` from the package entry fills in the
   * full built-in set.
   */
  tiles?: TileRenderers;
  /** The routing feature module (`routing` from `router.ts`), when the app routes. */
  routing?: RoutingImpl;
  /** Built-in effect installers (e.g. `installToast`) this app can emit. */
  builtins?: BuiltinInstaller[];
  /**
   * Episode logger (docs/spec/runtime.md §10.5). When provided, every reducer
   * / effect-start / effect-end / signal-update / panic that occurs during
   * this mount is recorded into the logger; `kumiki run --episode-log` and the
   * `episode-test` runner both read from this. Omit (or pass `null`) for
   * production mounts that don't care about episode capture.
   */
  episodeLogger?: EpisodeLogger | null;
};

export type RouteEntry = {
  pattern: string;
  /** Returns the TileNode for this route given the current state. */
  tile: () => TileNode;
  /**
   * Nested route table for parent routes that delegate to a `route-outlet`
   * (spec/routing.md §3.6). When the parent's wildcard pattern matches, the
   * runtime re-matches the path against these entries and injects the matched
   * child tile into the first `route-outlet` of the parent's render tree.
   */
  subRoutes?: Array<RouteEntry | RedirectEntry>;
  /**
   * §3.9 scroll-restoration. When `false`, the runtime skips both the
   * forward-navigation scrollTo(0,0) and the back-navigation restore for this
   * route. Tiles that own their own internal scroll surface (chats, virtual
   * lists) set this to keep the chrome stable across transitions.
   */
  scrollRestoration?: false;
};

export type RedirectEntry = { pattern: string; redirectTo: string };

export type ThemeValue = string | number | { [k: string]: ThemeValue };
export type Theme = { [k: string]: ThemeValue };

export type AppShape = {
  slots: Record<string, SlotMeta>;
  caps: string[];
  reducers: ReducerSpec[];
  effects: Record<string, EffectSpec>;
  init: EmitSpec[];
  routes?: Array<RouteEntry | RedirectEntry>;
  http?: {
    baseUrl?: string;
    headers?: () => Record<string, string>;
    on401?: string;
    on403?: string;
    on5xx?: string;
    timeout?: number;
    credentials?: RequestCredentials;
  };
  /** §6.7.4: declared IndexedDB stores. The runtime opens the DB on first indexed-* effect. */
  indexedDb?: {
    name: string;
    version: number;
    stores: { name: string; key: string; indexes?: string[] }[];
  };
  themes?: Record<string, Theme>;
  /** selected theme name. */
  themeName?: string | null;
  /**
   * Compile-time-baked built-in icon registry (#101). Maps spec-form names
   * (`"check"`, `"chevron-down"`, …) to single-path SVG `d` data inside a
   * 24×24 viewBox. Populated by the toolchain (`@kumikijs/vite` / `kumiki`
   * CLI) from `@kumikijs/icons`, restricted to names actually referenced by
   * `icon(name="<literal>")` in the source. `theme.icons[name]` (when set)
   * overrides any entry here.
   *
   * The renderer reads `icons` off `globalThis.__kumikiApp`, which holds the
   * most-recently-mounted instance. When several Kumiki apps share a page
   * (Web Component, micro-frontend), the last mount wins for unrelated apps
   * too. The compiled icon set is normally identical across mounts of the
   * same source, so this is only a hazard when two distinct apps with
   * different icon registries share the document — wrap one in a closed
   * shadow root, or pre-merge their `theme.icons`, to avoid cross-talk.
   */
  icons?: Record<string, string>;
  /** reusable scoped animations by name (closed-grammar keyframes + timing). */
  motions?: Record<string, unknown>;
  /** §4.10: document-level metadata applied to <head> at mount. */
  meta?: {
    title?: string;
    description?: string;
    ogImage?: string;
    favicon?: string;
  };
  /**
   * §10.4.6: default sink for the `analytics.send` capability. Installed only
   * when no host provider for `analytics.send` is registered, so the inbound
   * ecosystem seam (real analytics SDK) still wins. `appId` (if set) is merged
   * into every event payload.
   */
  analytics?: {
    provider: "console" | "noop";
    appId?: string;
  };
  root?: () => TileNode;
  live?: Record<string, unknown>;
  _rerender?: () => void;
};

export type ParsedRoute = {
  path: string;
  pattern: string;
  params: Record<string, string>;
  query: Record<string, string>;
  hash: string | null;
  /** Matched sub-route pattern when the parent route delegates to `route-outlet` (§3.6). */
  childPattern?: string;
};

/** The slice of `Location` the routing path actually reads. */
export type LocationLike = { pathname: string; search: string; hash: string };

/**
 * Routing source abstraction (#36). `historyRouter` drives the ambient document
 * `location` / `history`; `memoryRouter` holds the path in memory for embedded /
 * sandboxed hosts (playground `srcdoc`, Web Component) where the app does not
 * own the URL and `history.*` throws in an opaque origin. Implementations live
 * in `router.ts`.
 */
export interface Router {
  read(): LocationLike;
  push(path: string): void;
  replace(path: string): void;
  back(): void;
  /** Subscribe to out-of-band location changes (browser back/forward). */
  subscribe(cb: () => void): () => void;
}

function emptyRoute(): ParsedRoute {
  return { path: "/", pattern: "/", params: {}, query: {}, hash: null };
}

/**
 * The granular mount (#71): renders with exactly the tile renderers / routing /
 * builtin effects passed via options. Generated apps from `kumiki build` call
 * this with just the modules they import; the package-entry `mount` wraps it
 * with the full built-in set for back-compat.
 */
export function mountCore(
  app: AppShape,
  target: HTMLElement,
  options: MountOptions = {},
): { dispose: () => void; episodes: () => ReturnType<EpisodeLogger["list"]> } {
  // Episode logger (§10.5). Null when the host did not opt in — every record
  // call below short-circuits via the `?.` optional chain, so the no-logger
  // path stays zero-cost.
  const episode: EpisodeLogger | null = options.episodeLogger ?? null;
  if (!app.live) {
    app.live = {};
    for (const [k, v] of Object.entries(app.slots)) app.live[k] = v.value;
  }
  // Ensure `route` slot exists (auto-managed by runtime when routes are declared).
  if (!("route" in app.live)) {
    app.live.route = emptyRoute();
  }
  // Route every <style> injection to the requested root (document head by
  // default, or a shadow root for an isolated Web Component). Reset the cached
  // state-style node so it is re-resolved into this mount's root.
  currentStyleRoot = options.styleRoot ?? document;
  currentStyleHost = options.styleHost ?? null;
  stateStylesEl = null;
  // Inject the app's `motion` keyframes (+ prefers-reduced-motion guard) once.
  ensureMotionStyles(app);
  const slotValues = app.live;

  const tileCtx = makeTileCtx(options.tiles ?? {});

  // Routing source: provided by the router feature module. A mount without
  // `options.routing` has no router at all — route-slot reads stay static and
  // navigation is a no-op (#71: routeless apps ship no router code).
  const routing = options.routing;
  const router: Router | null = routing
    ? routing.createRouter(options.router, options.initialPath)
    : null;
  let routerUnsub: (() => void) | undefined;

  // Apply document-level metadata (§4.10) once at mount. Skipped silently in
  // non-DOM hosts (tests using a mock `target` without a real document).
  applyAppMeta(app);
  // Merge the default `analytics.send` provider from `app.analytics` (§10.4.6).
  // Host-supplied providers (options.providers) take precedence — this only
  // fills the gap when the app declares an analytics sink directly.
  const providers = withAnalyticsDefault(app, options.providers);
  const caps = makeCapabilityRegistry(app.caps, providers);
  const dispatcher = makeEffectDispatcher(
    app,
    caps,
    (effect, outcome, value, key, token) => {
      handleEffectResult(effect, outcome, value, key, token);
    },
    episode ? (effect, input) => episode.recordEffectStart(effect, input) : undefined,
    episode ? (targetId) => episode.recordEffectCancel(targetId) : undefined,
  );

  // route.leave guard pending state (routing §3.5.2 + lifecycle §7.6):
  // when a route.leave reducer emits `confirm`, the runtime holds the
  // transition — the modal stays on top of the OLD route's tile, and Yes/No
  // (from the confirm effect handler) either commits newRoute + fires
  // route.enter, or reverts the router to oldRoute's path.
  let pendingLeave: { oldRoute: ParsedRoute; newRoute: ParsedRoute } | null = null;
  let observeLeaveConfirm = false;
  let leaveAskedConfirm = false;

  // §3.9 scroll restoration: track per-path scroll positions and the source of
  // each navigation. push / replace forward → scroll to top (unless the matched
  // tile opted out with `scroll-restoration = false`); popstate → restore the
  // saved position for the destination path.
  const scrollSaved = new Map<string, { x: number; y: number }>();
  let lastNavSource: "push" | "replace" | "pop" = "push";

  let currentRoot: HTMLElement | null = null;
  let disposed = false;
  // Named timers (`timer(d, name=N)`) are addressable so a reducer can
  // `stop-timer(N)`. Anonymous timers have no handle exposed to the app.
  const namedTimers = new Map<string, ReturnType<typeof setInterval>>();
  const anonTimers: ReturnType<typeof setInterval>[] = [];
  // Names of user-defined tiles currently mounted, from the previous render's
  // tree walk. The diff with the new render's set drives the
  // `tile.mount(X) / tile.unmount(X)` lifecycle reducers (§7.1.6).
  let prevMountedTiles = new Set<string>();
  const render = (): void => {
    // Late effect results (e.g. an in-flight fetch that resolves after the app
    // was disposed) must not touch the DOM — `currentRoot` has already been
    // detached by dispose()'s `replaceChildren()`, so replaceChild would throw.
    if (disposed) return;
    type FocusSnap = {
      bind?: string | undefined;
      id?: string | undefined;
      path?: number[] | undefined;
      selStart: number | null;
      selEnd: number | null;
    } | null;
    let snap: FocusSnap = null;
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === "INPUT" || active.tagName === "TEXTAREA") &&
      target.contains(active)
    ) {
      const el = active as HTMLInputElement;
      snap = {
        bind: el.dataset.kumikiBind ?? undefined,
        id: el.id || undefined,
        path: domPath(el, target),
        selStart: el.selectionStart,
        selEnd: el.selectionEnd,
      };
    }

    maybeReapplyTheme(app);
    let dom: HTMLElement;
    let renderedTree: TileNode | null = null;
    try {
      renderedTree = pickRootTile(app);
      dom = tileCtx.render(renderedTree);
    } catch (e) {
      // A render panic NOT caught by a per-tile `error-boundary` (e.g. one under
      // the root) lands here: surface it to a per-route `route.error(<pattern>)`
      // reducer if one matches (§7.5.2) so the app can replace the broken page;
      // otherwise render a top-level panic fallback so the exception does not
      // escape and leave the DOM stale. Logged via console.error so the smoke /
      // scenario tiers still flag it (#24).
      reportPanic("render", e);
      episode?.recordPanic(panicInfo(e).message, "render");
      if (!fireRouteError(e)) {
        dom = renderPanicFallback(e);
      } else {
        // route.error handlers ran — they may have navigated. Re-render once
        // (without retrying the broken tile) and use whatever the next pick
        // produces. If the re-render still throws, fall back to the panic UI.
        try {
          renderedTree = pickRootTile(app);
          dom = tileCtx.render(renderedTree);
        } catch (e2) {
          reportPanic("render", e2);
          renderedTree = null;
          dom = renderPanicFallback(e2);
        }
      }
    }
    if (currentRoot) target.replaceChild(dom, currentRoot);
    else target.appendChild(dom);
    currentRoot = dom;

    if (snap) {
      let sel: Element | null = snap.bind
        ? target.querySelector(`[data-kumiki-bind="${snap.bind}"]`)
        : snap.id
          ? target.querySelector(`#${CSS.escape(snap.id)}`)
          : null;
      // Fall back to DOM-path restore for inputs without bind/id (e.g.
      // `value=`-only search boxes). Identifies the element by its position.
      if (!sel && snap.path) sel = elementAtPath(snap.path, target);
      if (sel && (sel.tagName === "INPUT" || sel.tagName === "TEXTAREA")) {
        const el = sel as HTMLInputElement;
        el.focus();
        if (snap.selStart !== null && snap.selEnd !== null) {
          try {
            el.setSelectionRange(snap.selStart, snap.selEnd);
          } catch {
            // some input types don't support selection
          }
        }
      }
    }

    // tile.mount(X) / tile.unmount(X): walk the tree, diff against the previous
    // render's set, fire the lifecycle reducer for each newly-present / newly-
    // absent user tile (§7.1.6). The set is updated BEFORE the reducer fires so
    // a re-render kicked off by the reducer sees the post-mount snapshot — that
    // is what prevents mount events from re-firing every reducer cycle.
    const nowMounted = renderedTree ? collectMountedTiles(renderedTree) : new Set<string>();
    if (nowMounted.size > 0 || prevMountedTiles.size > 0) {
      const toMount: string[] = [];
      const toUnmount: string[] = [];
      for (const n of nowMounted) if (!prevMountedTiles.has(n)) toMount.push(n);
      for (const n of prevMountedTiles) if (!nowMounted.has(n)) toUnmount.push(n);
      prevMountedTiles = nowMounted;
      for (const n of toMount) fireLifecycle(`tile.mount(${JSON.stringify(n)})`);
      for (const n of toUnmount) fireLifecycle(`tile.unmount(${JSON.stringify(n)})`);
    }
  };

  function fireLifecycle(name: string): void {
    for (const r of app.reducers) {
      if (r.event.kind === "lifecycle" && r.event.name === name) applyReducer(r, {});
    }
  }

  function fireRouteError(e: unknown): boolean {
    if (!app.routes || app.routes.length === 0) return false;
    const cur = slotValues.route as ParsedRoute | undefined;
    const pattern = cur?.pattern;
    if (!pattern) return false;
    const eventName = `route.error(${JSON.stringify(pattern)})`;
    const handlers = app.reducers.filter(
      (r) => r.event.kind === "lifecycle" && r.event.name === eventName,
    );
    if (handlers.length === 0) return false;
    const info = { ...panicInfo(e), pattern };
    for (const h of handlers) {
      try {
        applyReducer(h, { $event: info, $route: cur });
      } catch {
        // a panic inside route.error itself is logged via the inner applyReducer
        // path; we just keep iterating other handlers.
      }
    }
    return true;
  }

  function pickRootTile(app: AppShape): TileNode {
    if (app.routes && app.routes.length > 0) {
      const cur = slotValues.route as ParsedRoute;
      for (const r of app.routes) {
        if (r.pattern === cur.pattern && "tile" in r) {
          const root = r.tile();
          // §3.6: parent route delegates child rendering to `route-outlet`.
          if (cur.childPattern && r.subRoutes) {
            const childEntry = r.subRoutes.find(
              (sr): sr is RouteEntry => "tile" in sr && sr.pattern === cur.childPattern,
            );
            if (childEntry) injectRouteOutlet(root, childEntry.tile());
          }
          return root;
        }
      }
      // 404 fallback tile
      for (const r of app.routes) {
        if (r.pattern === "/404" && "tile" in r) return r.tile();
      }
    }
    return app.root ? app.root() : { kind: "text", text: "(no root)" };
  }

  /**
   * Walk the parent tile tree and inject the matched child as the children of
   * the first `route-outlet` node we find (spec/routing.md §3.6). The render
   * pass in tiles-layout.ts then mounts the child via the normal renderer.
   * Spec leaves multi-outlet behavior unspecified, so we treat the first one
   * as the active slot and leave any additional outlets empty.
   *
   * NOTE: this mutates `node` in place, so each call site MUST hand in a fresh
   * tree — i.e. tile factories returned by codegen must produce a new object
   * literal per invocation (they do today). A cached / shared tree would be
   * corrupted across navigations.
   */
  function injectRouteOutlet(node: TileNode, child: TileNode): boolean {
    if (!node || typeof node !== "object") return false;
    if ((node as { kind?: string }).kind === "route-outlet") {
      (node as { children: TileNode[] }).children = [child];
      return true;
    }
    const children = (node as { children?: TileNode[] }).children;
    if (Array.isArray(children)) {
      for (const c of children) {
        if (injectRouteOutlet(c, child)) return true;
      }
    }
    return false;
  }

  // Re-entrancy guard so a panic inside the `app.error` handler itself does not
  // recurse — it is just logged.
  let inPanicHandler = false;

  /**
   * Handle a caught live panic per docs/spec/lifecycle.md §7.2: the dispatch episode
   * is already rolled back (the caller never applied the failed result), so we
   * surface it (console.error → smoke/scenario see it) and fire the `app.error`
   * reducer(s) with `$event = PanicInfo`, exactly as §7.2.3 specifies.
   */
  function handleLivePanic(location: string, e: unknown): void {
    reportPanic(location, e);
    episode?.recordPanic(panicInfo(e).message, location);
    if (inPanicHandler) return;
    const handlers = app.reducers.filter(
      (h) => h.event.kind === "lifecycle" && h.event.name === "app.error",
    );
    if (handlers.length === 0) return;
    const info = { message: panicInfo(e).message, location };
    inPanicHandler = true;
    try {
      for (const h of handlers) applyReducer(h, { $event: info });
    } finally {
      inPanicHandler = false;
    }
  }

  /**
   * §10.5 trigger kind for an auto-opened episode. The runtime auto-opens at
   * the outermost `applyReducer` so every dispatch entry point (DOM event,
   * lifecycle fire, timer tick, route.enter, init effect, ...) gets a trigger
   * without each call site having to wrap itself.
   */
  function triggerOfReducer(r: ReducerSpec): { kind: string; target: string } {
    if (r.event.kind === "ui") {
      return { kind: `ui.${r.event.ev}`, target: r.selector?.tile ?? r.name };
    }
    if (r.event.kind === "effect") {
      return { kind: `effect.${r.event.outcome}`, target: r.event.effect };
    }
    if (r.event.kind === "timer") {
      return { kind: "timer", target: r.event.name ?? "anonymous" };
    }
    return { kind: "lifecycle", target: r.event.name };
  }

  function applyReducer(r: ReducerSpec, payload: Record<string, unknown>): void {
    if (disposed) return;
    // Auto-open an episode at the outermost reducer dispatch. Nested calls
    // (e.g. effect-result → .ok reducer → emits → ...) join the existing one
    // so the whole causal chain stays in a single Episode per §10.5.1.
    const opened = episode && !episode.hasOpenEpisode();
    if (opened) {
      const t = triggerOfReducer(r);
      episode.beginTrigger({ kind: t.kind, target: t.target, payload });
    }
    let result: ReturnType<ReducerSpec["apply"]>;
    try {
      result = r.apply(slotValues, payload);
    } catch (e) {
      // A panic (or any throw) inside a reducer is caught here so it does not
      // escape the DOM event handler. The dispatch episode is rolled back —
      // `apply` returns the new slots and we only write them on success, so a
      // throw applies NO partial state. The app stays interactive (a later
      // dispatch still runs); the `app.error` reducer (if any) is fired with
      // PanicInfo. The reducer-test harness catches panics separately (#24).
      handleLivePanic(`reducer "${r.name}"`, e);
      if (opened) episode?.endTrigger();
      return;
    }
    // Compute slot diffs (excluding `volatile` slots per language.md §175):
    // capture each touched slot's value BEFORE we overwrite it so the episode
    // step records the live transition, not just the destination.
    const diffs: SlotDiff[] = [];
    const dirty: string[] = [];
    for (const [k, v] of Object.entries(result.slots)) {
      const meta = app.slots[k];
      if (meta?.refine && !meta.refine(v)) continue;
      const before = slotValues[k];
      slotValues[k] = v;
      if (!meta?.volatile) {
        diffs.push({ name: k, before, after: v });
        dirty.push(k);
      }
    }
    episode?.recordReducer(
      r.name,
      diffs,
      result.emits.map((e) => e.effect),
    );
    for (const emit of result.emits) {
      if (observeLeaveConfirm && emit.effect === "confirm") leaveAskedConfirm = true;
      dispatcher.dispatch(emit);
    }
    for (const name of result.stopTimers ?? []) {
      const h = namedTimers.get(name);
      if (h !== undefined) {
        clearInterval(h);
        namedTimers.delete(name);
      }
    }
    render();
    if (dirty.length > 0) episode?.recordSignalUpdate(dirty);
    if (opened) episode?.endTrigger();
  }

  function handleEffectResult(
    effect: string,
    outcome: "ok" | "err",
    value: unknown,
    key: unknown,
    token = "",
  ): void {
    // §10.5: the matching effect-end step lands on the SAME Episode the
    // effect-start was logged into (looked up by `token`). The returned exit
    // pops that Episode off the focus stack and commits if no more inflight
    // effects remain — so the .ok / .err reducer chain that runs in between
    // attaches to the same Episode.
    const exitScope = episode?.recordEffectEnd(token, effect, outcome, value);
    let matched = 0;
    try {
      for (const r of app.reducers) {
        if (r.event.kind === "effect" && r.event.effect === effect && r.event.outcome === outcome) {
          applyReducer(r, { $1: value, $2: key });
          matched++;
        }
      }
      // Status-coded routing for HTTP-shaped err payloads (#78, spec §6.3.2):
      // an err whose value carries a 401/403/5xx is forwarded to the global
      // `app.http.on-*` reducer — independent of whether a per-effect `.err`
      // reducer also matched.
      if (outcome === "err" && app.http) {
        const status = readStatus(value);
        if (status !== null) {
          const name =
            status === 401
              ? app.http.on401
              : status === 403
                ? app.http.on403
                : status >= 500
                  ? app.http.on5xx
                  : undefined;
          if (name) {
            const r = app.reducers.find((r) => r.name === name);
            if (r) {
              applyReducer(r, { $1: value, $2: key });
              matched++;
            }
          }
        }
      }
      // No-silent-failure contract (#37): an `err` result that no `.err` reducer
      // consumes is a dropped error — surfaced (never swallowed) exactly like a
      // live panic. An app that means to ignore an error opts in with an `.err`
      // reducer (even an empty one).
      if (outcome === "err" && matched === 0) reportUnhandledEffectError(effect, value);
    } finally {
      exitScope?.();
    }
  }

  function updateRoute(newPath: string, replace: boolean): void {
    if (!router) return;
    lastNavSource = replace ? "replace" : "push";
    if (replace) router.replace(newPath);
    else router.push(newPath);
    syncRouteFromLocation();
  }

  function syncRouteFromLocation(): void {
    if (!routing || !router) return;
    // A pending leave guard is already gating the previous transition; ignore
    // re-entrant syncs (e.g. a router.replace from the No path would re-call us).
    if (pendingLeave) return;
    // Resolve any static redirect for the current path BEFORE computing the
    // new route — keeps the URL bar in sync with what gets rendered and
    // covers both top-level and sub-route redirects.
    const redirectTo = routing.findRedirect(app.routes, router.read());
    if (redirectTo !== null) router.replace(redirectTo);
    const oldRoute = slotValues.route as ParsedRoute;
    const newRoute = routing.parseLocation(app.routes, router.read());
    // §3.9: save the OLD route's scroll position before any transition work, so
    // it is available when the user lands here again via back / forward.
    if (oldRoute && typeof window !== "undefined") {
      const sx = typeof window.scrollX === "number" ? window.scrollX : 0;
      const sy = typeof window.scrollY === "number" ? window.scrollY : 0;
      scrollSaved.set(oldRoute.path, { x: sx, y: sy });
    }
    // Fire route.leave reducers BEFORE committing the new route so a guard can
    // gate the transition. We observe whether any leave reducer emitted
    // `confirm` — if so, we hold off updating slotValues.route and firing
    // route.enter until the confirm modal resolves via `_resolveLeave`.
    if (oldRoute && oldRoute.pattern !== newRoute.pattern) {
      observeLeaveConfirm = true;
      leaveAskedConfirm = false;
      try {
        for (const r of app.reducers) {
          if (
            r.event.kind === "lifecycle" &&
            r.event.name === `route.leave(${JSON.stringify(oldRoute.pattern)})`
          ) {
            applyReducer(r, { $route: oldRoute });
          }
        }
      } finally {
        observeLeaveConfirm = false;
      }
      if (leaveAskedConfirm) {
        pendingLeave = { oldRoute, newRoute };
        // The OLD route's tile remains visible underneath the modal; render so
        // any slot writes the leave reducer made (or the modal itself) flush.
        render();
        return;
      }
    }
    slotValues.route = newRoute;
    for (const r of app.reducers) {
      if (
        r.event.kind === "lifecycle" &&
        r.event.name === `route.enter(${JSON.stringify(newRoute.pattern)})`
      ) {
        applyReducer(r, { $route: newRoute });
      }
    }
    applyScrollFor(newRoute);
    render();
  }

  function findRouteEntry(route: ParsedRoute): RouteEntry | undefined {
    if (!app.routes) return undefined;
    for (const r of app.routes) {
      if ("redirectTo" in r) continue;
      if (r.pattern !== route.pattern) continue;
      if (route.childPattern && r.subRoutes) {
        for (const sr of r.subRoutes) {
          if ("redirectTo" in sr) continue;
          if (sr.pattern === route.childPattern) return sr;
        }
      }
      return r;
    }
    return undefined;
  }

  function applyScrollFor(route: ParsedRoute): void {
    if (typeof window === "undefined" || typeof window.scrollTo !== "function") return;
    const entry = findRouteEntry(route);
    if (entry?.scrollRestoration === false) return;
    if (lastNavSource === "pop") {
      // pop with no saved entry (e.g. first-visit hash deep-link or a path that
      // bypassed our save hook) — fall through to (0,0) instead of leaving the
      // viewport where the last route left it. Because we took manual control
      // of `history.scrollRestoration`, the browser default won't kick in here.
      const saved = scrollSaved.get(route.path);
      if (saved) window.scrollTo(saved.x, saved.y);
      else window.scrollTo(0, 0);
    } else {
      window.scrollTo(0, 0);
    }
  }

  function resolveLeave(outcome: "yes" | "no"): void {
    const p = pendingLeave;
    if (!p) return;
    pendingLeave = null;
    if (outcome === "yes") {
      slotValues.route = p.newRoute;
      for (const r of app.reducers) {
        if (
          r.event.kind === "lifecycle" &&
          r.event.name === `route.enter(${JSON.stringify(p.newRoute.pattern)})`
        ) {
          applyReducer(r, { $route: p.newRoute });
        }
      }
      applyScrollFor(p.newRoute);
      render();
    } else {
      // Revert: rewrite the URL back to the old path without re-firing the
      // leave guard (pendingLeave is already null, but the recursion guard at
      // the top of syncRouteFromLocation also short-circuits if this somehow
      // re-enters before the new state is observed).
      if (router) router.replace(p.oldRoute.path);
      slotValues.route = p.oldRoute;
      render();
    }
  }

  // Register the built-in effects this mount carries: `log` is core (a few
  // lines, every tier relies on it), navigation comes with the routing module,
  // and anything else (e.g. `toast`) arrives as an explicit installer.
  installLogEffect(app);
  const nav: NavContext = { navigate: updateRoute, back: () => router?.back() };
  routing?.installNavEffects(app, nav);
  for (const installer of options.builtins ?? []) installer(app, nav);

  // Apply theme defaults to <body> and inject base CSS for tile primitives.
  // Reset the cache so subsequent mounts (e.g. across parallel tests) always
  // re-bind the global `__kumikiApp` reference, even if the theme name matches.
  lastAppliedThemeName = null;
  applyThemeDefaults(app);
  lastAppliedThemeName =
    (app.live?.[app.themeName ?? ""] as string | undefined) ?? app.themeName ?? null;

  // Initial route sync — but first resolve any static redirect (top-level
  // `->>` or one declared inside a matched parent's sub-routes per §3.6).
  if (routing && router && app.routes && app.routes.length > 0) {
    // §3.9: take manual control so we can restore positions explicitly on pop
    // and reset to top on push, without the browser's auto-restore racing us.
    if (typeof history !== "undefined" && "scrollRestoration" in history) {
      try {
        (history as History & { scrollRestoration: ScrollRestoration }).scrollRestoration =
          "manual";
      } catch {
        // Some embedded contexts (sandboxed iframes) forbid writes; ignore.
      }
    }
    const redirectTo = routing.findRedirect(app.routes, router.read());
    if (redirectTo !== null) router.replace(redirectTo);
    slotValues.route = routing.parseLocation(app.routes, router.read());
    routerUnsub = router.subscribe(() => {
      lastNavSource = "pop";
      syncRouteFromLocation();
    });
  }

  app._rerender = render;
  (
    app as AppShape & { _dispatch?: (name: string, el: Record<string, unknown>) => void }
  )._dispatch = (reducerName: string, el: Record<string, unknown>) => {
    const r = app.reducers.find((x) => x.name === reducerName);
    if (!r) return;
    applyReducer(r, { $el: el, $event: el });
  };
  // §3.8 prefetch — same argument binding as route.enter so the prefetch and
  // the actual navigation share one reducer body. `prefetch-args` lowers to
  // `$route.params`; `path` / `pattern` carry the link target verbatim (the
  // matched pattern is unknowable at the link site, but `params` is what
  // reducer bodies read).
  (
    app as AppShape & {
      _prefetch?: (name: string, args: Record<string, string>, to: string) => void;
    }
  )._prefetch = (reducerName: string, args: Record<string, string>, to: string) => {
    const r = app.reducers.find((x) => x.name === reducerName);
    if (!r) return;
    const syntheticRoute: ParsedRoute = {
      path: to,
      pattern: to,
      params: args,
      query: {},
      hash: null,
    };
    applyReducer(r, { $route: syntheticRoute });
  };
  (app as AppShape & { _setSlot?: (name: string, value: unknown) => void })._setSlot = (
    name: string,
    value: unknown,
  ) => {
    const meta = app.slots[name];
    if (meta?.refine && !meta.refine(value)) return;
    slotValues[name] = value;
    render();
  };
  (app as AppShape & { _navigate?: (path: string, replace?: boolean) => void })._navigate = (
    path: string,
    replace?: boolean,
  ) => {
    updateRoute(path, !!replace);
  };
  (app as AppShape & { _resolveLeave?: (outcome: "yes" | "no") => void })._resolveLeave =
    resolveLeave;

  // Fire app.start lifecycle + init effects.
  for (const emit of app.init) dispatcher.dispatch(emit);
  for (const r of app.reducers) {
    if (r.event.kind === "lifecycle" && r.event.name === "app.start") {
      applyReducer(r, {});
    }
  }
  // Wire host-level lifecycle events (lifecycle.md §7.1.2–7.1.4): beforeunload
  // → app.stop, visibilitychange → app.visible / app.hidden, online / offline
  // → app.online / app.offline. Listeners are registered against the host
  // window once we know a reducer subscribes to the corresponding event; on
  // dispose they are removed (the dispose path tracks them via
  // `lifecycleUnsubs` so multiple Kumiki mounts on the same page stay
  // isolated). Guarded for non-DOM hosts (importing this module from Node).
  const lifecycleUnsubs = installLifecycleListeners(app, applyReducer);
  // Start timer reducers — each fires its reducer every intervalMs. A named
  // timer is registered so `stop-timer(name)` can clear it; anonymous timers
  // only stop on dispose.
  for (const r of app.reducers) {
    if (r.event.kind === "timer") {
      const handle = setInterval(() => applyReducer(r, {}), r.event.intervalMs);
      if (r.event.name !== undefined) namedTimers.set(r.event.name, handle);
      else anonTimers.push(handle);
    }
  }
  // Fire initial route.enter reducer for current pattern.
  if (app.routes && app.routes.length > 0) {
    const cur = slotValues.route as ParsedRoute;
    for (const r of app.reducers) {
      if (
        r.event.kind === "lifecycle" &&
        r.event.name === `route.enter(${JSON.stringify(cur.pattern)})`
      ) {
        applyReducer(r, { $route: cur });
      }
    }
  }

  render();
  return {
    dispose: () => {
      disposed = true;
      for (const h of anonTimers) clearInterval(h);
      for (const h of namedTimers.values()) clearInterval(h);
      namedTimers.clear();
      routerUnsub?.();
      for (const unsub of lifecycleUnsubs) unsub();
      target.replaceChildren();
      dispatcher.dispose();
    },
    /** Recently-recorded episodes for this mount (§10.7 `app.episodes`). */
    episodes: () => episode?.list() ?? [],
  };
}

/**
 * Register host-level lifecycle listeners (lifecycle.md §7.1.2–7.1.4):
 * beforeunload (app.stop), visibilitychange (app.visible / app.hidden), and
 * the network online / offline events. Listeners are installed only for the
 * events the app actually subscribes to — a routeless / lifecycle-less app
 * pays nothing. Returns the unsub callbacks the mount's dispose path drains.
 *
 * `disposed`-guarded indirectly: every listener routes through `applyReducer`,
 * which short-circuits when the mount has been torn down.
 */
function installLifecycleListeners(
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

function makeCapabilityRegistry(
  allowed: string[],
  providers?: Record<string, CapabilityProvider>,
): CapabilityRegistry {
  const ok = new Set(allowed);
  return {
    has: (c) => ok.has(c),
    provider: (c) => providers?.[c],
  };
}

/**
 * Reflect `app.meta` into the host document at mount (§4.10). Each field is
 * applied independently so a partial declaration only touches the heads it
 * names; the favicon is upserted via a `<link rel="icon">` element, the meta
 * tags via name/property keys. Runs against the live `document` — guarded for
 * non-DOM hosts (tests without a global document) so importing this module
 * stays side-effect-free.
 */
function applyAppMeta(app: AppShape): void {
  const meta = app.meta;
  if (!meta) return;
  if (typeof document === "undefined") return;
  if (meta.title !== undefined) document.title = meta.title;
  if (meta.description !== undefined) upsertMetaTag("name", "description", meta.description);
  if (meta.ogImage !== undefined) upsertMetaTag("property", "og:image", meta.ogImage);
  if (meta.favicon !== undefined) upsertFavicon(meta.favicon);
}

function upsertMetaTag(attr: "name" | "property", key: string, content: string): void {
  const head = document.head;
  if (!head) return;
  let el = head.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertFavicon(href: string): void {
  const head = document.head;
  if (!head) return;
  let el = head.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "icon");
    head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/**
 * Build the provider map for the capability registry, defaulting
 * `analytics.send` to the implementation chosen by `app.analytics` when the
 * host did not register one (the spec's "hook injected at app startup",
 * §10.4.6). When `appId` is configured it is merged into every payload so
 * downstream sinks can route by app without each caller threading the id.
 */
function withAnalyticsDefault(
  app: AppShape,
  hostProviders?: Record<string, CapabilityProvider>,
): Record<string, CapabilityProvider> | undefined {
  const cfg = app.analytics;
  if (!cfg) return hostProviders;
  if (hostProviders?.["analytics.send"]) return hostProviders;
  const tag = (input: unknown): unknown => {
    if (cfg.appId === undefined) return input;
    if (input && typeof input === "object" && !Array.isArray(input)) {
      return { ...(input as Record<string, unknown>), appId: cfg.appId };
    }
    return { appId: cfg.appId, payload: input };
  };
  const provider: CapabilityProvider =
    cfg.provider === "console"
      ? (input) => {
          console.log("[kumiki:analytics]", tag(input));
          return { kind: "ok", value: null };
        }
      : () => ({ kind: "ok", value: null });
  return { ...(hostProviders ?? {}), "analytics.send": provider };
}

type Dispatcher = {
  dispatch(emit: EmitSpec): void;
  dispose(): void;
};

function makeEffectDispatcher(
  app: AppShape,
  caps: CapabilityRegistry,
  onResult: (
    effect: string,
    outcome: "ok" | "err",
    value: unknown,
    key: unknown,
    token: string,
  ) => void,
  onLaunch?: (effect: string, input: unknown) => string,
  onCancel?: (targetId: string) => void,
): Dispatcher {
  type RunState = {
    inflight: Map<string, AbortController>;
    timers: Map<string, ReturnType<typeof setTimeout>>;
    onceSeen: Map<string, Set<string>>;
  };
  const state: RunState = { inflight: new Map(), timers: new Map(), onceSeen: new Map() };

  const launch = async (eff: EffectSpec, input: unknown, key: string): Promise<void> => {
    // Empty cap = standard presentation effect (e.g. scroll-to); no permission gate.
    if (eff.cap !== "" && !caps.has(eff.cap)) {
      console.warn(`Capability "${eff.cap}" not declared in app.caps`);
      return;
    }
    // Episode logger seam (§10.5): the moment the dispatcher commits to
    // actually invoking the effect — policy filtering (debounce / once /
    // queue) has already passed. Token threads through to onResult so the
    // matching effect-end lands on the same Episode.
    const token = onLaunch?.(eff.name, input) ?? "";
    const id = `${eff.name}:${key}`;
    // Every in-flight effect gets its own AbortController so `http.cancel`
    // (spec http.md §6.4) — and the existing `policy=latest`/`latest-per-key`
    // paths — can abort the actual `fetch`, not just delete a map entry. The
    // signal threads through `runWithRetry` → `eff.invoke` → `httpFetch`.
    const ctl = new AbortController();
    state.inflight.set(id, ctl);
    try {
      const res = await runWithRetry(eff, input, caps, ctl.signal);
      onResult(eff.name, res.kind, res.value, input, token);
    } catch (e) {
      onResult(eff.name, "err", { message: String(e) }, input, token);
    } finally {
      if (state.inflight.get(id) === ctl) state.inflight.delete(id);
    }
  };

  return {
    dispatch(emit: EmitSpec): void {
      const eff = app.effects[emit.effect];
      if (!eff) return;
      // §6.4: `cap=http.cancel` is a meta-effect — its `input` IS an
      // `EffectId` (the `${name}:${key}` string produced by codegen and the
      // launch path). Abort the matching in-flight controller AND clear any
      // pending debounce/throttle timer, then surface the cancel intent to
      // the episode log. Unknown / already-completed ids are a silent no-op
      // (cancellation is an idempotent intent, not a contract violation —
      // user code shouldn't have to guard a rapidly-clicked Cancel button).
      if (eff.cap === "http.cancel") {
        const target = String(emit.args[0] ?? "");
        if (target.length > 0) {
          const ic = state.inflight.get(target);
          if (ic) {
            ic.abort();
            state.inflight.delete(target);
          }
          const t = state.timers.get(target);
          if (t !== undefined) {
            clearTimeout(t);
            state.timers.delete(target);
          }
          onCancel?.(target);
        }
        return;
      }
      const input = emit.args[0];
      const policy = eff.policy ?? { kind: "default" as const };
      const keyOf = (input: unknown): string => {
        if (policy.kind === "latest-per-key") return policy.keyOf(input);
        return "_";
      };
      const key = keyOf(input);
      const id = `${eff.name}:${key}`;
      if (policy.kind === "once") {
        const seen = state.onceSeen.get(eff.name) ?? new Set<string>();
        const k = JSON.stringify(input ?? null);
        if (seen.has(k)) return;
        seen.add(k);
        state.onceSeen.set(eff.name, seen);
        void launch(eff, input, key);
        return;
      }
      if (policy.kind === "debounce") {
        const t = state.timers.get(id);
        if (t) clearTimeout(t);
        state.timers.set(
          id,
          setTimeout(() => {
            state.timers.delete(id);
            void launch(eff, input, key);
          }, policy.ms),
        );
        return;
      }
      if (policy.kind === "throttle") {
        if (state.timers.has(id)) return;
        state.timers.set(
          id,
          setTimeout(() => state.timers.delete(id), policy.ms),
        );
        void launch(eff, input, key);
        return;
      }
      if (policy.kind === "latest" || policy.kind === "latest-per-key") {
        // Abort the previous in-flight invocation under the same id, then
        // launch a fresh one. `launch` itself installs the new controller —
        // the dispatcher only has to evict the old.
        const ic = state.inflight.get(id);
        if (ic) {
          ic.abort();
          state.inflight.delete(id);
        }
        void launch(eff, input, key);
        return;
      }
      void launch(eff, input, key);
    },
    dispose(): void {
      for (const t of state.timers.values()) clearTimeout(t);
      state.timers.clear();
      for (const c of state.inflight.values()) c.abort();
      state.inflight.clear();
    },
  };
}

/**
 * Wrap a built-in effect implementation so a host provider registered for its
 * capability takes precedence (the ecosystem seam — lets a host override
 * navigation/toast/log). Shared by the feature-module installers.
 */
export function overridableInvoke(
  cap: string,
  fn: (input: unknown, signal?: AbortSignal) => Promise<EffectResult>,
): EffectSpec["invoke"] {
  return async (input, caps, signal) => {
    const p = caps.provider(cap);
    if (p) return p(input, caps, signal);
    return fn(input, signal);
  };
}

function installLogEffect(app: AppShape): void {
  app.effects.log = {
    name: "log",
    cap: "log.write",
    invoke: overridableInvoke("log.write", async (input) => {
      console.log("[kumiki]", input);
      return { kind: "ok", value: null };
    }),
  };
}

// ----- DOM rendering -----

/** Record the child-index chain from `root` down to `el`, for focus restore. */
function domPath(el: Element, root: Element): number[] {
  const path: number[] = [];
  let cur: Element | null = el;
  while (cur && cur !== root) {
    const parent: Element | null = cur.parentElement;
    if (!parent) break;
    path.unshift(Array.prototype.indexOf.call(parent.children, cur));
    cur = parent;
  }
  return path;
}

/** Re-walk a child-index chain produced by domPath to find the element. */
function elementAtPath(path: number[], root: Element): Element | null {
  let cur: Element | null = root;
  for (const idx of path) {
    if (!cur) return null;
    cur = cur.children[idx] ?? null;
  }
  return cur;
}

/** Immutably set a (possibly nested) field path on a record — used by `bind=`. */
export function _setPathHelper(obj: unknown, path: string[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const cur = (obj && typeof obj === "object" ? obj : {}) as Record<string, unknown>;
  return { ...cur, [head!]: _setPathHelper(cur[head!], rest, value) };
}

/** Message + optional source location for a caught throw (panic or otherwise). */
function panicInfo(e: unknown): { message: string; location: string | undefined } {
  if (isPanic(e)) return { message: e.message, location: e.location };
  if (e instanceof Error) return { message: e.message, location: undefined };
  return { message: String(e), location: undefined };
}

/**
 * Surface a caught live panic so the verification tiers still see it: smoke()
 * and runScenario() both patch console.error into their issue/error buffers, so
 * a controlled panic is reported as a failure rather than silently swallowed.
 */
function reportPanic(where: string, e: unknown): void {
  const { message } = panicInfo(e);
  console.error(`[kumiki] ${isPanic(e) ? "panic" : "error"} in ${where}: ${message}`);
}

/**
 * Surface an effect `err` result that no `.err` reducer consumes (#37). A failed
 * capability must never fail silently — the storage-unavailable case (sandbox /
 * private mode) otherwise looks like the app does nothing. Reported via
 * console.error so the verification tiers (smoke / runScenario, which patch
 * console.error) flag it. Production noise
 * is the app's own choice: wire an `.err` reducer to handle (or deliberately
 * ignore) the error.
 */
/**
 * Walk a rendered TileNode tree and collect the names of every user-defined
 * tile boundary in it (lifecycle.md §7.1.6). Codegen marks each user-tile call
 * site by attaching `_tile: "Name"` to the produced node's props via `_named`,
 * so this walk is the inverse of that marker. Builtin tiles (button, page, …)
 * carry no marker — `tile.mount` only fires for *user-defined* tiles, matching
 * the spec example `tile.mount(SettingsPage)`.
 */
function collectMountedTiles(root: TileNode): Set<string> {
  const out = new Set<string>();
  const visit = (n: TileNode | null | undefined): void => {
    if (!n || typeof n !== "object") return;
    const props = (n as { props?: Record<string, unknown> }).props;
    const tileName = props?._tile;
    if (typeof tileName === "string") out.add(tileName);
    const children = (n as { children?: TileNode[] }).children;
    if (Array.isArray(children)) for (const c of children) visit(c);
  };
  visit(root);
  return out;
}

/** Pull `status` off an HttpError-shaped err value; returns null otherwise. */
function readStatus(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const s = (value as { status?: unknown }).status;
  return typeof s === "number" ? s : null;
}

/**
 * Run an effect with its retry policy (#83). Spec http.md §6.5: only 5xx
 * responses and connection errors (status 0) retry — 4xx and ok results are
 * final. `n` in the policy is the **maximum total attempts**, matching the
 * docs' "Up to N times" wording.
 */
async function runWithRetry(
  eff: EffectSpec,
  input: unknown,
  caps: CapabilityRegistry,
  signal?: AbortSignal,
): Promise<EffectResult> {
  const policy = eff.retry;
  if (!policy) return eff.invoke(input, caps, signal);
  let last: EffectResult = await eff.invoke(input, caps, signal);
  for (let attempt = 1; attempt < policy.n; attempt++) {
    if (last.kind !== "err") return last;
    // §6.4.1: abort short-circuits retries — re-issuing a cancelled request
    // would defeat the cancel intent.
    if (signal?.aborted) return last;
    const status = readStatus(last.value);
    const retriable = status === null || status === 0 || status >= 500;
    if (!retriable) return last;
    const delay = policy.kind === "linear" ? policy.ms : policy.ms * policy.factor ** (attempt - 1);
    await sleep(delay);
    last = await eff.invoke(input, caps, signal);
  }
  return last;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function reportUnhandledEffectError(effect: string, value: unknown): void {
  const message =
    value && typeof value === "object" && "message" in value
      ? String((value as { message: unknown }).message)
      : String(value);
  console.error(`[kumiki] effect "${effect}" returned an error with no .err reducer: ${message}`);
}

/** A minimal top-level fallback for a render panic with no enclosing boundary. */
function renderPanicFallback(e: unknown): HTMLElement {
  const { message, location } = panicInfo(e);
  const div = document.createElement("div");
  div.dataset.kumikiPanic = location ?? "";
  div.setAttribute("role", "alert");
  div.textContent = `Something went wrong: ${message}`;
  return div;
}

/** Build the recursion context that resolves tile kinds through `tiles`. */
function makeTileCtx(tiles: TileRenderers): TileCtx {
  const lookup = tiles as Record<
    string,
    ((node: TileNode, ctx: TileCtx) => HTMLElement) | undefined
  >;
  const ctx: TileCtx = {
    render(node: TileNode): HTMLElement {
      const renderer = lookup[node.kind];
      const el = renderer ? renderer(node, ctx) : renderMissingTile(node);
      // A `motion` prop applies to any tile uniformly (M5). The keyframes/classes
      // are injected once at mount by ensureMotionStyles.
      applyMotion(el, node.props);
      // ui.key / ui.hover handlers (§1.6.1) — codegen lifts these into
      // onKeyDown / onMouseEnter props. Wiring them once on the universal
      // render output keeps every tile uniform (no per-renderer plumbing).
      applyKeyHoverHandlers(el, node.props);
      return el;
    },
  };
  return ctx;
}

function applyKeyHoverHandlers(el: HTMLElement, props?: TileProps): void {
  if (!props) return;
  if (props.onKeyDown) {
    const handler = props.onKeyDown;
    el.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      handler({ ...(props.el ?? {}), key: ke.key, code: ke.code });
    });
  }
  if (props.onMouseEnter) {
    const handler = props.onMouseEnter;
    el.addEventListener("mouseenter", () => {
      handler(props.el ?? {});
    });
  }
}

/**
 * Graceful degradation for a tile kind with no registered renderer: a compiled
 * app only ships the modules codegen saw it use, so reaching this means a
 * registry/codegen mismatch (or a hand-built app). Render the node's text (if
 * any) so content survives, and report via console.error so the smoke /
 * scenario tiers flag it.
 */
function renderMissingTile(node: TileNode): HTMLElement {
  console.error(`[kumiki] no renderer registered for tile kind "${node.kind}"`);
  const span = document.createElement("span");
  span.dataset.kumikiTile = node.kind;
  const text = (node as { text?: unknown }).text;
  if (text !== undefined) span.textContent = String(text);
  return span;
}

export function applyContainerProps(el: HTMLElement, props?: TileProps): void {
  if (!props) return;
  applyResponsive(el, props.gap, (v) => (el.style.gap = mapToken(String(v))));
  applyResponsive(el, props.align, (v) => (el.style.alignItems = mapAlign(String(v))));
  applyResponsive(el, props.justify, (v) => (el.style.justifyContent = mapJustify(String(v))));
  applyResponsive(el, props.pad, (v) => (el.style.padding = mapToken(String(v))));
  const mw = props["max-w"] ?? props.maxWidth;
  if (mw !== undefined) el.style.maxWidth = typeof mw === "number" ? `${mw}px` : String(mw);
  if (typeof props.bg === "string") el.style.background = mapColor(props.bg as string);
  if (typeof props.radius === "string") el.style.borderRadius = mapToken(props.radius as string);
  applyStyleBlock(el, props.style);
  applyStateStyles(el, props);
  applyTransition(el, props);
}

/**
 * Apply a `style: { ... }` block (spec/style.md §4.3) — each key is set as a CSS
 * property on the element verbatim. Keys are kebab-case CSS property names
 * (`background`, `padding`, `border-radius`, `box-shadow`, …) and their values
 * are resolved strings/numbers (`@token` references are already lowered by the
 * compiler). Numbers fall back to `px`, matching the spec's spacing convention.
 */
function applyStyleBlock(el: HTMLElement, raw: unknown): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    const v = typeof value === "number" ? `${value}px` : String(value);
    el.style.setProperty(key, v);
  }
}

/** Apply a value that may be a literal or a responsive `{base, sm, md, lg, xl}` map. */
function applyResponsive(_el: HTMLElement, raw: unknown, set: (v: unknown) => void): void {
  if (raw === undefined || raw === null) return;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    set(raw);
    return;
  }
  const m = raw as Record<string, unknown>;
  if (m.base !== undefined) set(m.base);
  // Pick the first matching breakpoint from largest to smallest.
  const order: Array<["xl" | "lg" | "md" | "sm", string]> = [
    ["xl", "(min-width: 1280px)"],
    ["lg", "(min-width: 1024px)"],
    ["md", "(min-width: 768px)"],
    ["sm", "(min-width: 640px)"],
  ];
  for (const [bp, q] of order) {
    if (m[bp] !== undefined && window.matchMedia(q).matches) {
      set(m[bp]);
      return;
    }
  }
}

export function ensureAnimationStyles(): void {
  // Keyed by presence in the active style root, so each root (document head or a
  // shadow root) gets its own copy of the animation keyframes.
  if (findStyleNode("kumiki-animations")) return;
  const css = `
@keyframes kumiki-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes kumiki-slide-up { from { transform: translateY(8px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
@keyframes kumiki-slide-down { from { transform: translateY(-8px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
@keyframes kumiki-spin { to { transform: rotate(360deg) } }
.kumiki-anim { animation-fill-mode: both; animation-timing-function: ease; animation-duration: 300ms; }
.kumiki-anim-fade { animation-name: kumiki-fade; }
.kumiki-anim-slide-up { animation-name: kumiki-slide-up; }
.kumiki-anim-slide-down { animation-name: kumiki-slide-down; }
.kumiki-anim-fast { animation-duration: 150ms; }
.kumiki-anim-normal { animation-duration: 300ms; }
.kumiki-anim-slow { animation-duration: 600ms; }
[data-kumiki-tile="spinner"] {
  display: inline-block; box-sizing: border-box;
  width: 1.25em; height: 1.25em; vertical-align: -0.25em;
  border: 0.15em solid currentColor; border-right-color: transparent;
  border-radius: 50%; opacity: 0.8;
  animation: kumiki-spin 750ms linear infinite;
}
@media (prefers-reduced-motion: reduce) { [data-kumiki-tile="spinner"] { animation: none } }
`;
  const style = document.createElement("style");
  style.id = "kumiki-animations";
  style.appendChild(document.createTextNode(css));
  appendStyleNode(style);
}

function applyTransition(el: HTMLElement, props?: TileProps): void {
  if (!props) return;
  const t = props.transition;
  if (typeof t !== "string") return;
  ensureAnimationStyles();
  el.classList.add("kumiki-anim", `kumiki-anim-${t}`);
  const d = props["transition-duration"];
  if (typeof d === "string") el.classList.add(`kumiki-anim-${d}`);
}

// ----- motion layer -----
// Reusable, scoped animations declared with `motion N = {...}` and referenced
// from a tile's `motion` prop. Codegen puts the parsed definitions on
// `App.motions`; the runtime turns each into a scoped `@keyframes` + class at
// mount, honoring `prefers-reduced-motion`.

/** Map a duration token (or a raw ms number) to a CSS duration. */
function motionDuration(d: unknown): string {
  if (typeof d === "number") return `${d}ms`;
  if (d === "fast") return "150ms";
  if (d === "slow") return "600ms";
  return "300ms"; // "normal" / default
}

/** Build the CSS declarations for one keyframe stop from the closed prop set. */
function motionStopCss(stop: unknown): string {
  const s = (stop ?? {}) as Record<string, unknown>;
  const decls: string[] = [];
  const transform: string[] = [];
  if (typeof s.opacity === "number") decls.push(`opacity: ${s.opacity}`);
  if (typeof s["translate-x"] === "number") transform.push(`translateX(${s["translate-x"]}px)`);
  if (typeof s["translate-y"] === "number") transform.push(`translateY(${s["translate-y"]}px)`);
  if (typeof s.scale === "number") transform.push(`scale(${s.scale})`);
  if (typeof s.rotate === "number") transform.push(`rotate(${s.rotate}deg)`);
  if (transform.length > 0) decls.push(`transform: ${transform.join(" ")}`);
  return decls.join("; ");
}

/** Build the `@keyframes` + class CSS for one motion definition. */
function motionCss(name: string, spec: unknown): string {
  const s = (spec ?? {}) as Record<string, unknown>;
  const kf = (s.keyframes ?? {}) as Record<string, unknown>;
  const from = motionStopCss(kf.from);
  const to = motionStopCss(kf.to);
  const easing = typeof s.easing === "string" ? s.easing : "ease";
  const iteration =
    s.iteration === "infinite"
      ? "infinite"
      : typeof s.iteration === "number"
        ? String(s.iteration)
        : "1";
  const direction = typeof s.direction === "string" ? s.direction : "normal";
  const cls = `kumiki-motion-${name}`;
  return [
    `@keyframes ${cls} { from { ${from} } to { ${to} } }`,
    `.${cls} { animation-name: ${cls}; animation-duration: ${motionDuration(s.duration)}; animation-timing-function: ${easing}; animation-iteration-count: ${iteration}; animation-direction: ${direction}; animation-fill-mode: both; }`,
  ].join("\n");
}

/** Inject the app's motion keyframes + a `prefers-reduced-motion` guard at mount. */
// Where Kumiki's <style> nodes go and which element carries body-level theme
// styles. Set per mount (see MountOptions.styleRoot / styleHost). Module-level
// because a compiled app is single-instance (its render closures bind to one
// module's live state), like the other style singletons below. Left null until
// mount so merely importing this module never touches `document` (keeps non-DOM
// imports — e.g. a Vite-compiled bundle loaded in Node — safe).
let currentStyleRoot: Document | ShadowRoot | null = null;
let currentStyleHost: HTMLElement | null = null;

/** Find a Kumiki style node by id within the active style root. */
function findStyleNode(id: string): HTMLStyleElement | null {
  const root = currentStyleRoot ?? document;
  return root.getElementById(id) as HTMLStyleElement | null;
}

/** Append a style node to the active style root (document head, or a shadow root). */
function appendStyleNode(style: HTMLStyleElement): void {
  const root = currentStyleRoot ?? document;
  // A Document has `.head`; a ShadowRoot does not. Duck-typing avoids referencing
  // the global `Document` constructor, which isn't defined in every DOM shim.
  const head = (root as Document).head;
  if (head) head.appendChild(style);
  else (root as ShadowRoot).appendChild(style);
}

/** The element that carries body-level theme styles (background/fg/font). */
function styleHostEl(): HTMLElement {
  return currentStyleHost ?? document.body;
}

function ensureMotionStyles(app: AppShape): void {
  const motions = app.motions ?? {};
  const rules = Object.entries(motions).map(([name, spec]) => motionCss(name, spec));
  // a11y (M5 AC5): disable motion AND the transitions when the user asks.
  rules.push(
    `@media (prefers-reduced-motion: reduce) { .kumiki-motion, .kumiki-anim { animation: none !important } }`,
  );
  let style = findStyleNode("kumiki-motions");
  if (!style) {
    style = document.createElement("style");
    style.id = "kumiki-motions";
    appendStyleNode(style);
  }
  style.textContent = rules.join("\n");
}

/** Add the generated motion class to a tile that carries a `motion: "Name"` prop. */
function applyMotion(el: HTMLElement, props?: TileProps): void {
  if (!props) return;
  const m = props.motion;
  if (typeof m !== "string") return;
  el.classList.add("kumiki-motion", `kumiki-motion-${m}`);
}

let stateStyleSeq = 0;
let stateStylesEl: HTMLStyleElement | null = null;

function applyStateStyles(el: HTMLElement, props: TileProps): void {
  for (const state of ["hover", "focus", "active", "disabled", "selected"] as const) {
    const sub = props[state];
    if (!sub || typeof sub !== "object" || Array.isArray(sub)) continue;
    const id = `s${++stateStyleSeq}`;
    el.dataset.kumikiState = el.dataset.kumikiState ? `${el.dataset.kumikiState} ${id}` : id;
    const decls = stateStyleDecls(sub as Record<string, unknown>);
    if (!stateStylesEl) {
      stateStylesEl = findStyleNode("kumiki-state-styles");
      if (!stateStylesEl) {
        stateStylesEl = document.createElement("style");
        stateStylesEl.id = "kumiki-state-styles";
        appendStyleNode(stateStylesEl);
      }
    }
    const selector =
      state === "hover"
        ? ":hover"
        : state === "focus"
          ? ":focus"
          : state === "active"
            ? ":active"
            : state === "disabled"
              ? ":disabled"
              : "[data-kumiki-selected]";
    stateStylesEl.appendChild(
      document.createTextNode(`[data-kumiki-state~="${id}"]${selector} { ${decls} }\n`),
    );
  }
}

function stateStyleDecls(sub: Record<string, unknown>): string {
  const decls: string[] = [];
  if (typeof sub.bg === "string") decls.push(`background: ${mapColor(sub.bg as string)}`);
  if (typeof sub.color === "string") decls.push(`color: ${mapColor(sub.color as string)}`);
  if (typeof sub.shadow === "string") decls.push(`box-shadow: ${sub.shadow}`);
  return decls.join("; ");
}

export function applyTextProps(el: HTMLElement, props?: TileProps): void {
  if (!props) return;
  if (props.strike) el.style.textDecoration = "line-through";
  if (typeof props.color === "string") el.style.color = mapColor(props.color as string);
  if (typeof props.size === "string") el.style.fontSize = mapSize(props.size as string);
  if (props.weight === "bold") el.style.fontWeight = "700";
  applyStyleBlock(el, props.style);
  applyStateStyles(el, props);
}

let lastAppliedThemeName: string | null = null;
function maybeReapplyTheme(app: AppShape): void {
  // Resolve the current theme name (could be slot-driven via `app.theme = slotName`).
  let name = app.themeName;
  if (
    name &&
    app.themes &&
    !(name in app.themes) &&
    app.live &&
    typeof app.live[name] === "string"
  ) {
    name = app.live[name] as string;
  }
  if (name === lastAppliedThemeName) return;
  lastAppliedThemeName = name ?? null;
  applyThemeDefaults(app);
}

function applyThemeDefaults(app: AppShape): void {
  // We need __kumikiApp set before currentTheme() works.
  (window as unknown as { __kumikiApp?: AppShape }).__kumikiApp = app;
  const theme = currentTheme();
  if (!theme) return;
  const colors = (theme.colors ?? {}) as Record<string, ThemeValue>;
  const typography = (theme.typography ?? {}) as Record<string, ThemeValue>;
  const sizes = (typography.size ?? {}) as Record<string, ThemeValue>;
  const host = styleHostEl();
  if (typeof colors.bg === "string") host.style.background = colors.bg;
  if (typeof colors.fg === "string") host.style.color = colors.fg;
  if (typeof typography.family === "string") host.style.fontFamily = typography.family as string;
  if (typeof sizes.md === "string") host.style.fontSize = sizes.md as string;
  if (typeof typography["line-height"] === "string")
    host.style.lineHeight = String(typography["line-height"]);
  // Inject CSS for primitives that need theme tokens.
  // Remove any prior injection first so re-renders (e.g. theme switching) don't
  // accumulate <style> nodes in the active style root.
  const prior = findStyleNode("kumiki-theme-base");
  if (prior) prior.remove();
  const css = document.createElement("style");
  css.id = "kumiki-theme-base";
  css.appendChild(
    document.createTextNode(`
[data-kumiki-tile="card"] {
  background: ${typeof colors.surface === "string" ? colors.surface : "#fff"};
  border: 1px solid ${typeof colors.border === "string" ? colors.border : "#e0e0e0"};
  box-shadow: ${themeShadow(theme, "sm") ?? "0 1px 2px rgba(0,0,0,0.08)"};
}
[data-kumiki-tile="button"] {
  background: ${typeof colors.surface === "string" ? colors.surface : "#fff"};
  color: ${typeof colors.fg === "string" ? colors.fg : "#1a1a1a"};
  border: 1px solid ${typeof colors.border === "string" ? colors.border : "#ddd"};
  padding: 6px 12px;
  cursor: pointer;
  border-radius: ${themeRadius(theme, "md") ?? "8px"};
}
[data-kumiki-tile="button"]:hover { filter: brightness(0.97); }
[data-kumiki-tile="input"], [data-kumiki-tile="textarea"] {
  font: inherit;
  padding: 6px 10px;
  border: 1px solid ${typeof colors.border === "string" ? colors.border : "#ddd"};
  border-radius: ${themeRadius(theme, "sm") ?? "4px"};
  background: ${typeof colors.surface === "string" ? colors.surface : "#fff"};
  color: ${typeof colors.fg === "string" ? colors.fg : "#1a1a1a"};
}
[data-kumiki-tile="input"]:focus, [data-kumiki-tile="textarea"]:focus {
  outline: 2px solid ${typeof colors.primary === "string" ? colors.primary : "#0070f3"};
  outline-offset: 1px;
}
[data-kumiki-tile="link"] {
  color: ${typeof colors.primary === "string" ? colors.primary : "#0070f3"};
  text-decoration: none;
}
[data-kumiki-tile="link"]:hover { text-decoration: underline; }
[data-kumiki-tile="heading"] {
  font-size: ${typeof sizes.xl === "string" ? sizes.xl : "28px"};
  font-weight: 700;
  margin: 0 0 8px;
}
[data-kumiki-tile="markdown"] p { margin: 0 0 12px; }
`),
  );
  appendStyleNode(css);
}

function themeShadow(theme: Theme, key: string): string | undefined {
  const shadow = theme.shadow;
  if (shadow && typeof shadow === "object" && !Array.isArray(shadow)) {
    const v = (shadow as Record<string, ThemeValue>)[key];
    if (typeof v === "string") return v;
  }
  return undefined;
}

function themeRadius(theme: Theme, key: string): string | undefined {
  const radius = theme.radius;
  if (radius && typeof radius === "object" && !Array.isArray(radius)) {
    const v = (radius as Record<string, ThemeValue>)[key];
    if (typeof v === "string") return v;
  }
  return undefined;
}

function resolveToken(group: string, name: string): string {
  const theme = currentTheme();
  if (theme) {
    const sec = theme[group];
    if (sec && typeof sec === "object" && !Array.isArray(sec) && name in sec) {
      const v = (sec as Record<string, ThemeValue>)[name];
      if (typeof v === "string") return v;
      if (typeof v === "number") return `${v}px`;
    }
  }
  return name;
}

export function currentTheme(): Theme | null {
  const win = window as unknown as { __kumikiApp?: AppShape };
  const app = win.__kumikiApp;
  if (!app?.themes) return null;
  let name = app.themeName;
  // If `app.theme = someSlot` was used in source, app.themeName holds the slot
  // NAME (e.g. "themeName"). Resolve through the live slot value so theme
  // switching at runtime takes effect.
  if (name && !(name in app.themes) && app.live && typeof app.live[name] === "string") {
    name = app.live[name] as string;
  }
  if (!name) name = Object.keys(app.themes)[0];
  if (!name) return null;
  return app.themes[name] ?? null;
}

function mapToken(t: string): string {
  // Use theme.spacing for known token names; fall back to literal.
  const theme = currentTheme();
  if (theme?.spacing && typeof theme.spacing === "object") {
    const sec = theme.spacing as Record<string, ThemeValue>;
    if (t in sec) {
      const v = sec[t];
      if (typeof v === "string") return v;
      if (typeof v === "number") return `${v}px`;
    }
  }
  switch (t) {
    case "xs":
      return "4px";
    case "sm":
      return "8px";
    case "md":
      return "16px";
    case "lg":
      return "24px";
    case "xl":
      return "40px";
    case "xxl":
      return "64px";
    default:
      return t;
  }
}
function mapAlign(a: string): string {
  switch (a) {
    case "start":
      return "flex-start";
    case "end":
      return "flex-end";
    case "center":
      return "center";
    case "stretch":
      return "stretch";
    default:
      return a;
  }
}
function mapJustify(a: string): string {
  switch (a) {
    case "start":
      return "flex-start";
    case "end":
      return "flex-end";
    case "center":
      return "center";
    case "between":
      return "space-between";
    case "around":
      return "space-around";
    default:
      return a;
  }
}
export function mapColor(c: string): string {
  const theme = currentTheme();
  if (theme?.colors && typeof theme.colors === "object") {
    const sec = theme.colors as Record<string, ThemeValue>;
    if (c in sec) {
      const v = sec[c];
      if (typeof v === "string") return v;
    }
  }
  switch (c) {
    case "muted":
      return "#888";
    case "danger":
      return "#c4222a";
    case "primary":
      return "#0070f3";
    case "fg":
      return "#1a1a1a";
    case "surface":
      return "#f7f7f7";
    default:
      return c;
  }
}
function mapSize(s: string): string {
  const theme = currentTheme();
  if (theme?.typography && typeof theme.typography === "object") {
    const tg = theme.typography as Record<string, ThemeValue>;
    const sz = tg.size;
    if (
      sz &&
      typeof sz === "object" &&
      !Array.isArray(sz) &&
      s in (sz as Record<string, ThemeValue>)
    ) {
      const v = (sz as Record<string, ThemeValue>)[s];
      if (typeof v === "string") return v;
      if (typeof v === "number") return `${v}px`;
    }
  }
  switch (s) {
    case "sm":
      return "14px";
    case "md":
      return "16px";
    case "lg":
      return "20px";
    case "xl":
      return "28px";
    case "xxl":
      return "40px";
    default:
      return s;
  }
}

/**
 * Resolve a theme token reference written as `@<group>.<seg>(.<seg>)*` in source
 * (spec/style.md §4.3). Walks the active theme's group/path; on miss, dispatches
 * to the group-specific `map*` helpers so the spec's built-in defaults (e.g.
 * `surface` → `#f7f7f7`) still apply when no theme defines the name.
 */
export function tokenRef(group: string, path: string[]): string {
  const theme = currentTheme();
  if (theme) {
    let node: ThemeValue | undefined = theme[group];
    for (const seg of path) {
      if (node && typeof node === "object" && !Array.isArray(node) && seg in node) {
        node = (node as Record<string, ThemeValue>)[seg];
      } else {
        node = undefined;
        break;
      }
    }
    if (typeof node === "string") return node;
    if (typeof node === "number") return `${node}px`;
  }
  // Group-specific fallback to the built-in defaults baked into the runtime.
  const last = path[path.length - 1] ?? "";
  if (group === "colors") return mapColor(last);
  if (group === "spacing") return mapToken(last);
  if (group === "radius") return mapToken(last);
  if (group === "shadow") return resolveToken("shadow", last);
  if (group === "typography" && path[0] === "size") return mapSize(last);
  return resolveToken(group, last);
}
