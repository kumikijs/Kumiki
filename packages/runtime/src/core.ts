// Kumiki runtime core — mount, reducer/effect dispatch, theming, and the tile
// render seam. This module is the root of the granular runtime (#71): every
// other runtime module may value-import ONLY from here (plus `stdlib.ts` for
// the effect modules), so `kumiki build` can ship `core.js` + just the feature
// modules a compiled app actually uses. The assembled full API (classic
// `mount` with every tile/effect/router wired in) lives in `index.ts`.

import type { Episode, EpisodeLogger, PanicCategory, PanicCauseLink, SlotDiff } from "./episode.ts";

export type { PanicCategory, PanicCauseLink } from "./episode.ts";

/**
 * SSR slot snapshot — the non-`volatile` slot values an SSR pass produces.
 * Hydration overlays this on `app.live` BEFORE wiring effect dispatchers or
 * firing `app.start`, so the very first render reflects the server's final
 * state without re-running the `app.init` effects (§10.6.1 keeps init "not
 * re-executed at hydration").
 */
export type SsrSnapshot = Record<string, unknown>;

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
  constructor(message: string, location?: string, options?: { cause?: unknown }) {
    // Forward `cause` to the native Error(message, options) so root-cause
    // information survives on the standard `.cause` field. Older callsites
    // that pass only (message, location?) keep working unchanged.
    super(message, options);
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

export type TileNode = (
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
  | { kind: "route-outlet"; children: TileNode[]; props?: TileProps }
  | {
      /**
       * Native `<details>` disclosure (§10 built-in tile catalog, #190).
       * `open` maps to the DOM property of the same name; toggling it via a
       * data-prop change hits the tile's patcher (element identity is
       * preserved so the browser keeps the disclosure's animation state and
       * any inner focus).
       */
      kind: "details";
      summary: string;
      children: TileNode[];
      open?: boolean;
      props?: TileProps;
    }
  | {
      /**
       * `contenteditable` text field (§10 built-in tile catalog, #190). Emits
       * a `<div contenteditable="true">`; `bind=` writes back the plain
       * `textContent` on every `input` event. The tile patcher preserves the
       * live caret by skipping the `textContent` overwrite when the DOM
       * already matches the new node's text (the common case during typing,
       * where the bind loop keeps slot and DOM in sync). An in-flight IME
       * composition is also skipped so the browser's candidate window is not
       * dismissed mid-glyph; the trailing `compositionend` picks up the
       * committed text via the normal `input` event.
       */
      kind: "editable";
      text: string;
      props?: TileProps;
      bind?: string;
      bindPath?: string[];
      id?: string;
    }
) & {
  /**
   * Stable per-instance identity for keyed reconcile. Optional and additive:
   * when every child at a given level carries a `key`, the runtime matches
   * children by key across renders (survives reorder / insert / remove
   * without rebuilding the parent subtree). When any child at that level is
   * missing a `key`, the reconciler falls back to structural identity
   * (position + `kind` + data-prop equality).
   */
  readonly key?: string;
};

export type TileProps = Record<string, unknown> & {
  onClick?: EventHandler;
  onSubmit?: EventHandler;
  onChange?: EventHandler;
  onInput?: EventHandler;
  onClose?: EventHandler;
  onKeyDown?: EventHandler;
  onMouseEnter?: EventHandler;
  onFocus?: EventHandler;
  onBlur?: EventHandler;
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

/**
 * Mutates an already-mounted DOM element to reflect a new `TileNode` of the
 * same kind, preserving element identity (and thus browser-internal state:
 * `<select>` open dropdown / selection, `<input>` focus / caret,
 * `<video>` playback position, `<details>` open, `contenteditable` caret and
 * IME composition). Called by the reconcile diff whenever `oldNode.kind ===
 * newNode.kind` and any own data prop differs; when no patcher is registered
 * for a kind, the reconcile falls back to a full subtree rebuild (which
 * discards internal state — hence #190). Container tile children are still
 * walked by the reconcile after `patch` returns; a container patcher's job
 * is to reconcile just this element's own attributes.
 */
export type TilePatcher<K extends TileNode["kind"] = TileNode["kind"]> = (
  el: HTMLElement,
  oldNode: TileNode & { kind: K },
  newNode: TileNode & { kind: K },
  ctx: TileCtx,
) => void;

/** A registry of tile patchers, keyed by `TileNode["kind"]`. */
export type TilePatchers = { [K in TileNode["kind"]]?: TilePatcher<K> };

/**
 * Controlled escape hatch a `TilePatcher` throws when it discovers the new
 * `TileNode` cannot be applied in place — for example a `list` whose
 * `ordered` flip changes the underlying tag between `<ul>` and `<ol>`. The
 * reconcile catches this specifically and falls back to a same-kind subtree
 * rebuild (`replaceWithFreshTile`) without recording it as a panic. Any
 * OTHER throw from a patcher is treated as a real fault and lands in the
 * outer `reconcileTree` bailout.
 */
export class PatchRequiresRebuild extends Error {
  readonly isPatchRequiresRebuild = true as const;
  constructor(reason: string) {
    super(`patcher declined in-place update: ${reason}`);
    this.name = "PatchRequiresRebuild";
  }
}

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
  /**
   * Tile patchers (#190). When present for a kind, the reconcile diff calls
   * `patch(el, oldNode, newNode, ctx)` to mutate the mounted element in place
   * rather than tearing down and rebuilding — preserving browser-internal
   * element state (`<select>` open / `<video>` playback / focus / caret /
   * `<details>` open / `contenteditable`) across a data-prop change. A kind
   * with no registered patcher continues to fall back to a full rebuild.
   */
  tilePatchers?: TilePatchers;
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
  /**
   * SSR slot snapshot to overlay on `app.live` before the first render
   * (docs/spec/runtime.md §10.6.2). Keyed by slot name; values come straight
   * from `renderToString().snapshot.slots`. `volatile` slots are already
   * absent on the server side, so the host can pass the snapshot through
   * verbatim — the runtime never re-imports volatile values here.
   */
  ssrSnapshot?: SsrSnapshot;
  /**
   * Bootstrap episode (`trigger.kind = "ssr.hydrate"`) produced by
   * `renderToString()`. When present, the runtime injects it into the
   * `episodeLogger` BEFORE firing `app.start`, so `app.episodes()[0]` is the
   * SSR-side causal chain that filled the snapshot (§10.5.1 + §10.6.2).
   */
  bootstrapEpisode?: Episode;
  /**
   * When true, the mount treats `app.live` as already-initialised by a server
   * render: the `app.init` effects are NOT re-dispatched and the bootstrap
   * episode replaces the local init causal chain. Lifecycle reducers
   * (`app.start`, `route.enter`) still fire as usual (§10.6.2 step 5).
   */
  hydrate?: boolean;
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
   * The renderer resolves `icons` off the app whose render pass is running
   * (see the multi-mount app registry above `mountCore`), so several apps
   * with different icon registries can share a document without cross-talk.
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

/**
 * Resolve the root TileNode for the current route (or the app's static root
 * when no routes are declared). Exported so SSR (`ssr.ts`) can pick the same
 * tree the live mount would render, without re-implementing the route /
 * sub-route matching logic.
 */
export function pickRootTile(app: AppShape, slotValues: Record<string, unknown>): TileNode {
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
 * Apply a reducer's returned slot map and compute the `slot-diffs` an episode
 * step needs (docs/spec/language.md §175 — `volatile` slots get the new value
 * but are excluded from diffs / dirty signal-update). Pure: it mutates the
 * `prev` record (the live `app.live`) in place but otherwise has no side
 * effects, so both `applyReducer` (mount) and the SSR pseudo-reducer pipeline
 * can share the exact same volatile/refine semantics.
 */
export function computeSlotDiffs(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  slotMetas: Record<string, SlotMeta>,
): { diffs: SlotDiff[]; dirty: string[] } {
  const diffs: SlotDiff[] = [];
  const dirty: string[] = [];
  for (const [k, v] of Object.entries(next)) {
    const meta = slotMetas[k];
    if (meta?.refine && !meta.refine(v)) continue;
    const before = prev[k];
    prev[k] = v;
    if (!meta?.volatile) {
      diffs.push({ name: k, before, after: v });
      dirty.push(k);
    }
  }
  return { diffs, dirty };
}

// ---------------------------------------------------------------------------
// Multi-mount app registry: answers "which app owns this element?" without a
// shared global. Each mount stamps its target with `data-kumiki-root` and
// registers itself in a WeakMap keyed by that element, so several Kumiki apps
// (Web Components, micro-frontends, Storybook previews) can share a page
// without cross-wiring. Event-time consumers (bind write-back, link nav,
// prefetch) resolve through `resolveApp(el)`; render-time consumers (theme
// tokens, icon lookup) run while the tree is still detached — `closest()`
// cannot work there — so every render pass is bracketed with
// `withRenderingApp` and they read `getRenderingApp()` instead.

const ROOT_ATTR = "data-kumiki-root";

/**
 * An app that has been through `mountCore`: the mount attaches the imperative
 * seams (`_dispatch` / `_setSlot` / `_navigate` / `_prefetch` / `_rerender`)
 * and initializes `live`, so registry consumers can rely on them without
 * per-call-site casts.
 */
export type MountedApp = AppShape & {
  _dispatch: (name: string, el: Record<string, unknown>) => void;
  _setSlot: (name: string, value: unknown) => void;
  _navigate: (path: string, replace?: boolean) => void;
  _prefetch: (name: string, args: Record<string, string>, to: string) => void;
  _rerender: () => void;
  /** Prefetch dedupe set (§3.8), lazily created on first link prefetch. */
  _prefetched?: Set<string>;
  live: Record<string, unknown>;
};

const appByRoot = new WeakMap<Element, MountedApp>();

/** Non-null only while a mount's synchronous render pass is running. */
let renderingApp: MountedApp | null = null;

// Registration happens at the top of `mountCore`, BEFORE the imperative seams
// are attached — safe because nothing can resolve through the registry until
// the first render attaches the tree, and by then the seams exist. That
// ordering is why the producer casts to `MountedApp` here instead of the
// consumers casting on every read.
function registerAppRoot(target: Element, app: AppShape): void {
  appByRoot.set(target, app as MountedApp);
  target.setAttribute(ROOT_ATTR, "");
}

/** No-op unless `app` is the current registrant, so disposing an older mount
 *  of the same target never unhooks a newer one. */
function unregisterAppRoot(target: Element, app: AppShape): void {
  if (appByRoot.get(target) !== app) return;
  appByRoot.delete(target);
  target.removeAttribute(ROOT_ATTR);
}

/**
 * Resolve the app owning `el` by walking up to the nearest registered mount
 * root, hopping shadow boundaries via the host element. Returns undefined for
 * elements outside any live mount (e.g. a stale listener firing after
 * dispose) — deliberately NOT the most-recently-mounted app, which would
 * reintroduce the last-write-wins cross-talk this registry exists to remove.
 * One exception: during a synchronous render pass, unresolvable elements fall
 * back to the app currently rendering (its tree may still be detached);
 * outside a render pass there is no fallback.
 */
export function resolveApp(el: Element | null | undefined): MountedApp | undefined {
  let node: Element | null = el ?? null;
  while (node) {
    const root = node.closest(`[${ROOT_ATTR}]`);
    if (root) {
      const app = appByRoot.get(root);
      if (app) return app;
      // Marker without a registration — a stale attribute (e.g. a cloned or
      // serialized subtree copies the attribute but never the WeakMap entry).
      // Keep climbing this tree so a live ancestor root is not shadowed.
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

/**
 * Bracket a render pass. Saved/restored (not just cleared) because a custom
 * element inside the tree can synchronously mount a nested Kumiki app while
 * the outer render is still on the stack.
 */
function withRenderingApp<T>(app: AppShape, fn: () => T): T {
  const prev = renderingApp;
  // Renders only run from mountCore, after the imperative seams are attached.
  renderingApp = app as MountedApp;
  try {
    return fn();
  } finally {
    renderingApp = prev;
  }
}

const warnedUnresolved = new WeakSet<Element>();

/**
 * Once-per-element diagnostic for event-time consumers whose `resolveApp`
 * came back empty: the event is dropped by design (no last-mount fallback),
 * but silently-dead controls are miserable to debug — and the smoke tier
 * watches console output, so this makes the drop observable there too.
 */
export function warnUnresolvedEvent(el: Element, what: string): void {
  if (warnedUnresolved.has(el)) return;
  warnedUnresolved.add(el);
  console.warn(`kumiki: ${what} fired on an element outside any mount root; ignored`, el);
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
  registerAppRoot(target, app);
  // SSR hydration overlay (§10.6.2 step 2): drop the server snapshot onto
  // `app.live` BEFORE wiring the route / effect dispatcher, so the first
  // render already reflects the SSR-final values. `volatile` slots are not in
  // the snapshot by construction (see `renderToString`), so this loop never
  // smuggles a volatile value across the hydration boundary.
  if (options.ssrSnapshot) {
    for (const [k, v] of Object.entries(options.ssrSnapshot)) {
      if (k in app.slots) app.live[k] = v;
    }
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

  // Tile-level keyed diff (#187). Each render pass builds a fresh mapping ctx
  // whose `render` populates a per-pass `TileNode → HTMLElement` map. The
  // reconcile step diffs the new tree against the previous pass's tree +
  // map, so unchanged tiles keep their live DOM node (and its focus / caret /
  // <select> state / event listeners) — only changed subtrees are rebuilt.
  const tiles = options.tiles ?? {};
  const tilePatchers = options.tilePatchers ?? {};
  const ctxWrap = { applyMotion, applyUiEventHandlers, renderMissingTile };
  let currentMap: TileElementMap = new WeakMap();

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
    episode ? (token, name) => episode.cancelPendingEffect(token, name) : undefined,
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
  // Previously rendered tile tree, kept as the "old" side of the next
  // reconcile. Cleared to null after a panic-fallback render so the following
  // pass restarts from a full mount rather than diffing against a discarded
  // tree.
  let currentTree: TileNode | null = null;
  // #189: identifiers the most recent reconcile pass freshly built. Consumed
  // by `applyReducer` when it fires the trailing `signal-update` step so
  // `binds-updated` lists the tiles/binds the diff actually patched. Empty
  // after a full-render / panic-fallback pass (those are not a diff).
  let lastRenderTouched: string[] = [];
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
    withRenderingApp(app, renderPass);
  };
  // The full render pass, bracketed by `withRenderingApp` so render-time app
  // resolution (theme tokens, icon lookup — the tree is still detached, so
  // `resolveApp` cannot walk it) lands on this mount's app.
  const renderPass = (): void => {
    // Focus / caret snapshot — kept as a fallback for panic / reconcile-
    // bailout paths that swap DOM wholesale via `target.replaceChild` (or
    // route-error retry). On the reconcile happy path (#187 keyed diff +
    // #190 per-kind patch), element identity is preserved and this restore
    // step degrades to a no-op — the browser cursor never left the still-
    // mounted control.
    //
    // Scope: INPUT / TEXTAREA / SELECT / contenteditable. These are the
    // focusable form controls Kumiki emits (input, textarea, select, editable
    // — the `details` disclosure receives focus on its `<summary>` and is
    // NOT included; refocusing summary after a full rebuild is out of scope
    // for this fallback and browser-native tab order handles the common
    // case). For SELECT the dropdown-open state is browser-owned and
    // unrecoverable through snapshot; only the focus / kbd-nav position is
    // restored. For contenteditable the caret position is not captured
    // either — the equivalent of `setSelectionRange` for a text-node offset
    // across an arbitrary DOM rebuild is out of scope for #190.
    type FocusSnap = {
      bind?: string | undefined;
      id?: string | undefined;
      path?: number[] | undefined;
      selStart: number | null;
      selEnd: number | null;
      /** True when the snapshot target is a form control with `.selectionStart`. */
      hasSelection: boolean;
    } | null;
    let snap: FocusSnap = null;
    const active = document.activeElement;
    const isSnapshottable = (el: Element): boolean =>
      el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" ||
      (el as HTMLElement).isContentEditable === true;
    if (active && isSnapshottable(active) && target.contains(active)) {
      const el = active as HTMLInputElement;
      const hasSelection = el.tagName === "INPUT" || el.tagName === "TEXTAREA";
      snap = {
        bind: el.dataset.kumikiBind ?? undefined,
        id: el.id || undefined,
        path: domPath(el, target),
        selStart: hasSelection ? el.selectionStart : null,
        selEnd: hasSelection ? el.selectionEnd : null,
        hasSelection,
      };
    }

    maybeReapplyTheme(app);
    // Per-pass mapping ctx: `tileCtx.render(n)` records `n → element` into
    // `newMap` (and recursively for its children). Reconcile also writes into
    // `newMap` when it decides to *reuse* an old element (bypassing render).
    // Either way, `newMap` becomes `currentMap` at the end of the pass so
    // next round can find each mounted node's live element in O(1).
    let newMap: TileElementMap = new WeakMap();
    let tileCtx = makeMappingTileCtx(tiles, newMap, ctxWrap);
    let dom: HTMLElement | null = null;
    let renderedTree: TileNode | null = null;
    let panicked = false;
    // Rebuild the tree from scratch (used by initial mount, panic fallback,
    // and reconcile-bailout paths). Rebinds the local `newMap` + `tileCtx`
    // so partially-populated entries from an aborted attempt are dropped.
    const fullRender = (tree: TileNode): HTMLElement => {
      newMap = new WeakMap();
      tileCtx = makeMappingTileCtx(tiles, newMap, ctxWrap);
      return tileCtx.render(tree);
    };
    // Reset for this pass. The reconcile branch overwrites with the diff's
    // touched set; every other branch (full-render, panic recovery) leaves it
    // empty — those paths intentionally do not carry per-tile attribution.
    lastRenderTouched = [];
    try {
      renderedTree = pickRootTile(app, slotValues);
      if (currentTree && currentRoot) {
        // Diff path: reuse unchanged tile DOM in place, rebuild only changed
        // subtrees. `reconcileTree` returns the (possibly new) root — it can
        // differ from `currentRoot` if the root tile itself was rebuilt.
        try {
          const rec = reconcileTree({
            oldNode: currentTree,
            oldEl: currentRoot,
            oldMap: currentMap,
            newNode: renderedTree,
            newMap,
            ctx: tileCtx,
            patchers: tilePatchers,
          });
          dom = rec.el;
          lastRenderTouched = rec.touched;
        } catch (reconcileErr) {
          // Reconcile itself broke — safety net: rebuild the whole tree and
          // swap wholesale, recording the panic so the failure is visible in
          // the episode log / smoke report rather than silently degrading.
          // `location: "reconcile"` distinguishes this from a user tile-render
          // throw (`location: "render"`) so debugging points at the diff kernel
          // (or a detached-parent invariant) rather than a tile renderer.
          reportPanic("reconcile", reconcileErr);
          episode?.recordPanic({
            ...panicInfo(reconcileErr, "tile-render"),
            location: "reconcile",
          });
          dom = fullRender(renderedTree);
          target.replaceChild(dom, currentRoot);
        }
      } else {
        // Initial mount, or first render after a panic reset — no old tree
        // to diff against.
        dom = tileCtx.render(renderedTree);
        if (currentRoot) {
          target.replaceChild(dom, currentRoot);
        } else if (options.hydrate && target.firstChild) {
          // §10.6.2: the SSR HTML is already in `target` (the host injected it
          // before calling `hydrate`). Replace it with the CSR-rendered tree
          // wholesale so we never end up with SSR + CSR DOM as siblings. True
          // identity-preserving hydration (re-using SSR nodes in place) is
          // out of scope for v1 — the SSR pass exists for first-paint/SEO,
          // not for DOM stability across the boundary.
          target.replaceChildren(dom);
        } else {
          target.appendChild(dom);
        }
      }
    } catch (e) {
      // A render panic NOT caught by a per-tile `error-boundary` (e.g. one under
      // the root) lands here: surface it to a per-route `route.error(<pattern>)`
      // reducer if one matches (§7.5.2) so the app can replace the broken page;
      // otherwise render a top-level panic fallback so the exception does not
      // escape and leave the DOM stale. Logged via console.error so the smoke /
      // scenario tiers still flag it (#24).
      const renderRec = panicInfo(e, "tile-render");
      reportPanic("render", e);
      episode?.recordPanic({ ...renderRec, location: "render" });
      if (!fireRouteError(renderRec)) {
        dom = renderPanicFallback(e);
        panicked = true;
      } else {
        // route.error handlers ran — they may have navigated. Re-render once
        // (without retrying the broken tile) and use whatever the next pick
        // produces. Always full-render on the retry: the previous tree is now
        // suspect. If the re-render still throws, fall back to the panic UI.
        try {
          renderedTree = pickRootTile(app, slotValues);
          dom = fullRender(renderedTree);
        } catch (e2) {
          reportPanic("render", e2);
          // The second render also panicked; keep the episode-log honest by
          // recording that too, so replays surface both failures.
          episode?.recordPanic({ ...panicInfo(e2, "tile-render"), location: "render" });
          renderedTree = null;
          dom = renderPanicFallback(e2);
          panicked = true;
        }
      }
      // Panic path always swaps wholesale (never diffs against a possibly-
      // corrupt tree).
      if (currentRoot) {
        target.replaceChild(dom, currentRoot);
      } else if (options.hydrate && target.firstChild) {
        target.replaceChildren(dom);
      } else {
        target.appendChild(dom);
      }
    }
    currentRoot = dom;
    // On panic (either the primary render threw and no route.error recovered
    // it, or the recovery render also threw), abandon the diff baseline so the
    // next render starts from a clean full mount. Otherwise carry the fresh
    // tree + map forward as the next pass's `old` side.
    currentTree = panicked ? null : renderedTree;
    currentMap = newMap;

    // #190: on the happy patch path element identity is preserved, so this
    // `focus()` degrades to a no-op — the browser cursor is already on the
    // still-mounted control. Restoration still fires unconditionally to
    // cover: (a) reconcile-bailout / panic recovery, where DOM was rebuilt
    // wholesale; (b) keyed reorder, where the child element is moved via
    // `parentEl.appendChild` (browsers, and happy-dom, blur a moved element
    // even when its identity survives). The `.focus()` + setSelection calls
    // are idempotent and cheap on the happy path, so keeping the layer
    // active is a strict simplification win over per-path gating.
    if (snap) {
      // `snap.bind` comes from `data-kumiki-bind`, which is set from Kumiki
      // slot / bind-path syntax — a whitelisted identifier grammar without
      // ", ], or backslash — so it does not need attribute-value escaping
      // here. `snap.id` may be user-authored (`{id: "..."}`) and IS routed
      // through `CSS.escape` below.
      let sel: Element | null = snap.bind
        ? target.querySelector(`[data-kumiki-bind="${snap.bind}"]`)
        : snap.id
          ? target.querySelector(`#${CSS.escape(snap.id)}`)
          : null;
      // Fall back to DOM-path restore for inputs without bind/id (e.g.
      // `value=`-only search boxes). Identifies the element by its position.
      if (!sel && snap.path) sel = elementAtPath(snap.path, target);
      if (
        sel &&
        (sel.tagName === "INPUT" ||
          sel.tagName === "TEXTAREA" ||
          sel.tagName === "SELECT" ||
          (sel as HTMLElement).isContentEditable === true)
      ) {
        const el = sel as HTMLElement;
        el.focus();
        if (snap.hasSelection && snap.selStart !== null && snap.selEnd !== null) {
          try {
            (el as HTMLInputElement).setSelectionRange(snap.selStart, snap.selEnd);
          } catch {
            // Some input types (`type=file` / `email` / `number` / ...) reject
            // setSelectionRange with an InvalidStateError. Focus already
            // landed, which is the load-bearing part of the fallback.
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

  /**
   * Fire the `route.error(<pattern>)` reducer chain. Takes the already-derived
   * PanicRecord from the caller so category / stack aren't recomputed and —
   * more importantly — the $event category matches the recording site's
   * category. The one caller today is the tile render catch, so a route.error
   * from a render panic reports `category: "tile-render"`, not `"reducer"`.
   */
  function fireRouteError(rec: PanicRecord): boolean {
    if (!app.routes || app.routes.length === 0) return false;
    const cur = slotValues.route as ParsedRoute | undefined;
    const pattern = cur?.pattern;
    if (!pattern) return false;
    const eventName = `route.error(${JSON.stringify(pattern)})`;
    const handlers = app.reducers.filter(
      (r) => r.event.kind === "lifecycle" && r.event.name === eventName,
    );
    if (handlers.length === 0) return false;
    // User-facing $event stays limited to the fields the Kumiki PanicInfo
    // type documents (message / location + category). `stack` and `cause`
    // are intentionally NOT splatted — a raw devtools stack in production UI
    // is a footgun; those fields live in the episode-log only.
    const info: {
      message: string;
      location?: string;
      category: PanicCategory;
      pattern: string;
    } = { message: rec.message, category: rec.category, pattern };
    if (rec.location !== undefined) info.location = rec.location;
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
    const rec = panicInfo(e, "reducer");
    episode?.recordPanic({ ...rec, location });
    if (inPanicHandler) return;
    const handlers = app.reducers.filter(
      (h) => h.event.kind === "lifecycle" && h.event.name === "app.error",
    );
    if (handlers.length === 0) return;
    // User-facing $event is limited to fields the spec's PanicInfo type
    // documents; `stack` / `cause` stay in the episode-log only.
    const info = { message: rec.message, location, category: rec.category };
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
    // shared with the SSR pseudo-reducer pipeline so volatile semantics never
    // drift across the hydration boundary.
    const { diffs, dirty } = computeSlotDiffs(slotValues, result.slots, app.slots);
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
    // #189: attach the tiles/binds reconcile actually patched during this
    // render so the causal chain "slots X → tiles/binds A, B" lands in the
    // episode log. `render()` populates `lastRenderTouched` from the diff;
    // full-render / panic paths leave it empty (they carry no per-tile
    // attribution). Set-dedup preserves first-seen order and collapses to
    // `[]` when the array is empty.
    if (dirty.length > 0) {
      episode?.recordSignalUpdate(dirty, Array.from(new Set(lastRenderTouched)));
    }
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

  // Apply theme defaults to the style host and inject base CSS for tile
  // primitives. Reset the cache so subsequent mounts (e.g. across parallel
  // tests) always re-apply this app's theme, even if the name matches.
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
    // §1.6.2 — `on=ui.event(Tile#id)` matches only when the dispatched
    // element's `{id}` prop equals the selector's id. Codegen chains every
    // same-tile reducer onto the implicit handler so §1.6.4 invariant 3
    // (definition-order multi-dispatch) holds; this is where the id-scoped
    // ones drop out. `el.id` is undefined when the tile has no `{id}`, which
    // also fails the equality and skips an id-scoped reducer — as intended.
    const wantId = r.selector?.id;
    if (wantId != null && el.id !== wantId) return;
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

  // SSR hydration (§10.6.2 step 3): inject the server-side bootstrap episode
  // into the logger BEFORE any client-side episode is opened, so
  // `app.episodes()[0]` is the `ssr.hydrate` causal chain. The client must
  // NOT re-execute `app.init` (step 5 in spec: "not re-executed at
  // hydration"); the snapshot already carries those effects' results.
  //
  // Fail-fast on `hydrate: true` without a bootstrap episode: silently
  // skipping `app.init` AND skipping the ingest would leave the logger
  // incoherent — and the app stuck on default slot values with no record
  // of why. Spec §10.6.2 step 1 expects the host to drop to CSR before
  // calling `hydrate`, so reaching this code path is a contract violation.
  if (options.hydrate) {
    if (!options.bootstrapEpisode) {
      throw new Error(
        "mountCore: `hydrate: true` requires `bootstrapEpisode` (runtime.md §10.6.2 step 3). Fall back to a fresh `mount` if the snapshot is missing or version-mismatched.",
      );
    }
    episode?.ingestBootstrap(options.bootstrapEpisode);
  } else {
    for (const emit of app.init) dispatcher.dispatch(emit);
  }
  // Fire app.start lifecycle reducer — always, whether SSR-hydrated or fresh.
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
      unregisterAppRoot(target, app);
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
  // Policy-induced cancel of a pending effect-start that was already claimed
  // on its originating episode (spec §10.5.1). The seam fires for: a debounce
  // timer replaced before it fires, `dispose()` draining still-pending
  // debounces at unmount, the `http.cancel` branch clearing a debounce timer,
  // and `launch`'s capability early-return for a debounced effect whose cap
  // is undeclared. The logger reattaches the cancel to the episode that owns
  // the token, NOT the current top.
  onPolicyCancel?: (token: string, effectName: string) => void,
): Dispatcher {
  type TimerEntry = {
    // §6.4.1: cancel clears `debounce` (a pending-but-not-yet-issued launch)
    // and leaves `throttle` (the rate-limit window marker for an effect that
    // already launched) intact, so cancel doesn't accidentally reset the
    // throttle window and let an immediate next emit slip past.
    kind: "debounce" | "throttle";
    h: ReturnType<typeof setTimeout>;
    // debounce only: token + name claimed at dispatch time so the eventual
    // `launch` lands `effect-start`/`effect-end` on the originating episode
    // (spec §10.5.1), and any path that drops the pending launch (timer
    // replace, `http.cancel` clearing the timer, `dispose()` drain) can mark
    // that episode's pending start as cancelled via `onPolicyCancel`.
    token?: string;
    effectName?: string;
  };
  type RunState = {
    inflight: Map<string, AbortController>;
    timers: Map<string, TimerEntry>;
    onceSeen: Map<string, Set<string>>;
  };
  const state: RunState = { inflight: new Map(), timers: new Map(), onceSeen: new Map() };

  const launch = async (
    eff: EffectSpec,
    input: unknown,
    key: string,
    presetToken?: string,
  ): Promise<void> => {
    // Empty cap = standard presentation effect (e.g. scroll-to); no permission gate.
    if (eff.cap !== "" && !caps.has(eff.cap)) {
      console.warn(`Capability "${eff.cap}" not declared in app.caps`);
      // Deferred-policy dispatch (debounce) already recorded an effect-start
      // on the originating episode before the timer fired. Bailing out here
      // without releasing the token would strand that episode in
      // `closedAwaiting` forever — drain it via the cancel seam so the
      // trace shows WHY no effect-end ever lands.
      if (presetToken) onPolicyCancel?.(presetToken, eff.name);
      return;
    }
    // Episode logger seam (§10.5): the moment the dispatcher commits to
    // actually invoking the effect — policy filtering (debounce / once /
    // queue) has already passed. Token threads through to onResult so the
    // matching effect-end lands on the same Episode. For deferred policies
    // (debounce) the dispatch site already claimed the token + recorded the
    // effect-start; reusing it keeps the causal chain on the originating
    // episode (spec §10.5.1).
    const token = presetToken ?? onLaunch?.(eff.name, input) ?? "";
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
          // Only debounce timers represent a pending launch we want to drop.
          // A throttle timer is the open-window marker for an already-issued
          // launch — clearing it would let the very next emit slip through
          // ahead of the rate limit (spec §6.4.1).
          if (t !== undefined && t.kind === "debounce") {
            clearTimeout(t.h);
            state.timers.delete(target);
            // The pending debounce already claimed an effect-start on its
            // originating episode. Without releasing the token here, that
            // episode stays in `closedAwaiting` forever — symmetric with the
            // debounce-replace and `dispose()` drain paths (spec §10.5.1).
            if (t.token && t.effectName) {
              onPolicyCancel?.(t.token, t.effectName);
            }
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
        const prev = state.timers.get(id);
        if (prev) {
          clearTimeout(prev.h);
          // The prior dispatch already claimed an episode token + recorded
          // an effect-start (spec §10.5.1). Replacing the timer drops that
          // launch, so the originating episode must see an effect-cancel +
          // decrement its pending counter so it can commit. The truthy
          // guard skips the empty-string token a no-logger mount yields
          // (would otherwise be a noisy silent no-op in the logger seam).
          if (prev.token && prev.effectName) {
            onPolicyCancel?.(prev.token, prev.effectName);
          }
        }
        // Claim the episode token NOW so effect-start lands on the episode
        // that emitted us, not on whatever happens to be on top of the stack
        // when the timer fires later.
        const token = onLaunch?.(eff.name, input) ?? "";
        const h = setTimeout(() => {
          state.timers.delete(id);
          void launch(eff, input, key, token);
        }, policy.ms);
        state.timers.set(id, { kind: "debounce", h, token, effectName: eff.name });
        return;
      }
      if (policy.kind === "throttle") {
        if (state.timers.has(id)) return;
        const h = setTimeout(() => state.timers.delete(id), policy.ms);
        state.timers.set(id, { kind: "throttle", h });
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
      // Pending debounce timers hold a claimed effect-start on an episode
      // that already endTrigger'd — without notifying the logger, those
      // episodes stay forever in `closedAwaiting` and never commit
      // (spec §10.5.1). Snapshot the values first so the iteration is
      // immune to reentrancy via `onPolicyCancel`.
      const pendingTimers = [...state.timers.values()];
      state.timers.clear();
      for (const t of pendingTimers) {
        clearTimeout(t.h);
        if (t.kind === "debounce" && t.token && t.effectName) {
          onPolicyCancel?.(t.token, t.effectName);
        }
      }
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

/**
 * Full-fidelity record extracted from a caught throw for episode-log capture
 * (docs/spec/runtime.md §10.5.1). `message` / `location` are the fields the
 * user-facing `PanicInfo` type exposes; `stack` / `cause` / `category` are
 * dev-tooling grade — retained inside the episode-log and shown by
 * `kumiki replay` / `kumiki_episode_tail`, but NOT splatted into user reducer
 * `$event` payloads (raw stack traces would leak to production UI).
 */
export type PanicRecord = {
  message: string;
  location: string | undefined;
  stack: string | undefined;
  cause: PanicCauseLink[] | undefined;
  category: PanicCategory;
};

/**
 * Safety cap for `Error.cause` chain traversal — pathological or intentionally
 * cyclic cause pointers must not lock the runtime. Depth 8 is far beyond any
 * real-world wrap depth we've seen (2–3 typical) yet cheap to allocate.
 */
const PANIC_CAUSE_MAX_DEPTH = 8;

/**
 * Read `.message` / `.stack` / `.cause` off an arbitrary caught throw without
 * ever letting a hostile getter / Proxy / `toString` re-throw. `panicInfo` is
 * called from inside every panic-catch site, so a secondary throw here would
 * escape the dispatch handler and defeat the "no uncaught panic reaches the
 * DOM event loop" contract.
 */
function safeErrorField(e: unknown, field: "message" | "stack"): string | undefined {
  try {
    const v = (e as Record<string, unknown> | null | undefined)?.[field];
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  }
}

function safeString(v: unknown): string {
  try {
    return String(v);
  } catch {
    return "<unstringifiable>";
  }
}

function safeCauseOf(e: unknown): unknown {
  try {
    return (e as { cause?: unknown } | null | undefined)?.cause;
  } catch {
    return undefined;
  }
}

/**
 * Walk `Error.cause` iteratively into a flat, JSON-safe list. `seen` seeds
 * with the root object so a cause pointer that loops back to the root is
 * caught, and every field read runs through the safe helpers so a hostile
 * getter can never leak a fresh throw. Order: nearest cause first, root-most
 * last. Capped at {@link PANIC_CAUSE_MAX_DEPTH} links.
 */
function collectCauseChain(root: unknown): PanicCauseLink[] {
  const chain: PanicCauseLink[] = [];
  const seen = new Set<unknown>();
  if (root !== null && (typeof root === "object" || typeof root === "function")) seen.add(root);
  let cur: unknown = safeCauseOf(root);
  while (cur !== undefined && cur !== null && chain.length < PANIC_CAUSE_MAX_DEPTH) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const link: PanicCauseLink = { message: "" };
    try {
      if (cur instanceof Error) {
        link.message = safeErrorField(cur, "message") ?? "";
        const stack = safeErrorField(cur, "stack");
        if (stack !== undefined) link.stack = stack;
      } else {
        link.message = safeString(cur);
      }
    } catch {
      link.message = "<cause unavailable>";
    }
    chain.push(link);
    cur = cur instanceof Error ? safeCauseOf(cur) : undefined;
  }
  return chain;
}

/**
 * Full-fidelity extraction of a caught throw for the episode-log / devtools
 * path. Preserves `message` + optional `location` (the fields the user-facing
 * `PanicInfo` type exposes) and additionally captures `.stack`, the flattened
 * `Error.cause` chain (nearest cause first, root-most last), and the caller-
 * supplied `category`. Never throws — a secondary exception inside a getter
 * or a Proxy is caught and downgraded to a "details unavailable" record so
 * the outer catch (which already committed to handling the primary panic)
 * always gets a value.
 */
export function panicInfo(e: unknown, category: PanicCategory = "unknown"): PanicRecord {
  try {
    const cause = collectCauseChain(e);
    const chain = cause.length > 0 ? cause : undefined;
    if (isPanic(e)) {
      return {
        message: safeErrorField(e, "message") ?? "",
        location: e.location,
        stack: safeErrorField(e, "stack"),
        cause: chain,
        category,
      };
    }
    if (e instanceof Error) {
      return {
        message: safeErrorField(e, "message") ?? "",
        location: undefined,
        stack: safeErrorField(e, "stack"),
        cause: chain,
        category,
      };
    }
    return {
      message: safeString(e),
      location: undefined,
      stack: undefined,
      cause: chain,
      category,
    };
  } catch {
    return {
      message: "panic (details unavailable)",
      location: undefined,
      stack: undefined,
      cause: undefined,
      category,
    };
  }
}

/**
 * Surface a caught live panic so the verification tiers still see it: smoke()
 * and runScenario() both patch console.error into their issue/error buffers, so
 * a controlled panic is reported as a failure rather than silently swallowed.
 *
 * The first line format (`[kumiki] panic in <where>: <message>`) is stable —
 * `packages/tests/scenario.test.ts` greps for it (via the console.error buffer
 * that `runScenario` collects) to distinguish a controlled panic from a
 * generic console.error. Stack trace + Error.cause chain are appended as
 * indented continuation lines so devtools show a full root-cause trail without
 * breaking that grep.
 */
function reportPanic(where: string, e: unknown): void {
  const rec = panicInfo(e);
  const lines: string[] = [
    `[kumiki] ${isPanic(e) ? "panic" : "error"} in ${where}: ${rec.message}`,
  ];
  if (rec.stack !== undefined) {
    for (const line of formatStackForConsole(rec.stack, rec.message)) lines.push(line);
  }
  if (rec.cause !== undefined) {
    for (const link of rec.cause) {
      lines.push(`  Caused by: ${link.message}`);
      if (link.stack !== undefined) {
        for (const line of formatStackForConsole(link.stack, link.message)) lines.push(line);
      }
    }
  }
  console.error(lines.join("\n"));
}

/**
 * Convert a raw `Error.stack` string into the continuation lines
 * `reportPanic` appends after the "[kumiki] panic in ..." header. V8-style
 * stacks include the message on the first line ("Error: boom\n    at ...");
 * strip it so the header is not duplicated. Any remaining lines are
 * two-space-indented so devtools group them under the header.
 */
function formatStackForConsole(stack: string, message: string): string[] {
  const raw = stack.split("\n");
  const trimmed =
    raw.length > 0 && raw[0] !== undefined && raw[0].includes(message) ? raw.slice(1) : raw;
  const out: string[] = [];
  for (const line of trimmed) {
    const l = line.replace(/\s+$/, "");
    if (l.length === 0) continue;
    out.push(l.startsWith(" ") || l.startsWith("\t") ? `  ${l.trim()}` : `  ${l}`);
  }
  return out;
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
export function readStatus(value: unknown): number | null {
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

export function reportUnhandledEffectError(effect: string, value: unknown): void {
  const message =
    value && typeof value === "object" && "message" in value
      ? String((value as { message: unknown }).message)
      : String(value);
  console.error(`[kumiki] effect "${effect}" returned an error with no .err reducer: ${message}`);
}

/** A minimal top-level fallback for a render panic with no enclosing boundary. */
function renderPanicFallback(e: unknown): HTMLElement {
  // Deliberately narrow: only `message` / `location` reach user-visible DOM.
  // `stack` / `cause` would leak internals; keep them in the episode-log.
  const { message, location } = panicInfo(e, "tile-render");
  const div = document.createElement("div");
  div.dataset.kumikiPanic = location ?? "";
  div.setAttribute("role", "alert");
  div.textContent = `Something went wrong: ${message}`;
  return div;
}

// ---- tile-level keyed diff ----
// The reconcile pass keeps `core.ts` as the single value-owner of the render
// path (tsdown's modules build treats every non-entry file as an anonymous
// shared chunk, which the CLI test asserts must never appear — see
// `packages/runtime/tsdown.config.ts`). Types stay local; code is nested
// here rather than split into a peer module for that reason.
//
// Design: docs/design/reactivity-v2.md §2 Decision 1(a). Walk new vs. mounted
// `TileNode` in parallel, keep the DOM node for tiles whose data props did
// not change (natively preserving focus / caret / `<select>` open state /
// event listeners), rebuild only changed subtrees. Identity is structural
// (position + `kind`) unless the tile carries a `TileNode.key`, in which
// case the keyed child-list path pairs children across renders by key.
//
// Reused tiles are NEVER re-touched: `applyMotion` restarts animations, and
// `applyUiEventHandlers` uses `addEventListener` and would multiply-register
// on every reuse. Because our equality check compares DATA props (ignoring
// function-valued fields), the OLD closure on a reused element is
// behaviourally equivalent to what a fresh render would install.

type TileElementMap = WeakMap<TileNode, HTMLElement>;

function makeMappingTileCtx(
  tiles: TileRenderers,
  map: TileElementMap,
  wrap: {
    applyMotion: (el: HTMLElement, props: TileProps | undefined) => void;
    applyUiEventHandlers: (el: HTMLElement, props: TileProps | undefined) => void;
    renderMissingTile: (node: TileNode) => HTMLElement;
  },
): TileCtx {
  const lookup = tiles as Record<
    string,
    ((node: TileNode, ctx: TileCtx) => HTMLElement) | undefined
  >;
  const ctx: TileCtx = {
    render(node: TileNode): HTMLElement {
      const renderer = lookup[node.kind];
      const el = renderer ? renderer(node, ctx) : wrap.renderMissingTile(node);
      wrap.applyMotion(el, node.props);
      wrap.applyUiEventHandlers(el, node.props);
      map.set(node, el);
      return el;
    },
  };
  return ctx;
}

function reconcileTree(args: {
  oldNode: TileNode;
  oldEl: HTMLElement;
  oldMap: TileElementMap;
  newNode: TileNode;
  newMap: TileElementMap;
  ctx: TileCtx;
  patchers: TilePatchers;
}): { el: HTMLElement; touched: string[] } {
  // #189: collect an identifier per subtree that reconcile actually rebuilt or
  // freshly mounted (or patched in place, #190). Consumed by `renderPass` →
  // `recordSignalUpdate`, filling the episode `signal-update` step's
  // `binds-updated` field. Only the ROOT of each rebuilt / patched subtree is
  // pushed (no descent) to keep the log tight — per the learning-cost guard in
  // docs/design/reactivity-v2.md §4.
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
): HTMLElement {
  // Different kind → whole subtree is a different thing. Build fresh, splice.
  if (oldNode.kind !== newNode.kind) {
    return replaceWithFreshTile(oldEl, newNode, ctx, touched);
  }
  // Same kind, differing own data props (`children` / `key` / functions
  // excluded — see `TILE_SKIP_TOP` / `tileValueEqual`). #190 identity-
  // preserving path: if a per-kind patcher is registered, mutate the mounted
  // element in place (preserving `<select>` open state / focus / caret /
  // `<video>` playback / `<details>` open / `contenteditable`), then continue
  // into the children walk below so container-shaped changes still reconcile.
  // Without a patcher, fall back to the full subtree rebuild (correct but
  // discards browser-internal state — pre-#190 behaviour).
  if (!tileFieldsEqual(oldNode, newNode)) {
    const patcher = (patchers as Record<string, TilePatcher | undefined>)[newNode.kind];
    if (patcher) {
      // Throws land in the outer `reconcileTree` bailout, which records a
      // `location: "reconcile"` panic and does a full `target.replaceChild`.
      // Patchers should therefore be side-effect-safe up to the throw point.
      try {
        patcher(oldEl, oldNode as never, newNode as never, ctx);
      } catch (e) {
        // `PatchRequiresRebuild` is a controlled escape hatch a patcher throws
        // when it discovers the new node cannot be applied in place (e.g. a
        // `list` whose `ordered` flip changes `<ul>` ↔ `<ol>`). Fall through
        // to the same-kind rebuild path without polluting the episode log
        // with a "reconcile panic" — this is a normal, expected outcome.
        if (e instanceof PatchRequiresRebuild) {
          return replaceWithFreshTile(oldEl, newNode, ctx, touched);
        }
        throw e;
      }
      // Reused elements must dispatch through their handler-slot lookups with
      // the *current* render's closures, not the create-time ones. INPUT_STATE
      // (`tiles-input.ts`) / SURFACE_STATE (`tiles-overlay.ts`) / LINK_STATE
      // (`tiles-text.ts`) are refreshed by their per-kind patchers; the
      // universal onKeyDown / onFocus / onBlur / onMouseEnter handlers, which
      // `applyUiEventHandlers` wires on every tile via the create ctx, live in
      // this shared UI_HANDLER_STATE and are refreshed here.
      refreshUiHandlerSlot(oldEl, (newNode as { props?: TileProps }).props);
      touched.push(tileTouchedId(newNode));
      // Fall through to the children reconcile below — a container tile may
      // have both attribute AND child changes in the same render.
    } else {
      return replaceWithFreshTile(oldEl, newNode, ctx, touched);
    }
  }
  const oldChildren = getTileChildren(oldNode);
  const newChildren = getTileChildren(newNode);
  if (oldChildren.length === 0 && newChildren.length === 0) {
    newMap.set(newNode, oldEl);
    return oldEl;
  }
  // Keyed path — all-or-nothing per parent. When every child on both sides
  // carries a `key`, we match children by key across renders and survive
  // reorder / insert / remove without rebuilding the subtree. Mixed or
  // absent keys fall through to the structural walk below.
  if (allChildrenKeyed(oldChildren) && allChildrenKeyed(newChildren)) {
    reconcileKeyedChildren(oldEl, oldChildren, newChildren, oldMap, newMap, ctx, patchers, touched);
    newMap.set(newNode, oldEl);
    return oldEl;
  }
  // Structural length change without keys → subtree rebuild. Preserves
  // correctness at the cost of reuse; keyed children above lift this
  // restriction when the compiler emits identity.
  if (oldChildren.length !== newChildren.length) {
    return replaceWithFreshTile(oldEl, newNode, ctx, touched);
  }
  // Same length: walk in parallel, reconcile each child pair. The old child's
  // live element is looked up in `oldMap`; if it's missing (defensive — could
  // happen if a tile renderer built children outside the mapping ctx, but the
  // built-in renderers all go through `ctx.render`), conservatively rebuild
  // the parent subtree.
  for (let i = 0; i < newChildren.length; i++) {
    const oldChildNode = oldChildren[i];
    const newChildNode = newChildren[i];
    if (!oldChildNode || !newChildNode) return replaceWithFreshTile(oldEl, newNode, ctx, touched);
    const oldChildEl = oldMap.get(oldChildNode);
    if (!oldChildEl) return replaceWithFreshTile(oldEl, newNode, ctx, touched);
    reconcileNode(oldChildNode, oldChildEl, oldMap, newChildNode, newMap, ctx, patchers, touched);
  }
  newMap.set(newNode, oldEl);
  return oldEl;
}

function allChildrenKeyed(nodes: TileNode[]): boolean {
  if (nodes.length === 0) return false;
  for (const n of nodes) if (!n || typeof n.key !== "string") return false;
  return true;
}

/**
 * Keyed child reconcile — mutates `parentEl` in place to match `newChildren`.
 *
 * Strategy: (1) build key→oldChild lookup, (2) for each new child either
 * reconcile against its keyed old counterpart or mount fresh, (3) drop
 * unmatched old children from the DOM, (4) reorder the parent's children to
 * match the target sequence. `appendChild` on an already-attached element
 * moves it, and `unmount` / `mount` lifecycle firing is centralised in the
 * outer render pass so no per-node hooks are needed here.
 *
 * Throws — never silently falls back — on: duplicate sibling keys, and any
 * invariant break (an old keyed tile missing its element mapping). The outer
 * reconcile bailout catches the throw, records the panic, and does a full
 * rebuild so the failure is visible in the episode log rather than silently
 * degrading DOM state.
 */
function reconcileKeyedChildren(
  parentEl: HTMLElement,
  oldChildren: TileNode[],
  newChildren: TileNode[],
  oldMap: TileElementMap,
  newMap: TileElementMap,
  ctx: TileCtx,
  patchers: TilePatchers,
  touched: string[],
): void {
  // Detect duplicate keys among the new children. Silently letting a
  // duplicate through would collapse N tiles onto one DOM element (the
  // second `parentEl.appendChild(el)` moves the same element to the end
  // again). Throw so the outer reconcile bailout records a panic and does
  // a full rebuild — a loud, recoverable failure rather than a silent
  // DOM-loss bug.
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
  const byKey = new Map<string, TileNode>();
  for (const oc of oldChildren) if (typeof oc.key === "string") byKey.set(oc.key, oc);
  const targetEls: HTMLElement[] = [];
  const matched = new Set<TileNode>();
  for (const newChild of newChildren) {
    const key = newChild.key as string;
    const oldChild = byKey.get(key);
    if (oldChild) {
      matched.add(oldChild);
      const oldChildEl = oldMap.get(oldChild);
      if (!oldChildEl) {
        // Invariant violation — an old keyed tile should always be in the
        // element map because every tile passes through `makeMappingTileCtx`.
        // Throw so the outer reconcile bailout records this as a panic
        // rather than silently forcing a subtree rebuild (which would erase
        // focus, scroll, and any other DOM state on the whole parent).
        throw new Error(
          `reconcile: keyed old tile "${key}" has no live element mapping — invariant violation in makeMappingTileCtx`,
        );
      }
      const el = reconcileNode(
        oldChild,
        oldChildEl,
        oldMap,
        newChild,
        newMap,
        ctx,
        patchers,
        touched,
      );
      targetEls.push(el);
    } else {
      // Fresh mount: `ctx.render` records the new node → element mapping into
      // newMap via `makeMappingTileCtx`, so the next pass sees this child in
      // its map lookup.
      touched.push(tileTouchedId(newChild));
      targetEls.push(ctx.render(newChild));
    }
  }
  // Remove unmatched old children from the DOM before reordering — otherwise
  // `appendChild` calls below would leave them stranded ahead of the moved
  // survivors. `tile.unmount(X)` lifecycle firing is name-based and driven
  // by the outer render pass's tree walk, so no per-node unmount hook here.
  for (const oldChild of oldChildren) {
    if (matched.has(oldChild)) continue;
    const oldChildEl = oldMap.get(oldChild);
    if (oldChildEl && oldChildEl.parentNode === parentEl) {
      parentEl.removeChild(oldChildEl);
    }
  }
  // Reorder: `parentEl.appendChild(el)` moves already-attached elements to
  // the end and appends fresh ones. Iterating targetEls in order therefore
  // yields the exact new sequence. Elements already in the correct trailing
  // position get a no-op move.
  for (const el of targetEls) parentEl.appendChild(el);
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
  // No parent → the caller's `oldEl` is detached from the live tree. If we
  // silently returned `fresh` the caller would install a floating subtree as
  // `currentRoot` and every subsequent `_rerender` would run against DOM the
  // user cannot see. Throw so the outer reconcile catch bails to a full
  // rebuild + `target.replaceChild(...)` and the failure is recorded.
  if (!parent) {
    throw new Error(
      `reconcile: cannot splice new tile "${newNode.kind}" — old element has no parent (subtree detached from live DOM)`,
    );
  }
  parent.replaceChild(fresh, oldEl);
  return fresh;
}

/**
 * Identifier for a tile the reconcile diff freshly built (subtree rebuild or
 * keyed-diff insert). Consumed by episode `signal-update.binds-updated` (#189).
 * Priority: `bind` (with `bindPath` joined) → `key` → `kind`. The bind form
 * matches `data-kumiki-bind` in `tiles-input.ts` (`bindDataset`) so an authored
 * `bind=todo.title` shows up as the same `"todo.title"` string in the log.
 */
function tileTouchedId(node: TileNode): string {
  const asBindable = node as { bind?: unknown; bindPath?: unknown };
  if (typeof asBindable.bind === "string") {
    const bind = asBindable.bind;
    if (Array.isArray(asBindable.bindPath) && asBindable.bindPath.length > 0) {
      return `${bind}.${(asBindable.bindPath as string[]).join(".")}`;
    }
    return bind;
  }
  if (typeof node.key === "string") return node.key;
  return node.kind;
}

// Every TileNode variant that carries a subtree spells it `children`
// (`TileNode[]`); variants without children just have the property absent.
const EMPTY_TILES: TileNode[] = [];
function getTileChildren(node: TileNode): TileNode[] {
  const c = (node as { children?: TileNode[] }).children;
  return Array.isArray(c) ? c : EMPTY_TILES;
}

// Top-level TileNode keys the equality check ignores. `kind` is the
// discriminant (already handled by the caller); `children` is walked
// separately (each child is reconciled recursively). `key` is identity
// metadata — a change in `key` means "different instance", handled by the
// child-list matcher, not by data-prop equality.
const TILE_SKIP_TOP: ReadonlySet<string> = new Set(["kind", "children", "key"]);

function tileFieldsEqual(a: TileNode, b: TileNode): boolean {
  const oa = a as unknown as Record<string, unknown>;
  const ob = b as unknown as Record<string, unknown>;
  // Union of keys — a field present on only one side is a difference unless
  // both values are equal (and `undefined === undefined`, so an absent key
  // and an explicit-undefined key compare equal — matches TileNode usage
  // where optional fields are simply not emitted).
  const keys = new Set<string>();
  for (const k of Object.keys(oa)) if (!TILE_SKIP_TOP.has(k)) keys.add(k);
  for (const k of Object.keys(ob)) if (!TILE_SKIP_TOP.has(k)) keys.add(k);
  for (const k of keys) if (!tileValueEqual(oa[k], ob[k])) return false;
  return true;
}

function tileValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Ignore closure identity for handler-shaped fields — codegen mints new
  // closures per render, but a same-data reused tile keeps working with the
  // old closure (which references the same stable dispatch seam).
  if (typeof a === "function" && typeof b === "function") return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!tileValueEqual(a[i], b[i])) return false;
    return true;
  }
  // Plain object — key-wise compare. Anything exotic (Date, Map, DOM node)
  // should NOT appear inside TileNode props (the compiler emits only data);
  // conservatively treat two exotic instances as unequal so a caller who does
  // smuggle one gets a rebuild rather than silent reuse.
  const oa = a as Record<string, unknown>;
  const ob = b as Record<string, unknown>;
  const keys = new Set<string>([...Object.keys(oa), ...Object.keys(ob)]);
  for (const k of keys) if (!tileValueEqual(oa[k], ob[k])) return false;
  return true;
}

// Per-element slot for the universally-lifted UI handlers (onKeyDown /
// onMouseEnter / onFocus / onBlur). Same pattern as tiles-input.ts INPUT_STATE
// and tiles-text.ts LINK_STATE: native listeners are registered once at
// create-time and dispatch through the slot; `refreshUiHandlerSlot` overwrites
// the slot when a patch runs so the new node's handler + `el` payload reach
// subsequent events. Without this, `applyUiEventHandlers` used to close over
// the create-time `props` — and because `tileValueEqual` treats function
// values as always-equal, a changed handler or `el` payload would never even
// trigger a subtree rebuild, silently firing the stale closure on every event.
type UiHandlerSlot = {
  onKeyDown?: EventHandler;
  onMouseEnter?: EventHandler;
  onFocus?: EventHandler;
  onBlur?: EventHandler;
  el?: Record<string, unknown>;
};
const UI_HANDLER_STATE = new WeakMap<HTMLElement, UiHandlerSlot>();

function toUiHandlerSlot(props?: TileProps): UiHandlerSlot {
  const slot: UiHandlerSlot = {};
  if (!props) return slot;
  if (props.onKeyDown) slot.onKeyDown = props.onKeyDown;
  if (props.onMouseEnter) slot.onMouseEnter = props.onMouseEnter;
  if (props.onFocus) slot.onFocus = props.onFocus;
  if (props.onBlur) slot.onBlur = props.onBlur;
  if (props.el !== undefined) slot.el = props.el;
  return slot;
}

/**
 * Overwrite an element's UI-handler slot from the current-render props. Called
 * by `reconcileNode` whenever a patch runs, so re-used elements dispatch
 * `onKeyDown` / `onMouseEnter` / `onFocus` / `onBlur` through the LATEST closure
 * instead of the create-time one.
 */
function refreshUiHandlerSlot(el: HTMLElement, props?: TileProps): void {
  UI_HANDLER_STATE.set(el, toUiHandlerSlot(props));
}

function applyUiEventHandlers(el: HTMLElement, props?: TileProps): void {
  if (!props) return;
  const hasAny =
    Boolean(props.onKeyDown) ||
    Boolean(props.onMouseEnter) ||
    Boolean(props.onFocus) ||
    Boolean(props.onBlur);
  if (!hasAny) return;
  UI_HANDLER_STATE.set(el, toUiHandlerSlot(props));
  el.addEventListener("keydown", (e) => {
    const state = UI_HANDLER_STATE.get(el);
    if (!state?.onKeyDown) return;
    const ke = e as KeyboardEvent;
    state.onKeyDown({ ...(state.el ?? {}), key: ke.key, code: ke.code });
  });
  el.addEventListener("mouseenter", () => {
    const state = UI_HANDLER_STATE.get(el);
    if (state?.onMouseEnter) state.onMouseEnter(state.el ?? {});
  });
  el.addEventListener("focus", () => {
    const state = UI_HANDLER_STATE.get(el);
    if (state?.onFocus) state.onFocus(state.el ?? {});
  });
  el.addEventListener("blur", () => {
    const state = UI_HANDLER_STATE.get(el);
    if (state?.onBlur) state.onBlur(state.el ?? {});
  });
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

// #190 idempotency: `applyStateStyles` used to run once per element per mount,
// so a monotonically-growing `stateStyleSeq` was harmless. With patchers
// re-running `applyContainerProps` (and therefore `applyStateStyles`) on every
// data-prop change, a call whose state props are unchanged would still append
// a fresh `data-kumiki-state` token + a duplicate CSS rule on every render —
// unbounded growth on both the element attribute and the shared stylesheet.
// Cache the last-applied state signature per element and short-circuit an
// unchanged re-application. When state props DO change, we still leak the old
// stylesheet rule (its `data-kumiki-state` token is retired from the element),
// but that's bounded by "unique state combos per element" rather than "render
// count" — a genuine and rare change, not a per-render cost.
const STATE_STYLE_SIG = new WeakMap<HTMLElement, string>();

function applyStateStyles(el: HTMLElement, props: TileProps): void {
  const sig = JSON.stringify([
    props.hover,
    props.focus,
    props.active,
    props.disabled,
    props.selected,
  ]);
  if (STATE_STYLE_SIG.get(el) === sig) return;
  // Retire any tokens the previous render installed on this element — the
  // rules stay in the shared stylesheet (harmless dead rules) but the element
  // stops matching them.
  if (STATE_STYLE_SIG.has(el)) delete el.dataset.kumikiState;
  STATE_STYLE_SIG.set(el, sig);
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

// Module-global by design (one style host per document in the common case),
// which means it is shared ACROSS mounts: two co-mounted apps whose themes
// share a NAME but differ in content will cache-hit each other and skip
// re-injection — the shared style host keeps whichever applied last. That is
// part of the style-root contention this registry deliberately does not solve
// (see the multi-mount changeset); give co-mounted apps distinct theme names
// or isolate them in shadow roots.
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
  const theme = currentThemeOf(app);
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

/**
 * Theme of the app whose render pass is currently running; null outside a
 * render pass (including during mount before the first render — theme setup
 * there goes through `currentThemeOf` with an explicit app). Hosts that need
 * a theme outside a render pass should resolve the app themselves, e.g. via
 * `resolveApp(el)`.
 */
export function currentTheme(): Theme | null {
  const app = getRenderingApp();
  return app ? currentThemeOf(app) : null;
}

function currentThemeOf(app: AppShape): Theme | null {
  if (!app.themes) return null;
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
