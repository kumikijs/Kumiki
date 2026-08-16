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
  | {
      kind: "button";
      text: string;
      /** `loading`, `disabled` and `variant` live here — see `applyButtonState`. */
      props?: TileProps;
      /**
       * `submit` / `button` / `reset`. Absent means the tile did not say, and
       * the HTML default applies — which is `submit` inside a form.
       */
      type?: string;
    }
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
  ) => {
    slots: Record<string, unknown>;
    emits: EmitSpec[];
    stopTimers?: string[];
    /**
     * Refinements the body violated *while running* (runtime.md §10.3.3).
     * Codegen fills this; a hand-written `apply` omits it and is covered by the
     * final-value scan in {@link batchRejections} instead.
     */
    rejected?: RefinementRejection[];
  };
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

/**
 * Why the reconcile gave up identity preservation for a subtree — either
 * rebuilding it wholesale, or declining the keyed matcher and dropping to the
 * weaker positional walk. Each one is correctness-preserving, so none of them
 * throws — which is exactly the problem: an app can be re-mounting every
 * subtree on every render while looking perfectly healthy from the outside.
 *
 * Two rebuild paths are deliberately absent. A `kind` change means a different
 * thing is in that position, so there is no identity to preserve. And a
 * patcher that declines in place (a `list` flipping `<ul>` ↔ `<ol>`) is a
 * normal, expected outcome that `PatchRequiresRebuild` exists to keep out of
 * the log.
 */
export type ReconcileFallbackReason = ReconcileFallback["reason"];

/**
 * The reason a subtree was rebuilt, together with the evidence only that reason
 * has. The walker knows the counts / positions / kinds at each decision point,
 * and a bare reason string would throw them away — "an unkeyed list changed
 * length" is a fact, "3 children became 4" is something to act on.
 */
export type ReconcileFallback =
  /**
   * The tile's own data props changed and no patcher is registered for its
   * kind (`tileKind` on the enclosing diagnostic), so the whole subtree was
   * rebuilt — discarding focus, caret, `<select>` open state and `<video>`
   * playback on that element.
   */
  | { reason: "no-patcher" }
  /**
   * An unkeyed sibling list changed length, so the parent was rebuilt. Giving
   * every child a `key` lifts this: the keyed matcher then survives insert,
   * remove and reorder without touching the untouched siblings.
   */
  | { reason: "child-count-change"; oldCount: number; newCount: number }
  /**
   * A children array had an empty slot at `index`. Kumiki codegen flattens
   * nils away, so this only reaches the walker from a host-built tile tree.
   */
  | { reason: "child-hole"; index: number }
  /**
   * The old child at `index` had no entry in the node → element map, which
   * means its parent's renderer built it without going through `ctx.render`.
   * The walker cannot reuse what it cannot find, so that parent rebuilds on
   * every render. `childKind` names the child whose element went missing.
   */
  | { reason: "child-unmapped"; index: number; childKind: string }
  /**
   * Every child carried a `key`, but the parent's renderer does not place its
   * children directly under its own element — the child at `index` sits inside
   * a renderer-owned wrapper (`overlay` puts every child after the first in a
   * positioning layer). Moving and removing children is addressed against the
   * parent element, so the keyed matcher declined and the positional walk ran
   * instead: correct, but reorder no longer preserves element identity. A host
   * renderer hits this by appending children to anything other than the
   * element it returns.
   */
  | { reason: "wrapped-children"; index: number; childKind: string }
  /**
   * Every child carried a `key` and every mounted one sits directly under the
   * parent element — but the new child at `index` is a newcomer, and this
   * parent's renderer does not place every child directly (`overlay` wraps all
   * but the first; the surfaces wrap all of theirs in a content div). The
   * mounted children can only testify about the slots that already exist, so a
   * short list looks placeable right up until it grows. The keyed matcher
   * declined rather than append the newcomer bare, and the positional walk ran
   * instead. `childKind` names the newcomer.
   */
  | { reason: "unplaceable-insert"; index: number; childKind: string };

/**
 * Why a pair of data-prop values can never compare equal, however identical the
 * two renders that produced them are. Each is a settled rule of the equality
 * kernel rather than a bug in it — the point of naming them is that a tile
 * carrying one pays for a diff it can never win.
 */
export type NeverEqualCause =
  /**
   * A `Date`, `Map`, `Set`, `RegExp`, DOM node, class instance, or an object
   * from another realm. Their state lives outside their own enumerable keys, so
   * the kernel refuses to compare them key-wise and only `===` can make two of
   * them equal — which a value rebuilt each render never is.
   */
  | "non-plain-object"
  /** `NaN`, which is not equal to itself by definition. */
  | "nan"
  /**
   * A function whose identity changed. The scan keeps no history, so this
   * fires on any two distinct closures — including the one-off swap a
   * conditional makes between two properly memoised handlers. What it always
   * means is that this pair could not compare equal; whether it repeats
   * depends on whether the host rebuilds the handler per render, which is the
   * case worth fixing. Codegen memoises one closure per reducer list, so a
   * compiled app only reports this on a genuine change.
   */
  | "function-identity";

/**
 * A framework-internals observation, delivered to `MountOptions.onDiagnostic`.
 *
 * Distinct from the episode log on purpose: an episode is the author-facing
 * causal record of what the app did, and already reports *that* a subtree was
 * re-rendered through `signal-update.binds-updated`. A diagnostic reports
 * *why* the runtime made that choice — useful when tuning an app or a host
 * integration, noise in a behavioural trace.
 *
 * The two variants differ in cost, not in correctness. A `reconcile-fallback`
 * costs performance and browser-owned element state; a `never-equal-prop` costs
 * a diff and a patch on every render. Both leave the app correct, so a host
 * wiring these to a console should warn on each and error on neither.
 */
export type RuntimeDiagnostic =
  | (DiagnosticSite & { kind: "reconcile-fallback" } & ReconcileFallback)
  | (DiagnosticSite & {
      /**
       * A data prop holds a value that cannot compare equal to a structurally
       * identical counterpart, so this tile's props are unequal on every render
       * from now on. With a patcher registered that is invisible through every
       * other channel — the element keeps its identity and nothing degrades, it
       * just re-applies the same attributes forever. Without one the rebuild is
       * already reported as `no-patcher`, and this names the field that reason
       * cannot.
       *
       * Reported only for host-registered renderers: codegen emits no cause,
       * so a built-in tile carrying one came from a host-built tree.
       */
      kind: "never-equal-prop";
      /** Dotted path of the offending field, e.g. `props.at` or a bare `at`. */
      field: string;
      cause: NeverEqualCause;
    });

/**
 * The tile every diagnostic is about. Shared by all three variants so a host
 * can log, group and correlate them without narrowing first — and so a fourth
 * variant cannot quietly report something the reader can't locate.
 */
export type DiagnosticSite = {
  /** The tile kind the walker was deciding about. */
  tileKind: string;
  /** Same identifier the episode log uses: bind path, else key, else kind. */
  id: string;
  /** The authored tile this node came from, when it came from one. */
  tile?: string | undefined;
};

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
   * Development-time observation channel for the reconcile diff. When present,
   * every rebuild the walker performs instead of preserving element identity is
   * reported here, along with the host-tile cost the prop-equality check
   * exposes: a value — a per-render closure, a `Date`, a `NaN` — that can never
   * compare equal to its counterpart. Omit it (the default) and the checks
   * never run: production mounts pay one optional-call check per decision and
   * nothing else.
   */
  onDiagnostic?: (d: RuntimeDiagnostic) => void;
  /**
   * Tile kinds whose renderer came from the host rather than the built-in set.
   * Scopes the per-field `never-equal-prop` scan in `onDiagnostic`, which would
   * otherwise fire once per field per render on every built-in tile. Codegen
   * carries only plain data and memoises every handler, so no built-in tile can
   * hold a never-equal value in the first place. The package entry's `mount`
   * derives this from the `tiles` override map; callers using `mountCore` with
   * their own renderers pass it themselves. Ignored without `onDiagnostic`.
   */
  hostTileKinds?: readonly string[];
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
   *
   * Refused when the shape is already mounted: a snapshot overlays a state that
   * is about to be built, and this app's is already live.
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

/** One slot in a reducer batch whose new value its refinement refuses. */
export type RefinementRejection = {
  slot: string;
  value: unknown;
  /** The predicate name + args, when the slot carries them (`between`, [0, 3]). */
  kind?: string;
  args?: (number | string)[];
};

/** Describe one rejected write, carrying the predicate when the slot names it. */
export function refinementRejectionOf(
  slot: string,
  value: unknown,
  meta: { refineKind?: string; refineArgs?: unknown },
): RefinementRejection {
  const rejection: RefinementRejection = { slot, value };
  if (meta.refineKind !== undefined) rejection.kind = meta.refineKind;
  if (Array.isArray(meta.refineArgs)) rejection.args = meta.refineArgs as (number | string)[];
  return rejection;
}

/**
 * The slots in a reducer's returned map whose *final* value fails their
 * refinement (runtime.md §10.3.3).
 *
 * This is the backstop, not the primary check: a batch is a map, so it only
 * remembers the last value written to each slot, and a `for` loop that leaves
 * the range and comes back would look clean here. Codegen therefore wraps each
 * individual write in `_s.slotWrite`, which reports as it happens. This pass
 * still runs because a hand-written `AppShape` (tests, Web Component hosts,
 * anything not produced by codegen) has no wrapped writes at all.
 *
 * {@link batchRejections} merges the two, and every path that applies a batch
 * goes through it.
 */
export function refinementRejections(
  next: Record<string, unknown>,
  slotMetas: Record<
    string,
    { refine?: RefinementCheck; refineKind?: string; refineArgs?: unknown }
  >,
): RefinementRejection[] {
  const out: RefinementRejection[] = [];
  for (const [k, v] of Object.entries(next)) {
    const meta = slotMetas[k];
    if (!meta?.refine || meta.refine(v)) continue;
    out.push(refinementRejectionOf(k, v, meta));
  }
  return out;
}

/**
 * Every refinement a reducer's result violated: the per-write rejections
 * codegen collected during the body, plus the final-value scan for results that
 * did not come from codegen. Deduplicated by slot, first occurrence winning —
 * the first out-of-range value a loop produced is the one that explains the
 * rejection, not the value the slot happened to end on.
 *
 * Every path that applies a reducer batch — live mount, SSR, episode replay,
 * both reducer-test harnesses, `run-reducer` inside a property-test — calls
 * this, so "a batch commits all-or-nothing" cannot drift between the tiers that
 * are supposed to verify each other.
 */
export function batchRejections(
  result: { slots?: Record<string, unknown>; rejected?: RefinementRejection[] } | null | undefined,
  slotMetas: Record<
    string,
    { refine?: RefinementCheck; refineKind?: string; refineArgs?: unknown }
  >,
): RefinementRejection[] {
  const out: RefinementRejection[] = [];
  const seen = new Set<string>();
  for (const r of [
    ...(result?.rejected ?? []),
    ...refinementRejections(result?.slots ?? {}, slotMetas),
  ]) {
    if (seen.has(r.slot)) continue;
    seen.add(r.slot);
    out.push(r);
  }
  return out;
}

/** `slot "count" cannot hold 4 (between(0, 3))`. */
function describeRejection(r: RefinementRejection): string {
  const pred =
    r.kind === undefined
      ? "its refinement"
      : r.args && r.args.length > 0
        ? `${r.kind}(${r.args.join(", ")})`
        : r.kind;
  return `slot ${JSON.stringify(r.slot)} cannot hold ${showRejectedValue(r.value)} (${pred})`;
}

/**
 * Render a rejected value for the report. Bounded, because the value came from
 * app data: a `len-lt(280)` slot handed a 50 kB paste would otherwise put 50 kB
 * on one console line. `JSON.stringify` also needs help at both ends — it
 * returns undefined for a function or a bare `undefined`, throws on a cycle,
 * and renders every non-finite number as `null`, which would point a reader at
 * a missing value when the real cause is a division by zero.
 */
function showRejectedValue(value: unknown): string {
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  let shown: string;
  try {
    shown = JSON.stringify(value) ?? String(value);
  } catch {
    shown = String(value);
  }
  return shown.length > 120 ? `${shown.slice(0, 117)}...` : shown;
}

/**
 * Surface a reducer batch discarded by a refinement (runtime.md §10.3.3). Not
 * a panic — the app is untouched and still interactive — but a reducer that
 * quietly does nothing is indistinguishable from a broken selector, so it is
 * reported on the same `console.error` channel as an unhandled effect error and
 * the verification tiers (smoke / runScenario, which patch `console.error`)
 * flag it.
 */
export function reportRejectedBatch(
  reducer: string,
  rejections: readonly RefinementRejection[],
): void {
  console.error(
    `[kumiki] reducer ${JSON.stringify(reducer)} was rejected: ${rejections
      .map(describeRejection)
      .join(", ")}. No slot was written and no effect was emitted.`,
  );
}

/**
 * Apply a reducer's result and compute the `slot-diffs` an episode step needs.
 * A `volatile` slot takes its new value but is excluded from the diffs and the
 * dirty signal-update (docs/spec/language.md §1.4.1). Pure: it mutates the
 * `prev` record (the live `app.live`) in place but otherwise has no side
 * effects, so both `applyReducer` (mount) and the SSR pseudo-reducer pipeline
 * share the exact same volatile/refine semantics.
 *
 * A non-empty `rejected` means nothing was written at all — not even a volatile
 * slot, which rolls back with the rest. The batch is all-or-nothing, so the
 * caller must also drop that reducer's emits and stop-timers rather than
 * treating this as "no slots changed".
 */
export function computeSlotDiffs(
  prev: Record<string, unknown>,
  result: { slots: Record<string, unknown>; rejected?: RefinementRejection[] },
  slotMetas: Record<string, SlotMeta>,
): { diffs: SlotDiff[]; dirty: string[]; rejected: RefinementRejection[] } {
  const rejected = batchRejections(result, slotMetas);
  if (rejected.length > 0) return { diffs: [], dirty: [], rejected };
  const diffs: SlotDiff[] = [];
  const dirty: string[] = [];
  for (const [k, v] of Object.entries(result.slots)) {
    const meta = slotMetas[k];
    const before = prev[k];
    prev[k] = v;
    if (!meta?.volatile) {
      diffs.push({ name: k, before, after: v });
      dirty.push(k);
    }
  }
  return { diffs, dirty, rejected };
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

/**
 * The live mount of an `AppShape`, if it has one. A shape carries the app's
 * state, so mounting it into a second host is a second *view* of one app
 * (runtime.md §10.9.1: passing the compiled default export rather than the
 * `createApp` factory "shares one instance across all elements") — not a
 * second app. Before this, the second mount overwrote the shape's imperative
 * seams and the first host froze: its own buttons re-rendered the other one.
 *
 * `attach` adds a view to the running mount and returns that view's handle;
 * everything the app owns once — `app.init`, `app.start`, timers, the router,
 * the effect dispatcher — belongs to the first mount and is torn down when the
 * last view is disposed. Keyed by the shape, so a `createApp()` per element
 * (independent state) is unaffected.
 */
const mountedShapes = new WeakMap<AppShape, { attach: (target: HTMLElement) => MountHandle }>();

/** What a mount (or an additional view of one) gives its caller back. */
export type MountHandle = {
  dispose: () => void;
  episodes: () => ReturnType<EpisodeLogger["list"]>;
};

/**
 * Options that describe the APP rather than the host, answered before a second
 * mount of one shape is allowed to become a view of it.
 *
 * Three tiers, because they fail differently:
 *
 * - **Refused.** Honouring them would need machinery this app already has and
 *   cannot have twice. `styleRoot` / `styleHost` are the sharp one: a view in
 *   its own shadow root would paint there while every injected `<style>` —
 *   theme, animations, state blocks, motion — stayed in the first view's root,
 *   and the shadow boundary would leave it completely unstyled. Style roots are
 *   per document, not per view; an app that needs one per element needs an app
 *   per element.
 * - **Ignored, and said so.** They configure something the running app already
 *   decided. The first mount's answer stands and a warning names what was
 *   dropped, because a provider that never fires is otherwise indistinguishable
 *   from a capability that does nothing.
 * - **Silent.** The `mount` entry point supplies these itself (`tiles`,
 *   `routing`, `builtins`, …), so they arrive on every call and say nothing
 *   about the caller's intent.
 */
const VIEW_REFUSED = [
  "hydrate",
  "ssrSnapshot",
  "bootstrapEpisode",
  "styleRoot",
  "styleHost",
] as const;
const VIEW_IGNORED = [
  "providers",
  "router",
  "initialPath",
  "episodeLogger",
  "onDiagnostic",
] as const;

/**
 * Whether the caller actually asked for this option, as opposed to defaulting
 * it. An empty record or array counts as not asking — `defineKumikiElement`
 * hands `mount` a providers map on every element whether the host registered
 * one or not. Emptiness is only consulted for plain records and arrays: a
 * `ShadowRoot` has no own enumerable keys and is very much an answer.
 */
function optionGiven(value: unknown): boolean {
  if (value === undefined || value === false) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.keys(value).length > 0;
  }
  return true;
}

function rejectViewOptions(options: MountOptions): void {
  const record = options as unknown as Record<string, unknown>;
  const refused = VIEW_REFUSED.filter((k) => optionGiven(record[k]));
  if (refused.length > 0) {
    throw new Error(
      `mount: this AppShape is already mounted, so a second mount is another view of the same app (runtime.md §10.9.1). ${refused.join(", ")} cannot be given per view — it configures the app itself, which is already running. Mount a \`createApp()\` instance for an independent one.`,
    );
  }
  const ignored = VIEW_IGNORED.filter((k) => optionGiven(record[k]));
  if (ignored.length > 0) {
    console.warn(
      `kumiki: this AppShape is already mounted, so ${ignored.join(", ")} was ignored — the mount that started the app owns it. Mount a \`createApp()\` instance to give this host its own.`,
    );
  }
}

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
 *
 * Exported for the SSR pass, which is a render pass with no DOM: without the
 * bracket `currentTheme()` is null on the server and every token falls back to
 * its default, so a themed page was served with the *unthemed* spacing,
 * colours, radii and shadows and re-styled itself on hydration.
 */
export function withRenderingApp<T>(app: AppShape, fn: () => T): T {
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
 *
 * **Mounting an `AppShape` that is already mounted adds a view of it** rather
 * than starting a second app (§10.9.1) — the shape carries the state, so the
 * hosts show the same slots and initialization runs once. The options that
 * describe the app then belong to the mount that started it: some are refused
 * and some are ignored with a warning (see `VIEW_REFUSED` / `VIEW_IGNORED`),
 * `hydrate` among the refused. Pass a `createApp()` instance for an
 * independent app.
 */
export function mountCore(
  app: AppShape,
  target: HTMLElement,
  options: MountOptions = {},
): MountHandle {
  // A shape that is already mounted gets another view of the same app rather
  // than a second app. Everything below this line is the first mount's
  // business, and running it again would fire `app.init` twice, start a second
  // copy of every timer, and overwrite the seams the running views dispatch
  // through.
  const running = mountedShapes.get(app);
  if (running) {
    rejectViewOptions(options);
    return running.attach(target);
  }
  // Episode logger (§10.5). Null when the host did not opt in — every record
  // call below short-circuits via the `?.` optional chain, so the no-logger
  // path stays zero-cost.
  const episode: EpisodeLogger | null = options.episodeLogger ?? null;
  // Reconcile diagnostics — same opt-in shape as the episode logger, and built
  // once per mount so the render path only ever sees `diag?.…`.
  const diag = options.onDiagnostic ? makeReconcileDiag(options.onDiagnostic, options) : undefined;
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

  /**
   * One host this app is painted into. A shape can be mounted more than once
   * (runtime.md §10.9.1: passing the default export rather than `createApp`
   * shares one instance across every element), and everything about *where* it
   * is painted is per view — the mounted element, the tree that produced it,
   * and the node→element map the next reconcile diffs against. Everything
   * about *what* it says is shared, because the state is.
   */
  type MountView = {
    target: HTMLElement;
    /**
     * Whether this view's target already holds server HTML. The one branch it
     * gates REPLACES that HTML wholesale (§10.6.2) rather than adopting it —
     * node-preserving hydration is not implemented — so what it buys is that
     * the served DOM and the client's never end up as siblings.
     */
    hydrate: boolean;
    root: HTMLElement | null;
    /**
     * Previously rendered tile tree, kept as the "old" side of the next
     * reconcile. Cleared to null after a panic-fallback render so the following
     * pass restarts from a full mount rather than diffing against a discarded
     * tree.
     */
    tree: TileNode | null;
    map: TileElementMap;
  };
  /** What one pass produced: the tree it painted, and what it freshly built. */
  type PassResult = { tree: TileNode | null; touched: string[] };
  const newView = (into: HTMLElement, hydrate: boolean): MountView => ({
    target: into,
    hydrate,
    root: null,
    tree: null,
    map: new WeakMap(),
  });
  const ownView = newView(target, options.hydrate === true);
  const views: MountView[] = [ownView];
  /**
   * Add a view of this already-running app. It takes a host and nothing else:
   * everything else a mount can be given describes the app, which this one
   * already has — `rejectViewOptions` is what says so, before the call.
   */
  const attach = (into: HTMLElement): MountHandle => {
    const view = newView(into, false);
    views.push(view);
    registerAppRoot(into, app);
    withRenderingApp(app, () => {
      renderPass(view);
    });
    return { dispose: () => disposeView(view), episodes: () => episode?.list() ?? [] };
  };
  // #189: identifiers the most recent reconcile pass freshly built. Consumed
  // by `applyReducer` when it fires the trailing `signal-update` step so
  // `binds-updated` lists the tiles/binds the diff actually patched. Empty
  // after a full-render / panic-fallback pass (those are not a diff). With
  // several views it is all of theirs, one entry per view that touched a
  // given id: the reducer patched every view, and the sole consumer dedups.
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
    // was disposed) must not touch the DOM — each view's root has already been
    // detached by dispose()'s `replaceChildren()`, so replaceChild would throw.
    if (disposed) return;
    withRenderingApp(app, () => {
      const touched: string[] = [];
      let tree: TileNode | null = null;
      for (let i = 0; i < views.length; i++) {
        const pass = renderPass(views[i]!);
        if (i === 0) tree = pass.tree;
        touched.push(...pass.touched);
      }
      lastRenderTouched = touched;
      // Fired once from the app's tree, which every view paints from, rather
      // than from each view's pass. Repeating the call would be harmless today
      // — the diff is set-based, so a second one has nothing new to report —
      // but a view that carried its own `prevMountedTiles` would fire
      // `tile.mount(X)` once per host, and these reducers subscribe and fetch.
      syncMountedTiles(tree);
    });
  };
  // One view's render pass. `render` brackets it with `withRenderingApp` so
  // render-time app resolution (theme tokens, icon lookup — the tree is still
  // detached, so `resolveApp` cannot walk it) lands on this mount's app.
  // Returns the tree it painted, or null if it panicked.
  const renderPass = (view: MountView): PassResult => {
    const target = view.target;
    let touched: string[] = [];
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
    // Either way, `newMap` becomes `view.map` at the end of the pass so
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
    touched = [];
    try {
      renderedTree = pickRootTile(app, slotValues);
      if (view.tree && view.root) {
        // Diff path: reuse unchanged tile DOM in place, rebuild only changed
        // subtrees. `reconcileTree` returns the (possibly new) root — it can
        // differ from `view.root` if the root tile itself was rebuilt.
        try {
          const rec = reconcileTree({
            oldNode: view.tree,
            oldEl: view.root,
            oldMap: view.map,
            newNode: renderedTree,
            newMap,
            ctx: tileCtx,
            patchers: tilePatchers,
            diag,
          });
          dom = rec.el;
          touched = rec.touched;
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
          target.replaceChild(dom, view.root);
        }
      } else {
        // Initial mount, or first render after a panic reset — no old tree
        // to diff against.
        dom = tileCtx.render(renderedTree);
        if (view.root) {
          target.replaceChild(dom, view.root);
        } else if (view.hydrate && target.firstChild) {
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
      if (view.root) {
        target.replaceChild(dom, view.root);
      } else if (view.hydrate && target.firstChild) {
        target.replaceChildren(dom);
      } else {
        target.appendChild(dom);
      }
    }
    view.root = dom;
    // On panic (either the primary render threw and no route.error recovered
    // it, or the recovery render also threw), abandon the diff baseline so the
    // next render starts from a clean full mount. Otherwise carry the fresh
    // tree + map forward as the next pass's `old` side.
    view.tree = panicked ? null : renderedTree;
    view.map = newMap;

    // On the happy patch path element identity is preserved, so this `focus()`
    // degrades to a no-op — the browser cursor is already on the still-mounted
    // control. Restoration still fires unconditionally to cover: (a)
    // reconcile-bailout / panic recovery, where DOM was rebuilt wholesale; (b)
    // a keyed reorder that moves the focused element itself, which a browser
    // blurs even though its identity survives. What (b) no longer covers is a
    // focused child that a reorder left alone: the keyed pass places only the
    // children that must move (§10.3.10), so the common case reaches here with
    // the cursor never having left. The `.focus()` + setSelection calls are
    // idempotent and cheap on the happy path, so keeping the layer active is a
    // strict simplification win over per-path gating.
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

    // The tree, not "the tree if this view survived": a panic is about how a
    // view painted, and `tile.mount(X)` is about what the app is showing. When
    // this returned null on panic, every mounted tile counted as unmounted, so
    // a render panic fired `tile.unmount` for all of them — unsubscribes,
    // leave notifications, whatever those reducers do — and the recovery render
    // fired `tile.mount` right back. `view.tree` below is the separate
    // question of what the next reconcile may diff against, and that one does
    // reset on panic.
    return { tree: renderedTree, touched };
  };

  /**
   * tile.mount(X) / tile.unmount(X): walk the tree, diff against the previous
   * render's set, fire the lifecycle reducer for each newly-present / newly-
   * absent user tile (§7.1.6). The set is updated BEFORE the reducer fires so
   * a re-render kicked off by the reducer sees the post-mount snapshot — that
   * is what prevents mount events from re-firing every reducer cycle.
   */
  function syncMountedTiles(tree: TileNode | null): void {
    const nowMounted = tree ? collectMountedTiles(tree) : new Set<string>();
    if (nowMounted.size === 0 && prevMountedTiles.size === 0) return;
    const toMount: string[] = [];
    const toUnmount: string[] = [];
    for (const n of nowMounted) if (!prevMountedTiles.has(n)) toMount.push(n);
    for (const n of prevMountedTiles) if (!nowMounted.has(n)) toUnmount.push(n);
    prevMountedTiles = nowMounted;
    for (const n of toMount) fireLifecycle(`tile.mount(${JSON.stringify(n)})`);
    for (const n of toUnmount) fireLifecycle(`tile.unmount(${JSON.stringify(n)})`);
  }

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
    // Compute slot diffs (excluding `volatile` slots per language.md §1.4.1):
    // shared with the SSR pseudo-reducer pipeline so volatile semantics never
    // drift across the hydration boundary.
    const { diffs, dirty, rejected } = computeSlotDiffs(slotValues, result, app.slots);
    if (rejected.length > 0) {
      // §10.3.3: a refinement rejects the whole batch, not just its own slot.
      // Nothing was written, so the emits and stop-timers that batch produced
      // must not run either — they were computed from state that never became
      // real. The reducer is still logged (it did run, and changed nothing) so
      // a replay does not show a trigger with no reducer under it.
      reportRejectedBatch(r.name, rejected);
      episode?.recordReducer(r.name, [], []);
      if (opened) episode?.endTrigger();
      return;
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
  lastAppliedThemeName = resolvedThemeName(app) ?? null;

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
  // Registered here rather than beside `views`, because everything between the
  // two can throw — `hydrate` without a bootstrap episode is a public call that
  // does. A record left behind by a mount that never finished would turn every
  // later `mount(app, …)` into a view of a half-built app: no `app.init`, no
  // timers, no router, and no handle in anyone's hands to dispose it with.
  mountedShapes.set(app, { attach });
  /**
   * Drop one view. The app itself — timers, router, host listeners, the effect
   * dispatcher — outlives it as long as another view is painting; the last one
   * out turns off the lights, and un-registers the shape so a later `mount`
   * starts it over. `app.live` is the shape's own and is deliberately left
   * alone: what a later mount gets is a running app again, not a reset one —
   * `createApp()` is what returns a shape at its declared defaults.
   */
  function disposeView(view: MountView): void {
    const at = views.indexOf(view);
    if (at === -1) return;
    views.splice(at, 1);
    view.target.replaceChildren();
    unregisterAppRoot(view.target, app);
    if (views.length > 0) return;
    disposed = true;
    for (const h of anonTimers) clearInterval(h);
    for (const h of namedTimers.values()) clearInterval(h);
    namedTimers.clear();
    routerUnsub?.();
    for (const unsub of lifecycleUnsubs) unsub();
    dispatcher.dispose();
    mountedShapes.delete(app);
  }
  return {
    dispose: () => disposeView(ownView),
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
  // `policy=queue` (§10.4.3): one chain per effect id. `tail` is the promise
  // every new dispatch appends to, so at most one invocation of that id is in
  // flight; `pending` is the entries that have not started yet, which is what
  // `dispose()` has to release — each already claimed an episode token.
  type QueueEntry = { token: string; effectName: string };
  type Queue = { tail: Promise<void>; pending: QueueEntry[] };
  type RunState = {
    inflight: Map<string, AbortController>;
    timers: Map<string, TimerEntry>;
    onceSeen: Map<string, Set<string>>;
    queues: Map<string, Queue>;
  };
  const state: RunState = {
    inflight: new Map(),
    timers: new Map(),
    onceSeen: new Map(),
    queues: new Map(),
  };

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
          // A queued entry that has not started is the same pending launch as
          // a debounce timer: it holds an episode token and would run after
          // the user pressed Cancel unless it is released here.
          const q = state.queues.get(target);
          if (q) {
            const waiting = q.pending.splice(0, q.pending.length);
            for (const e of waiting) {
              if (e.token) onPolicyCancel?.(e.token, e.effectName);
            }
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
      if (policy.kind === "queue") {
        // Claim the episode token NOW, like the debounce branch: this launch
        // happens when the ones before it finish, and a token taken then would
        // attach the effect-start to whatever episode is on top by that point
        // rather than to the one that emitted (spec §10.5.1).
        const token = onLaunch?.(eff.name, input) ?? "";
        const entry: QueueEntry = { token, effectName: eff.name };
        const q = state.queues.get(id) ?? { tail: Promise.resolve(), pending: [] };
        q.pending.push(entry);
        const runNext = async (): Promise<void> => {
          const idx = q.pending.indexOf(entry);
          // Gone from `pending` means something already released this entry's
          // token — `dispose()`, or a cancel by id — so there is nothing left
          // to run.
          if (idx === -1) return;
          q.pending.splice(idx, 1);
          await launch(eff, input, key, token);
        };
        // Both arms, so a rejection anywhere in the chain does not skip every
        // later `onFulfilled` — that would leave this id's queue dead for the
        // rest of the mount, with each stranded entry still holding the
        // episode token it claimed.
        //
        // No test reaches it: `launch` catches its own failures, and every
        // caller between here and it does too, so there is no path today that
        // rejects. It stays because the alternative is a policy whose failure
        // mode is silent and permanent, resting on a property of code three
        // layers away that nothing states.
        q.tail = q.tail.then(runNext, runNext);
        state.queues.set(id, q);
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
      // Queued launches that never started hold a claimed effect-start on an
      // episode that has already closed — the same debt the debounce drain
      // above settles. Clearing `pending` is also what tells the chained thunk
      // not to run.
      for (const q of state.queues.values()) {
        const waiting = q.pending.splice(0, q.pending.length);
        for (const e of waiting) {
          if (e.token) onPolicyCancel?.(e.token, e.effectName);
        }
      }
      state.queues.clear();
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

/**
 * Surface an effect `err` result that no `.err` reducer consumes. A failed
 * capability must never fail silently — the storage-unavailable case (sandbox /
 * private mode) otherwise looks like the app does nothing. Reported via
 * console.error so the verification tiers (smoke / runScenario, which patch
 * console.error) flag it. Production noise is the app's own choice: wire an
 * `.err` reducer to handle (or deliberately ignore) the error.
 */
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
      // Last, so a tile's own `class` / `aria` / `role` / `id` and everything
      // its style props say reach every kind without each renderer repeating
      // it — including host-registered kinds (#71), which no renderer here can
      // reach, and the kinds whose renderers style nothing (an `image`, a
      // `button`), where a `max-w` used to be dropped on the floor. It runs
      // after the motion classes for the same reason it adds rather than
      // assigns: the runtime owns classes on this element too.
      applyCommonProps(el, node.props);
      setDecls(el, propStyleDecls(node.props, pickForViewport, node.kind));
      map.set(node, el);
      return el;
    },
  };
  return ctx;
}

/**
 * Reports the walker's identity-losing decisions to the host's `onDiagnostic`.
 * Built once per mount by `makeReconcileDiag`; the render path holds it as an
 * optional value so a mount without a sink runs the pre-existing code plus one
 * `?.` check per fallback.
 */
type ReconcileDiag = {
  fallback: (fallback: ReconcileFallback, node: TileNode) => void;
  /**
   * Called on the unequal decision — the props differed, so this tile is about
   * to be patched or rebuilt. Names the fields that will differ again on every
   * render after this one. Only host-registered kinds are inspected.
   */
  neverEqual: (oldNode: TileNode, newNode: TileNode) => void;
};

function makeReconcileDiag(
  report: (d: RuntimeDiagnostic) => void,
  options: MountOptions,
): ReconcileDiag {
  const hostKinds = options.hostTileKinds?.length ? new Set(options.hostTileKinds) : undefined;
  const authored = (node: TileNode): string | undefined => {
    const name = (node as { props?: Record<string, unknown> }).props?._tile;
    return typeof name === "string" ? name : undefined;
  };
  // A diagnostic must never be able to change the render it is observing. The
  // walker runs inside the reconcile bailout's try/catch, so a host sink that
  // throws would otherwise be recorded as a reconcile panic and trigger a
  // full-tree rebuild — the exact identity loss this channel exists to report,
  // caused by the reporting itself. The sink's own failures are the host's to
  // notice; swallowing them here keeps the app correct.
  const emit = (d: RuntimeDiagnostic): void => {
    try {
      report(d);
    } catch {
      // deliberately ignored — see above
    }
  };
  /**
   * One per-field host-tile scan, run so it cannot disturb the render it is
   * observing. `hazard` looks at a single old/new pair and returns what to
   * report about it, if anything.
   *
   * The guard covers the whole walk, not just the sink. Reading a host node's
   * fields is not inert: `Object.keys`, a property getter and
   * `Object.getPrototypeOf` all run against values the host owns, and a Proxy
   * trap or an accessor may throw where the equality kernel — which
   * short-circuits at the first difference — never reached. That throw would
   * land in the reconcile bailout as a `location: "reconcile"` panic and
   * rebuild the whole tree, so the observation would inflict the exact identity
   * loss this channel exists to report. Abandoning the scan is the only outcome
   * that leaves the render alone.
   */
  const scan = (
    oldNode: TileNode,
    newNode: TileNode,
    hazard: (
      site: DiagnosticSite,
      field: string,
      oldValue: unknown,
      newValue: unknown,
    ) => RuntimeDiagnostic | undefined,
  ): void => {
    if (!hostKinds?.has(newNode.kind)) return;
    try {
      const site: DiagnosticSite = {
        tileKind: newNode.kind,
        id: tileTouchedId(newNode),
        tile: authored(newNode),
      };
      for (const [field, oldValue, newValue] of ownFieldPairs(oldNode, newNode)) {
        const d = hazard(site, field, oldValue, newValue);
        if (d) emit(d);
      }
    } catch {
      // deliberately ignored — see above
    }
  };
  return {
    fallback(fallback, node) {
      emit({
        kind: "reconcile-fallback",
        tileKind: node.kind,
        id: tileTouchedId(node),
        tile: authored(node),
        ...fallback,
      });
    },
    neverEqual(oldNode, newNode) {
      scan(oldNode, newNode, (site, field, oldValue, newValue) => {
        const cause = neverEqualCause(oldValue, newValue);
        return cause ? { ...site, kind: "never-equal-prop", field, cause } : undefined;
      });
    },
  };
}

/**
 * Own data fields paired old-to-new, one level deep into `props` — where a
 * renderer's handlers and data conventionally live (`props.onClick`,
 * `props.value`). Feeds the host-tile `never-equal-prop` scan.
 *
 * This is NOT the full set `tileFieldsEqual` compares: that one recurses to
 * the bottom of arrays and nested objects, while this stops at `props.x` on
 * purpose. A value buried deeper than that is past the point where a generic
 * warning helps, and the shallow walk keeps the scan bounded — it runs per
 * decision, on the render path.
 */
function* ownFieldPairs(
  oldNode: TileNode,
  newNode: TileNode,
): Generator<[string, unknown, unknown]> {
  const oa = oldNode as unknown as Record<string, unknown>;
  const ob = newNode as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(oa), ...Object.keys(ob)])) {
    if (TILE_SKIP_TOP.has(k)) continue;
    if (k === "props") {
      const pa = (oa.props ?? {}) as Record<string, unknown>;
      const pb = (ob.props ?? {}) as Record<string, unknown>;
      for (const pk of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
        yield [`props.${pk}`, pa[pk], pb[pk]];
      }
      continue;
    }
    yield [k, oa[k], ob[k]];
  }
}

function reconcileTree(args: {
  oldNode: TileNode;
  oldEl: HTMLElement;
  oldMap: TileElementMap;
  newNode: TileNode;
  newMap: TileElementMap;
  ctx: TileCtx;
  patchers: TilePatchers;
  diag?: ReconcileDiag | undefined;
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
    args.diag,
  );
  return { el, touched };
}

/**
 * Reconciles one mounted tile against its next render and returns **the element
 * that now occupies this node's slot** — `oldEl` when the tile was reused or
 * patched in place, a fresh element when the subtree was rebuilt.
 *
 * **Who owns placement.** A rebuilt subtree is spliced into the live DOM by
 * `replaceWithFreshTile`, anchored on the OLD element's own parent. That is
 * deliberate and not an implementation detail the caller may work around: where
 * a child element sits is decided by the parent tile's *renderer*, not by this
 * walker. `overlay` puts every child after the first in a positioning layer,
 * and a host renderer may wrap arbitrarily — so the anchor is whatever node
 * actually holds the slot, which is not necessarily the parent tile's element.
 *
 * A caller may therefore only place the returned element itself when it has
 * established that it owns the slots. Exactly one does — `reconcileKeyedChildren`,
 * behind the `firstWrappedChild` gate.
 */
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
  // Different kind → whole subtree is a different thing. Build fresh, splice.
  if (oldNode.kind !== newNode.kind) {
    return replaceWithFreshTile(oldEl, newNode, ctx, touched);
  }
  // Same kind, differing own data props (`children` / `key` excluded — see
  // `TILE_SKIP_TOP` / `tileValueEqual`). #190 identity-
  // preserving path: if a per-kind patcher is registered, mutate the mounted
  // element in place (preserving `<select>` open state / focus / caret /
  // `<video>` playback / `<details>` open / `contenteditable`), then continue
  // into the children walk below so container-shaped changes still reconcile.
  // Without a patcher, fall back to the full subtree rebuild (correct but
  // discards browser-internal state — pre-#190 behaviour).
  if (!tileFieldsEqual(oldNode, newNode)) {
    // Why they differed, when the answer is "they always will". Before the
    // patcher lookup on purpose: with a patcher this is the ONLY signal that
    // the tile re-applies its props forever (the patch path is otherwise a
    // silent success), and without one it names the field `no-patcher` cannot.
    // Cause before consequence, so a reader meets the fixable fact first.
    diag?.neverEqual(oldNode, newNode);
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
      // The common props and the prop-derived style are applied outside the
      // per-kind renderers, so no patcher re-applies them; without this a
      // `class` bound to a slot keeps the token it was first rendered with,
      // and a `max-w` that went away stays on the element.
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
      // Fall through to the children reconcile below — a container tile may
      // have both attribute AND child changes in the same render.
    } else {
      diag?.fallback({ reason: "no-patcher" }, newNode);
      return replaceWithFreshTile(oldEl, newNode, ctx, touched);
    }
  }
  // No `else`: when every own field compares equal the element stays mounted
  // untouched, and that is unconditionally safe — handlers compare by identity
  // (§10.3.13), so reaching here means the mounted element already holds the
  // handlers this render produced.
  const oldChildren = getTileChildren(oldNode);
  const newChildren = getTileChildren(newNode);
  if (oldChildren.length === 0 && newChildren.length === 0) {
    newMap.set(newNode, oldEl);
    return oldEl;
  }
  if (oldChildren.length === 0 || newChildren.length === 0) {
    return adoptFreshChildren(oldEl, newNode, newChildren, ctx, newMap, touched);
  }
  // Keyed path — all-or-nothing per parent. When every child on both sides
  // carries a `key`, we match children by key across renders and survive
  // reorder / insert / remove without rebuilding the subtree. Mixed or
  // absent keys fall through to the structural walk below.
  //
  // Second condition: that pass MOVES and REMOVES child elements addressed
  // against `oldEl`, and MOUNTS newcomers there, so it may only run when
  // `oldEl` is the node that actually holds those slots. A renderer that wraps
  // its children owns their placement and the walker must not reach past it.
  if (allChildrenKeyed(oldChildren) && allChildrenKeyed(newChildren)) {
    const decision = decideKeyedPass(oldEl, newNode, oldChildren, newChildren, oldMap);
    if (!decision.run) {
      diag?.fallback(decision.fallback, newNode);
      // Fall through to the structural walk: it never repositions anything, so
      // it stays correct under a wrapping renderer. When the length also
      // changed it then rebuilds the parent and reports `child-count-change`
      // on top — two diagnostics for one parent, naming two different facts
      // (the keys went unused; the rebuild happened anyway).
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
  // Structural length change without keys → subtree rebuild. Preserves
  // correctness at the cost of reuse; keyed children above lift this
  // restriction when the compiler emits identity.
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
  // Same length: pair the children by position and reconcile each pair. Both
  // ways this can fail are settled for the WHOLE list first, so the walk that
  // follows either runs to the end or never starts.
  const resolved = resolvePositionalChildren(oldChildren, newChildren, oldMap);
  if (!resolved.paired) {
    diag?.fallback(resolved.fallback, newNode);
    return replaceWithFreshTile(oldEl, newNode, ctx, touched);
  }
  for (const pair of resolved.pairs) {
    // The returned element is deliberately discarded: on this path no child
    // ever changes slot, so there is nothing for the parent to place. A
    // rebuilt child was already spliced into the slot it held — by
    // `replaceWithFreshTile`, anchored on `pair.oldEl.parentNode`, which is
    // the only node that knows where the slot is when the renderer wraps its
    // children. Re-inserting it here against `oldEl` would be wrong for
    // exactly those renderers. `newMap` is likewise populated inside the call.
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
  // An empty list never reaches here — `reconcileNode` peels both the
  // both-empty and the one-side-empty cases off ahead of the keyed gate — so
  // the `false` below is about totality, not about a decision.
  if (nodes.length === 0) return false;
  for (const n of nodes) if (!n || typeof n.key !== "string") return false;
  return true;
}

/**
 * Rebuild the interior of a tile whose child list is empty on exactly one side
 * of this render, keeping the mounted element itself.
 *
 * With one side empty there is nothing to match — not by key, not by position.
 * Every new child is a fresh mount and every old child departs, so the only
 * question left is WHERE the new children go, and that answer belongs to the
 * parent's renderer: `overlay` wraps every child after the first in a
 * positioning layer, the surfaces wrap all of theirs in a content div, and a
 * host renderer may wrap arbitrarily. `firstWrappedChild` normally answers it
 * by looking at where the mounted children sit — but with none left it has
 * nothing to testify with, and appending the newcomers straight onto `oldEl`
 * would strip a wrapping renderer's structure.
 *
 * So re-enter the renderer for the whole node and move only its interior into
 * the element we are keeping. The result is what a full render would have
 * produced, minus the one thing this exists to save: the parent's own element,
 * with the browser-owned state and listeners it was mounted with. The
 * decision needs no key on either side, because keys had nothing to match.
 *
 * Known limitation: a renderer's non-child interior is rebuilt too (`details`'
 * `<summary>`, a surface's content wrapper and title). That is strictly less
 * than the whole-parent rebuild this replaces, but it is not nothing — the
 * complete answer is a `ctx` seam that lets a renderer refill its own child
 * slots, which does not exist yet.
 */
function adoptFreshChildren(
  oldEl: HTMLElement,
  newNode: TileNode,
  newChildren: TileNode[],
  ctx: TileCtx,
  newMap: TileElementMap,
  touched: string[],
): HTMLElement {
  // Render BEFORE touching `oldEl`: a renderer that throws must leave the
  // mounted element exactly as it was, so the only thing that rewrites the DOM
  // is the outer bailout's full rebuild.
  const fresh = ctx.render(newNode);
  oldEl.replaceChildren(...Array.from(fresh.childNodes));
  // `ctx.render` mapped `newNode` onto the element we just discarded; the
  // descendants it mapped are the ones we adopted, so only this entry is wrong.
  newMap.set(newNode, oldEl);
  if (newChildren.length === 0) {
    // Per-child would report nothing at all for a render that visibly emptied
    // the DOM. The parent is what changed, and it is what the rebuild path this
    // replaces used to name.
    touched.push(tileTouchedId(newNode));
  } else {
    // Same granularity as a keyed fresh insert: each new child is the root of a
    // subtree that was just mounted.
    //
    // An empty slot is skipped rather than reported. The positional walk emits
    // `child-hole` because a hole desynchronises it from the old list and costs
    // a rebuild — here the whole list went through the renderer, which drops
    // nils itself, so nothing was lost and there is no fallback to name. What a
    // hole means for this loop is only that no element was mounted for it, and
    // therefore that it has nothing to contribute.
    for (const child of newChildren) if (child) touched.push(tileTouchedId(child));
  }
  return oldEl;
}

/**
 * Built-in kinds whose renderer does NOT place every child directly under the
 * element it returns. `overlay` puts child[0] in normal flow and wraps the rest
 * in absolutely-positioned layers; `modal` / `drawer` / `popover` wrap all of
 * theirs in a content div beside the surface's own chrome.
 *
 * This is a declaration rather than a measurement because a measurement can
 * only speak for slots that already exist (see `keyedPassBlocker`), and only
 * `overlay` actually needs it — a renderer that wraps EVERY child is caught by
 * the measurement as soon as one is mounted. The other three are listed anyway
 * so the set means what it says, which is what lets it be checked against the
 * DOM those renderers produce.
 *
 * Host renderers are absent on purpose: §10.3.10 asks them to place their
 * children directly under the element they return, so an unknown kind is taken
 * at its word — declining for every unknown kind would cost every well-behaved
 * host integration its keyed inserts. A host renderer shaped like `overlay`
 * (first child direct, rest wrapped) is therefore the one remaining blind spot,
 * and it needs a seam of its own rather than a guess here.
 *
 * Frozen because it is exported: the reconcile path reads it on every keyed
 * render under a wrapping parent, and a caller mutating it would silently
 * redefine the contract.
 */
export const WRAPPING_TILE_KINDS: readonly string[] = Object.freeze([
  "overlay",
  "modal",
  "drawer",
  "popover",
]);

const WRAPPING_TILE_KIND_SET: ReadonlySet<string> = new Set(WRAPPING_TILE_KINDS);

/**
 * Either the keyed child pass may run for this parent, with every old child's
 * live element resolved for it, or the reason it may not. Shaped as a union
 * rather than an optional blocker so the pass cannot be entered without the
 * elements the decision already had to look up.
 */
type KeyedPassDecision =
  | { readonly run: true; readonly oldEls: readonly HTMLElement[] }
  | { readonly run: false; readonly fallback: ReconcileFallback };

/**
 * Whether the keyed child pass may run for this parent, and what it needs if it
 * may. Two independent things can stand in its way, and they answer different
 * questions:
 *
 * - **Where the mounted children are.** Measured, because the DOM knows.
 *   Survivors are moved and departures removed by addressing `parentEl`, so a
 *   child mounted below a renderer-owned wrapper puts the whole pass out of
 *   reach.
 * - **Where a newcomer would go.** Declared, because nothing can measure a slot
 *   that does not exist yet. `overlay` places its first child directly, so a
 *   one-child overlay measures as fully placeable right up until it grows — and
 *   the keyed pass would then append the second child bare, with no layer
 *   around it and no complaint.
 *
 * The declaration only bites when there IS a newcomer: a render that keeps the
 * same membership has nothing to place, so it still takes the keyed path.
 *
 * Between the two sits a question that is not a reason to decline at all: an
 * old child with no entry in the element map is a broken invariant, and it
 * throws. It is answered HERE, the moment the measurement has let the list
 * through, because the measurement is what steps over such a child — deciding
 * it is not a placement style — and a later decline would inherit that silence
 * and hand the child to the structural walk, where only an opted-in host would
 * ever hear about it. Before anything is applied either way, so a throw leaves
 * the parent exactly as the render found it.
 */
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
      // Invariant violation — an old keyed tile should always be in the element
      // map because every tile passes through `makeMappingTileCtx`. Throw so the
      // outer reconcile bailout records this as a panic, audible to a host that
      // never opted into a diagnostic sink, rather than silently forcing a
      // subtree rebuild (which would erase focus, scroll, and any other DOM
      // state on the whole parent).
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

/**
 * The two ways positional pairing can fail. Spelled as the subset of
 * `ReconcileFallback` this decision can actually produce, so the return type
 * says which reasons a caller has to be ready for.
 */
type PositionalChildFallback = Extract<
  ReconcileFallback,
  { reason: "child-hole" | "child-unmapped" }
>;

/** Either the whole child list paired up, or the reason none of it did. */
type PositionalChildResult =
  | { readonly paired: true; readonly pairs: readonly PositionalChildPair[] }
  | { readonly paired: false; readonly fallback: PositionalChildFallback };

/**
 * Pair an equal-length child list by position — every pair, or none of them
 * and the reason the parent must be rebuilt instead.
 *
 * **The parent's fate is settled here, before any of the list is applied.**
 * The walk that consumes these pairs patches elements in place, rebuilds
 * subtrees, and records an identifier per subtree it touched. A parent that
 * gave up partway would be rebuilt on top of work already done, and the
 * identifiers of the children it discarded would outlive them — so both
 * give-up conditions are answered for the whole list first. A parent that
 * rebuilds therefore leaves nothing behind about this subtree: no DOM change,
 * no `touched` identifier, no `newMap` entry, and no diagnostic from any child
 * (§10.3.12). What the episode log and the diagnostics describe is the render
 * that happened.
 *
 * The `newMap` half of that is a property of this function, not of the
 * renderers. A rebuild does re-map the same child nodes when the renderer
 * routes them through `ctx.render` — but a host renderer is never asked to,
 * so the walker must not need it, and it does not: there is nothing written
 * for a rebuild to overwrite.
 *
 * The pairing asks the same two questions at every index, in index order,
 * which is what fixes the evidence a bail carries: the `index` it names, and
 * for `child-unmapped` the kind of the child whose element went missing.
 */
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
    // The one source of `child-unmapped`: a host renderer built this child
    // without going through `ctx.render`, which is what records the mapping.
    // What cannot be found cannot be reused, so the parent rebuilds — on this
    // render and on every later one that renderer produces.
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

/**
 * The first new child whose key no old sibling carries — the newcomer that the
 * keyed pass would have to mount, and therefore the one thing it needs a slot
 * for that no mounted child can vouch for. `undefined` means this render only
 * moves and drops children that already exist, which addresses slots the parent
 * demonstrably holds.
 */
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

/**
 * The first old child mounted somewhere other than directly under `parentEl` —
 * the signal that the parent's renderer owns its children's placement and the
 * keyed pass must not reach past it. `undefined` means every child sits in a
 * slot `parentEl` can address, so moving and removing them there is sound.
 *
 * A child with no entry in the map is NOT treated as blocking. That is a
 * broken invariant, not a placement style, so `decideKeyedPass` throws on it
 * the moment this scan comes back clean — for the children it would have reused
 * and the ones it would have removed alike, and before any later reason to
 * decline can be reached. The reconcile bailout then records a panic, visible
 * without a diagnostic sink. Diverting it to the structural walk would trade
 * that for a `child-unmapped` only an opted-in host ever sees.
 */
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

/**
 * Keyed child reconcile — mutates `parentEl` in place to match `newChildren`.
 *
 * **Precondition, enforced by the caller.** Every old child's element is a
 * direct child of `parentEl` (`firstWrappedChild` gates this). The
 * moves and removals below address `parentEl` itself, so under a renderer that
 * wraps its children they would tear elements out of their wrappers and strand
 * the emptied wrappers. Fresh mounts have the same limit from the other side:
 * `ctx.render` returns a bare child element and only the renderer knows what
 * to wrap it in.
 *
 * Strategy: (1) build key→oldChild lookup, (2) for each new child either
 * reconcile against its keyed old counterpart or mount fresh, (3) drop
 * unmatched old children from the DOM, (4) place the children that are not
 * already where they belong. `unmount` / `mount` lifecycle firing is
 * centralised in the outer render pass so no per-node hooks are needed here.
 *
 * **The placement step touches the minimum.** Replaying the whole target
 * sequence with `appendChild` also produces the right order and is one line, but
 * it detaches and re-attaches every child on every render that reaches here —
 * including a render where nothing moved. Re-attaching a node blurs it, and focus, the
 * caret, an open `<select>` and an in-flight IME composition are exactly the
 * state this path exists to keep. So the survivors whose relative order already
 * matches — the longest increasing run of their old positions — stay untouched,
 * and everything else is inserted against its successor. A stable list costs
 * nothing; one item moving costs one move.
 *
 * Throws — never silently falls back — on duplicate sibling keys, and passes on
 * anything a DOM operation here rejects. The outer reconcile bailout catches the
 * throw, records the panic, and does a full rebuild so the failure is visible in
 * the episode log rather than silently degrading DOM state. The other invariant
 * a keyed list can break — an old child with no element mapping — is settled by
 * `decideKeyedPass` before this is entered, which is why `oldEls` arrives
 * resolved rather than being looked up per use.
 */
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
  // The node the mounted child list ends against. Everything this pass places
  // goes BEFORE it, so a renderer that keeps content of its own after its
  // children keeps it there — `appendChild` would walk the children past it.
  //
  // Read here, before anything is applied, because this is the last moment the
  // children's DOM order is known to match `oldChildren`: from the next loop on,
  // `replaceWithFreshTile` may swap a child's element and the removal pass drops
  // the departures. Taken from the LAST old child, the anchor is never a child
  // itself, so neither of those can invalidate it.
  const tailAnchor = childListEnd(oldEls);
  const byKey = new Map<string, { node: TileNode; index: number }>();
  for (let i = 0; i < oldChildren.length; i++) {
    const oc = oldChildren[i] as TileNode;
    if (typeof oc.key === "string") byKey.set(oc.key, { node: oc, index: i });
  }
  const targetEls: HTMLElement[] = [];
  // Per new child, the position its match held in the old list — `-1` for a
  // newcomer. This is what says which survivors are already in relative order.
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
      // The rebuilt element `reconcileNode` may hand back was spliced into the
      // slot the old one held, so a survivor's DOM position is its old index
      // either way.
      oldIndexOf.push(pairing.index);
    } else {
      // Fresh mount: `ctx.render` records the new node → element mapping into
      // newMap via `makeMappingTileCtx`, so the next pass sees this child in
      // its map lookup.
      touched.push(tileTouchedId(newChild));
      targetEls.push(ctx.render(newChild));
      oldIndexOf.push(-1);
    }
  }
  // Remove unmatched old children from the DOM before placing anything. This is
  // not load-bearing for the result — no departure can ever be an anchor, since
  // an anchor is either another entry of `targetEls` or the node the list ends
  // against — but it means the placement pass runs against the final membership,
  // so "insert before the child that follows it" is true of the DOM and not only
  // of the target array. `tile.unmount(X)` lifecycle firing is name-based and
  // driven by the outer render pass's tree walk, so no per-node unmount hook
  // here.
  //
  // Removed unconditionally: that the element exists was settled by
  // `decideKeyedPass`, and that `parentEl` is the node holding it by the
  // `firstWrappedChild` gate, which declines this whole pass for any mapped old
  // child sitting elsewhere. Nothing this pass does itself can undo either —
  // reconciling a survivor only ever splices within that survivor's own slot.
  // Host code runs in between (a patcher, and a newcomer's renderer), and it
  // could reach anywhere; if it ever moved a departure out, `removeChild`
  // throws that onto the same panic path, where the guard this replaces would
  // have left the departure mounted for good.
  for (let i = 0; i < oldChildren.length; i++) {
    if (matched.has(oldChildren[i] as TileNode)) continue;
    parentEl.removeChild(oldEls[i] as HTMLElement);
  }
  const stays = childrenAlreadyInOrder(oldIndexOf);
  // Right to left, so the anchor for each placement — the child that follows it
  // — is already final: it either never moved, or it was placed one step ago.
  // `insertBefore(el, null)` appends, which is what the last child gets when the
  // parent keeps nothing after its children.
  for (let i = targetEls.length - 1; i >= 0; i--) {
    if (stays.has(i)) continue;
    parentEl.insertBefore(targetEls[i] as HTMLElement, targetEls[i + 1] ?? tailAnchor);
  }
}

/**
 * The node the mounted child list ends against — the first sibling after the
 * last old child, or `null` when the children run to the end of their parent.
 * Inserting before it keeps the list where the renderer put it.
 *
 * Reads from the LAST old child on purpose: whatever follows it is by
 * definition not one of the children, so no rebuild or removal in this pass can
 * turn the anchor into a stale reference.
 *
 * Takes the resolved elements rather than the nodes and the map, so there is no
 * unmapped child to search past: an old child list that reaches here has one
 * element each, and every one of them sits directly under the parent.
 *
 * Never called with an empty list — `reconcileNode` peels off a child list that
 * is empty on either side before the keyed gate — so there is no "no children
 * to anchor on" case to answer. Answering one with `null` would mean appending,
 * which is the one thing this exists to avoid.
 */
function childListEnd(oldEls: readonly HTMLElement[]): ChildNode | null {
  return (oldEls[oldEls.length - 1] as HTMLElement).nextSibling;
}

/**
 * The positions in the new child list that need no DOM placement: the survivors
 * whose old positions already ascend, taken as the longest such run so that the
 * fewest children are left to move. Newcomers (`-1`) are never in the set —
 * they are not mounted yet, so they always need placing.
 *
 * Any increasing run would be correct; the LONGEST one is what makes the move
 * count minimal, and computing it is the whole reason this is not a sweep.
 * Patience sorting, O(n log n): `runEnds[l]` holds the index of the smallest
 * tail among the increasing runs of length `l + 1` seen so far, and `predecessor`
 * threads each element back through the run it extended.
 */
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
  // Already in order — every survivor stays, and the search below would only
  // arrive at the same answer more slowly. This is the shape of a list that is
  // re-rendered because something else changed, which is most of them.
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
  // No parent → the caller's `oldEl` is detached from the live tree. If we
  // silently returned `fresh` the caller would install a floating subtree as
  // the view's root and every subsequent `_rerender` would run against DOM the
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

/**
 * Functions are compared by identity here, like every other value.
 *
 * They were once exempt — any two functions counted as equal — because codegen
 * minted a fresh closure per render, so identity comparison would have marked
 * every interactive tile as changed forever. That was sound only while both
 * closures dispatched to the same reducer. A conditional swapping two inline
 * tiles that differ *only* in their handler reused the element untouched and
 * kept dispatching to the reducer it was created with, silently.
 *
 * Codegen memoises one closure per reducer list, so an unchanged handler is the
 * same reference and still takes the reuse fast path. A host that mints one per
 * render pays a patch — or, with no patcher registered, a rebuild — and is told
 * so through `never-equal-prop` / `function-identity`.
 */
function tileValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!tileValueEqual(a[i], b[i])) return false;
    return true;
  }
  // Only plain data bags are compared key-wise. Anything exotic (Date, Map,
  // Set, RegExp, DOM node, class instance) holds its state OUTSIDE its own
  // enumerable keys, so the comparison below would see two empty bags and
  // report a changed value as unchanged — the worst outcome for this
  // predicate, since it leaves a stale element mounted with no symptom. The
  // compiler emits only plain data, so this is unreachable from a `.kumiki`
  // source; a host renderer that smuggles one in gets a rebuild rather than
  // silent reuse.
  if (!isPlainDataBag(a) || !isPlainDataBag(b)) return false;
  const oa = a as Record<string, unknown>;
  const ob = b as Record<string, unknown>;
  const keys = new Set<string>([...Object.keys(oa), ...Object.keys(ob)]);
  for (const k of keys) if (!tileValueEqual(oa[k], ob[k])) return false;
  return true;
}

/**
 * An object whose entire state IS its own enumerable properties, so key-wise
 * comparison is complete. Object literals — what codegen and `JSON.parse`
 * produce — qualify via `Object.prototype`, and `Object.create(null)` bags via
 * the null prototype; anything else does not.
 *
 * The prototype identity is realm-local, so a plain object built in another
 * realm (an `<iframe>`, a `vm` context) is treated as exotic and rebuilds. That
 * is the safe direction and deliberately not "fixed" with a `toString` tag
 * check, which would let a genuinely exotic cross-realm value back through.
 */
function isPlainDataBag(v: object): boolean {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Why `tileValueEqual` had to call this pair unequal, when the answer is "it
 * always will". Mirrors that predicate's branch order, and answers only for the
 * cases where a structurally identical counterpart would fare no better — a
 * genuine value change is not this function's business.
 *
 * Read by the `never-equal-prop` diagnostic, so it runs only for a mount that
 * opted into `onDiagnostic` AND declared the kind in `hostTileKinds`.
 */
function neverEqualCause(a: unknown, b: unknown): NeverEqualCause | undefined {
  // Two NaNs describe the same failed computation and still compare unequal —
  // no later branch rescues them, since `typeof NaN` is neither function nor
  // object. Checked before `===` because `NaN === NaN` is already false.
  if (Number.isNaN(a) && Number.isNaN(b)) return "nan";
  // The same instance handed over twice compares equal through `===`. Only a
  // value rebuilt per render is a hazard, so a stable one is not reported.
  if (a === b) return undefined;
  // Two different functions. The kernel compares these by identity (a handler
  // that changed is a real change), so a per-render closure makes this tile
  // unequal to itself forever.
  if (typeof a === "function" && typeof b === "function") return "function-identity";
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return undefined;
  // The kernel takes arrays element-wise, so an array is not itself a
  // never-equal value. Descending into one to find an exotic element is the
  // deep walk this scan deliberately does not do (see `ownFieldPairs`).
  if (Array.isArray(a) || Array.isArray(b)) return undefined;
  // BOTH sides exotic: two counterparts describing the same thing that the
  // kernel still has to call unequal. One side exotic and the other a plain bag
  // is an ordinary type change — it reports on the following render, when both
  // sides are exotic, which is one render late but never wrong.
  if (!isPlainDataBag(a) && !isPlainDataBag(b)) return "non-plain-object";
  return undefined;
}

// Per-element slot for the universally-lifted UI handlers (onKeyDown /
// onMouseEnter / onFocus / onBlur). Same pattern as tiles-input.ts INPUT_STATE
// and tiles-text.ts LINK_STATE: native listeners are registered once at
// create-time and dispatch through the slot; `refreshUiHandlerSlot` overwrites
// the slot when a patch runs so the new node's handler + `el` payload reach
// subsequent events. Without it, `applyUiEventHandlers` would close over the
// create-time `props`: the patch path exists precisely so a changed handler
// lands on an element that keeps its identity, and a listener bound to the old
// `props` would keep firing the previous render's closure instead.
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

/**
 * One CSS declaration a tile's props contribute, as `[property, value]`.
 *
 * The prop-to-style mapping is expressed as data rather than as writes to an
 * element because two paths need it: the live renderers set it on a real
 * element, and the SSR pass (`ssr-render.ts`) serialises it into a `style`
 * attribute. When only the first existed, a served page carried none of what a
 * tile's props say about it.
 *
 * What is NOT here is what a declaration list cannot carry: `transition` and
 * the `hover:` / `focus:` / `active:` blocks are classes backed by injected
 * CSS, and motion is the same. Those stay with the appliers below, and stay
 * absent from the server's output.
 */
export type StyleDecl = [property: string, value: string];

/**
 * How a responsive `{base, sm, md, lg, xl}` value collapses to the one value a
 * declaration can hold. The client asks the viewport; the server has none and
 * takes the base. Injected rather than branched on, so there is one mapping
 * with one difference in it rather than two mappings.
 */
export type ResponsivePick = (raw: unknown) => string | number | undefined;

/**
 * A prop value a declaration can hold; anything else is not one.
 *
 * The empty string is not one either. A conditional writes it for the branch
 * that means "nothing" (`{max-w: if wide then 600 else ""}`), and a declaration
 * with an empty value is not a declaration — on the mount path it removes the
 * property, so the served page has to leave it out rather than serialise
 * `max-width: `.
 */
const asScalar = (v: unknown): string | number | undefined =>
  (typeof v === "string" && v !== "") || typeof v === "number" ? v : undefined;

/** The value a server can know: the base, or the literal if it is not a map. */
export const pickBaseValue: ResponsivePick = (raw) => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return asScalar(raw);
  return asScalar((raw as Record<string, unknown>).base);
};

/** The largest matching breakpoint, falling back to the base. */
const pickForViewport: ResponsivePick = (raw) => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return asScalar(raw);
  const m = raw as Record<string, unknown>;
  const order: Array<["xl" | "lg" | "md" | "sm", string]> = [
    ["xl", "(min-width: 1280px)"],
    ["lg", "(min-width: 1024px)"],
    ["md", "(min-width: 768px)"],
    ["sm", "(min-width: 640px)"],
  ];
  for (const [bp, q] of order) {
    if (m[bp] !== undefined && window.matchMedia(q).matches) return asScalar(m[bp]);
  }
  return asScalar(m.base);
};

/**
 * The declarations a `style: { ... }` block contributes (spec/style.md §4.3) —
 * each key becomes a CSS property verbatim. Keys are kebab-case CSS property
 * names (`background`, `padding`, `border-radius`, `box-shadow`, …) and their
 * values are resolved strings/numbers (`@token` references are already lowered
 * by the compiler). Numbers fall back to `px`, matching the spec's spacing
 * convention.
 */
function styleBlockDecls(raw: unknown): StyleDecl[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: StyleDecl[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    out.push([key, typeof value === "number" ? `${value}px` : String(value)]);
  }
  return out;
}

/**
 * The inline style a container tile's props contribute. `pick` is required
 * rather than defaulted: the two callers answer the breakpoint question
 * differently, and a default would let a new one inherit the viewport answer
 * on a machine that has no viewport.
 */
export function propStyleDecls(
  props: TileProps | undefined,
  pick: ResponsivePick,
  kind?: string,
): StyleDecl[] {
  if (!props) return [];
  const owned = kind === undefined ? undefined : KIND_OWNED_PROPS[kind];
  if (owned) {
    const rest: TileProps = { ...props };
    for (const name of owned) delete (rest as Record<string, unknown>)[name];
    props = rest;
  }
  const out: StyleDecl[] = [];
  const gap = pick(props.gap);
  if (gap !== undefined) out.push(["gap", mapToken(String(gap))]);
  const gapX = pick(props.gap_x);
  if (gapX !== undefined) out.push(["column-gap", mapToken(String(gapX))]);
  const gapY = pick(props.gap_y);
  if (gapY !== undefined) out.push(["row-gap", mapToken(String(gapY))]);
  const align = pick(props.align);
  if (align !== undefined) out.push(["align-items", mapAlign(String(align))]);
  const justify = pick(props.justify);
  if (justify !== undefined) out.push(["justify-content", mapJustify(String(justify))]);
  // `pad` first: the per-axis props refine it, so each has to be able to
  // overwrite the shorthand's contribution on the axis it names.
  const pad = pick(props.pad);
  if (pad !== undefined) out.push(["padding", mapToken(String(pad))]);
  const padX = pick(props.pad_x);
  if (padX !== undefined) {
    out.push(["padding-left", mapToken(String(padX))], ["padding-right", mapToken(String(padX))]);
  }
  const padY = pick(props.pad_y);
  if (padY !== undefined) {
    out.push(["padding-top", mapToken(String(padY))], ["padding-bottom", mapToken(String(padY))]);
  }
  // Sizing (style.md §4.4.7). Each is the same question — how big — so they
  // share one value mapping rather than six.
  for (const [prop, css] of SIZING_PROPS) {
    const v = pick(props[prop]);
    if (v !== undefined) out.push([css, mapLength(v)]);
  }
  // `aspect` is a ratio, not a length: `1` means 1/1, and `1px` means nothing.
  const aspect = pick(props.aspect);
  if (aspect !== undefined) out.push(["aspect-ratio", String(aspect)]);
  // `wrap` is a boolean, so it never survives the scalar pick the sizing props
  // go through.
  if (typeof props.wrap === "boolean") out.push(["flex-wrap", props.wrap ? "wrap" : "nowrap"]);
  // Each of these reads a token name, so each goes through `token`: an empty
  // one is the branch of a conditional that means "not said", and a declaration
  // with an empty value is not a declaration. Left in, the mount path's
  // `setProperty(prop, "")` *removes* the property — taking the kind's own base
  // with it — while the server serialises `border-radius: `, which is invalid
  // and ignored, so the two paths disagree about a `card`'s corners.
  const bg = token(props.bg);
  if (bg !== undefined) out.push(["background", mapColor(bg)]);
  const radius = token(props.radius);
  if (radius !== undefined) out.push(["border-radius", mapRadius(radius)]);
  const shadow = token(props.shadow);
  if (shadow !== undefined) out.push(["box-shadow", mapShadow(shadow)]);
  // The typography shorthands (style.md §4.3.1). They inherit, so a container
  // that sets `color` or `size` sets it for what is inside it.
  if (props.strike) out.push(["text-decoration", "line-through"]);
  const color = token(props.color);
  if (color !== undefined) out.push(["color", mapColor(color)]);
  const size = token(props.size);
  if (size !== undefined) out.push(["font-size", mapSize(size)]);
  if (props.weight === "bold") out.push(["font-weight", "700"]);
  // Last, so an explicit declaration wins over the shorthand for the same
  // property — `{radius: "md", style: {"border-radius": "50%"}}` is a circle.
  out.push(...styleBlockDecls(props.style));
  return out;
}

/**
 * Props a kind maps itself, which the shared mapping must therefore leave
 * alone. A `spinner`'s `size` picks the size of the spinner, not a typography
 * token; an `icon`'s sizes the SVG box; a `skeleton`'s `h` is its placeholder
 * height. Without this the shared mapping would run last and overwrite the
 * kind's answer with the general one.
 *
 * Both render paths read this table, so an exception cannot exist on one side
 * only.
 */
const KIND_OWNED_PROPS: Record<string, readonly string[] | undefined> = {
  spinner: ["size"],
  icon: ["size"],
  skeleton: ["h"],
};

/** A token name a tile wrote, or `undefined` when it wrote none. */
const token = (v: unknown): string | undefined =>
  typeof v === "string" && v !== "" ? v : undefined;

/**
 * The sizing props and the CSS property each one is. Names are the LOWERED
 * form — the compiler maps a Kumiki name to a JS-safe key (`max-w` ->
 * `max_w`), and that key is the only spelling the runtime reads. Reading
 * `props["max-w"]` here type-checked and rendered nothing, which is how every
 * app in the corpus set a page width that never applied.
 */
const SIZING_PROPS: ReadonlyArray<readonly [prop: string, css: string]> = [
  ["w", "width"],
  ["h", "height"],
  ["min_w", "min-width"],
  ["min_h", "min-height"],
  ["max_w", "max-width"],
  ["max_h", "max-height"],
];

/**
 * A size, as CSS. A number is pixels (the spec's spacing convention) and
 * `"full"` is the whole of the containing box; anything else is already a CSS
 * length (`"auto"`, `"50vh"`, `"16/9"`) and passes through.
 */
function mapLength(v: string | number): string {
  if (typeof v === "number") return `${v}px`;
  return v === "full" ? "100%" : v;
}

function setDecls(el: HTMLElement, decls: StyleDecl[]): void {
  for (const [k, v] of decls) el.style.setProperty(k, v);
}

/**
 * Move an element from the style its props asked for last render to the one
 * they ask for now. `before` is undefined on the create path.
 *
 * The removal half is what a re-applying `setProperty` loop cannot do: a
 * conditional that swaps two containers of the same kind reuses the element,
 * and without this the one that no longer sets `max-width` keeps the other's.
 * Only properties these props set are ever removed — a kind's own base layout
 * is not in the list, so it survives.
 */
export function patchPropStyle(
  el: HTMLElement,
  before: TileProps | undefined,
  after: TileProps | undefined,
  kind?: string,
): void {
  const was = propStyleDecls(before, pickForViewport, kind);
  const now = propStyleDecls(after, pickForViewport, kind);
  for (const [prop] of was) {
    if (!now.some(([p]) => p === prop)) el.style.removeProperty(prop);
  }
  setDecls(el, now);
}

/** An attribute a tile's props ask for. */
export type AttrDecl = [name: string, value: string];

/**
 * The attributes every tile kind accepts, whatever it renders (stdlib.md
 * §2.3.10). They are data for the same reason the style mapping is: the live
 * renderers set them on an element and the SSR pass serialises them, and one
 * table is what keeps a served page and a mounted one saying the same thing.
 *
 * `class` is the only one that is not simply "set the attribute" — the runtime
 * puts its own classes on the same element (the animation classes, the state-
 * style classes), so the author's tokens are added to what is there rather
 * than written over it.
 *
 * Every prop is read by name. Nothing here enumerates `props`: a host tile
 * (#71) owns its own props object, and a `Object.keys` against one that refuses
 * enumeration throws on the render path, where the throw costs the whole tree.
 * That is why a bare `aria-label` arrives already folded into `aria` — the
 * compiler merges the two spellings, because only it can do so by name.
 */
export function commonAttrDecls(props?: TileProps): AttrDecl[] {
  if (!props) return [];
  const out: AttrDecl[] = [];
  if (typeof props.class === "string" && props.class.trim() !== "")
    out.push(["class", props.class]);

  // An empty value is the branch of a conditional that means "not said", so it
  // writes no attribute rather than an empty one.
  if (attrValue(props.id) !== undefined) out.push(["id", String(props.id)]);
  if (attrValue(props.test_id) !== undefined) out.push(["data-kumiki-test", String(props.test_id)]);
  if (attrValue(props.role) !== undefined) out.push(["role", String(props.role)]);
  // A map, or nothing: a `Text` here would spread into `aria-0` / `aria-1`,
  // one attribute per character.
  const aria = props.aria;
  if (aria !== null && typeof aria === "object" && !Array.isArray(aria)) {
    for (const [key, value] of Object.entries(aria as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      // A key that cannot name an ARIA attribute is not one. This is also what
      // catches a non-map `aria`: the compiler merges the two spellings by
      // spreading, and spreading a `Text` yields `{0: "h", 1: "i"}` — one
      // attribute per character.
      if (!/^[a-zA-Z][\w-]*$/.test(key)) continue;
      out.push([key.startsWith("aria-") ? key : `aria-${key}`, String(value)]);
    }
  }
  return out;
}

/** A prop that becomes an attribute, or `undefined` when the tile did not say. */
export function attrValue(v: unknown): string | number | undefined {
  if (typeof v === "number") return v;
  return typeof v === "string" && v !== "" ? v : undefined;
}

/** The class tokens a decl list asks for, in order. */
function classTokensOf(decls: AttrDecl[]): string[] {
  const decl = decls.find(([name]) => name === "class");
  return decl ? decl[1].split(/\s+/).filter((t) => t !== "") : [];
}

/**
 * Move an element from the common props it was rendered with to the ones it
 * has now. `before` is undefined on the create path, where there is nothing to
 * take away.
 *
 * The patch path is why this is a diff rather than an apply: a reused element
 * keeps whatever the last render put on it, so a `class` that flipped would
 * otherwise accumulate both tokens and an `aria` key that disappeared would
 * stay on the element forever.
 *
 * Removal is by attribute name, so a prop that stops being written also clears
 * the value a renderer had put under the same name at create time — a `spinner`
 * whose `aria` map loses its `label` is left with no `aria-label` rather than
 * the renderer's "Loading". The alternative is to leave the author's stale
 * value in place, which is worse: it says something untrue rather than nothing.
 */
/** The common props on a freshly rendered element. */
export function applyCommonProps(el: HTMLElement, props?: TileProps): void {
  patchCommonProps(el, undefined, props);
}

export function patchCommonProps(
  el: HTMLElement,
  before: TileProps | undefined,
  after: TileProps | undefined,
): void {
  const was = commonAttrDecls(before);
  const now = commonAttrDecls(after);
  const wasClasses = classTokensOf(was);
  const nowClasses = classTokensOf(now);
  for (const token of wasClasses) {
    if (!nowClasses.includes(token)) el.classList.remove(token);
  }
  for (const token of nowClasses) el.classList.add(token);
  for (const [name] of was) {
    if (name !== "class" && !now.some(([n]) => n === name)) el.removeAttribute(name);
  }
  for (const [name, value] of now) {
    if (name !== "class") el.setAttribute(name, value);
  }
}

export function applyContainerProps(el: HTMLElement, props?: TileProps, kind?: string): void {
  if (!props) return;
  setDecls(el, propStyleDecls(props, pickForViewport, kind));
  applyStateStyles(el, props);
  applyTransition(el, props);
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
  const d = props.transition_duration;
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

export function applyTextProps(el: HTMLElement, props?: TileProps, kind?: string): void {
  if (!props) return;
  setDecls(el, propStyleDecls(props, pickForViewport, kind));
  applyStateStyles(el, props);
}

// Module-global by design (one style host per document in the common case),
// which means it is shared ACROSS mounts: two co-mounted apps whose themes
// share a NAME but differ in content will cache-hit each other and skip
// re-injection — the shared style host keeps whichever applied last. That is
// part of the style-root contention this registry deliberately does not solve
// (see `mountedShapes`, which refuses a per-view style root for the same
// reason); give co-mounted apps distinct theme names
// or isolate them in shadow roots.
let lastAppliedThemeName: string | null = null;
/**
 * The theme name in force: `app.themeName`, or — when that names a slot rather
 * than a theme, which is the `app.theme = <slot>` form — the name that slot
 * currently holds.
 */
function resolvedThemeName(app: AppShape): string | undefined {
  const name = app.themeName ?? undefined;
  if (name && app.themes && !(name in app.themes) && typeof app.live?.[name] === "string") {
    return app.live[name] as string;
  }
  return name;
}

function maybeReapplyTheme(app: AppShape): void {
  const name = resolvedThemeName(app);
  if (name === lastAppliedThemeName) return;
  lastAppliedThemeName = name ?? null;
  applyThemeDefaults(app);
}

function applyThemeDefaults(app: AppShape): void {
  // The compiler resolves the NAME in `app.theme = X`, and deliberately not the
  // value a slot behind it holds: an app that picks its theme on `app.start`
  // starts that slot at a sentinel naming no theme, and a sentinel cannot be
  // told from a misspelling without intent. So the misspelling surfaces here
  // instead — otherwise the app renders with the built-in defaults and looks
  // merely unstyled. Every caller reaches this once per name change.
  const selected = resolvedThemeName(app);
  if (selected && app.themes && !(selected in app.themes)) {
    console.warn(
      `Theme "${selected}" is not declared; rendering with the built-in defaults. ` +
        `Declared themes: ${Object.keys(app.themes).join(", ") || "(none)"}`,
    );
  }
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
  let name = resolvedThemeName(app);
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
/**
 * One token lookup for every `theme` section that is a flat name-to-value map
 * (`radius`, `shadow`). `fallback` carries the defaults style.md §4.2 prints,
 * so a program with no `theme` definition still gets the documented scale.
 * A name in neither is passed through as CSS, which is what lets
 * `radius: "50%"` work.
 */
function mapThemeToken(section: string, name: string, fallback: Record<string, string>): string {
  const theme = currentTheme();
  const sec = theme?.[section];
  if (sec && typeof sec === "object" && !Array.isArray(sec)) {
    const v = (sec as Record<string, ThemeValue>)[name];
    if (typeof v === "string") return v;
    if (typeof v === "number") return `${v}px`;
  }
  return fallback[name] ?? name;
}

function mapRadius(r: string): string {
  return mapThemeToken("radius", r, {
    none: "0",
    sm: "4px",
    md: "8px",
    lg: "16px",
    pill: "999px",
  });
}

function mapShadow(s: string): string {
  return mapThemeToken("shadow", s, {
    none: "none",
    sm: "0 1px 2px rgba(0,0,0,0.1)",
    md: "0 4px 8px rgba(0,0,0,0.1)",
    lg: "0 8px 24px rgba(0,0,0,0.15)",
  });
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
