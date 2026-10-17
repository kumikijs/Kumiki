import type { Episode, EpisodeLogger } from "../episode.ts";
import type { BindSegment } from "./path.ts";
import type { RefinementRejection, SlotMeta } from "./refinement.ts";

export type SsrSnapshot = Record<string, unknown>;

export type RefinementCheck = (v: unknown) => boolean;

export type EventHandler = (el: Record<string, unknown>) => void;

export type TileNode = (
  | { kind: "page" | "column" | "row" | "card" | "box"; children: TileNode[]; props?: TileProps }
  | { kind: "heading" | "text"; text: string; props?: TileProps }
  | {
      kind: "button";
      text: string;
      /** `loading`, `disabled` and `variant` live here — see `applyButtonState`. */
      props?: TileProps;
      type?: string;
    }
  | {
      kind: "input";
      props?: TileProps;
      bind?: string;
      bindPath?: BindSegment[];
      parse?: BindReader;
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
      bindPath?: BindSegment[];
      value?: string;
      rows?: number;
      placeholder?: string;
      id?: string;
    }
  | {
      kind: "check";
      checked: boolean;
      props?: TileProps;
      bind?: string;
      bindPath?: BindSegment[];
    }
  | {
      kind: "switch";
      checked: boolean;
      props?: TileProps;
      bind?: string;
      bindPath?: BindSegment[];
    }
  | { kind: "spinner"; props?: TileProps }
  | { kind: "skeleton"; props?: TileProps }
  | { kind: "form"; children: TileNode[]; props?: TileProps }
  | { kind: "label"; text: string; props?: TileProps }
  | {
      kind: "link";
      text: string;
      to: string;
      /** The reducer to dispatch when the link enters the viewport. */
      prefetch?: string;
      /** The payload that reducer's `$el` / `$event` binding receives. */
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
      bindPath?: BindSegment[];
      value?: unknown;
      options?: Array<{ label: unknown; value: unknown }>;
      placeholder?: string;
    }
  | {
      kind: "radio";
      props?: TileProps;
      group?: string;
      value?: unknown;
      selected?: boolean;
      bind?: string;
      bindPath?: BindSegment[];
    }
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
      bindPath?: BindSegment[];
      value?: number;
      min?: number;
      max?: number;
      step?: number;
    }
  | { kind: "error"; field: string; props?: TileProps }
  | { kind: "route-outlet"; children: TileNode[]; props?: TileProps }
  | {
      kind: "details";
      summary: string;
      children: TileNode[];
      open?: boolean;
      props?: TileProps;
    }
  | {
      kind: "editable";
      text: string;
      props?: TileProps;
      bind?: string;
      bindPath?: BindSegment[];
      id?: string;
    }
) & {
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
    rejected?: RefinementRejection[];
  };
};

export type EmitSpec = { effect: string; args: unknown[]; key?: string };

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
  retry?:
    | { kind: "linear"; n: number; ms: number }
    | { kind: "exponential"; n: number; ms: number; factor: number };
  invoke: (input: unknown, caps: CapabilityRegistry, signal?: AbortSignal) => Promise<EffectResult>;
  errText?: (value: unknown) => string;
};

export type EffectResult =
  | { kind: "ok"; value: unknown }
  | { kind: "err"; value: unknown; final?: boolean };

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

export type TileCtx = { render(node: TileNode): HTMLElement };

export type TileRenderer<K extends TileNode["kind"] = TileNode["kind"]> = (
  node: TileNode & { kind: K },
  ctx: TileCtx,
) => HTMLElement;

/** A registry of tile renderers, keyed by `TileNode["kind"]`. */
export type TileRenderers = { [K in TileNode["kind"]]?: TileRenderer<K> };

export type TilePatcher<K extends TileNode["kind"] = TileNode["kind"]> = (
  el: HTMLElement,
  oldNode: TileNode & { kind: K },
  newNode: TileNode & { kind: K },
  ctx: TileCtx,
) => void;

/** A registry of tile patchers, keyed by `TileNode["kind"]`. */
export type TilePatchers = { [K in TileNode["kind"]]?: TilePatcher<K> };

export type ReconcileFallbackReason = ReconcileFallback["reason"];

export type ReconcileFallback =
  | { reason: "no-patcher" }
  | { reason: "child-count-change"; oldCount: number; newCount: number }
  | { reason: "child-hole"; index: number }
  | { reason: "child-unmapped"; index: number; childKind: string }
  | { reason: "wrapped-children"; index: number; childKind: string }
  | { reason: "unplaceable-insert"; index: number; childKind: string };

export type NeverEqualCause = "non-plain-object" | "nan" | "function-identity";

export type RuntimeDiagnostic =
  | (DiagnosticSite & { kind: "reconcile-fallback" } & ReconcileFallback)
  | (DiagnosticSite & {
      kind: "never-equal-prop";
      /** Dotted path of the offending field, e.g. `props.at` or a bare `at`. */
      field: string;
      cause: NeverEqualCause;
    });

export type DiagnosticSite = {
  /** The tile kind the walker was deciding about. */
  tileKind: string;
  /** Same identifier the episode log uses: bind path, else key, else kind. */
  id: string;
  /** The authored tile this node came from, when it came from one. */
  tile?: string | undefined;
};

// The compiler's `BUILTIN_EFFECTS` is keyed by these names, so it refuses an `effect` declared
// under one (E0234): the installer writes over that declaration at mount.
export type BuiltinEffectName =
  | "navigate"
  | "navigate-replace"
  | "navigate-back"
  | "scroll-to"
  | "toast"
  | "confirm"
  | "log";

export type BuiltinEffects = { [N in BuiltinEffectName]?: EffectSpec & { name: N } };

/** Mount-internal navigation handles handed to builtin-effect installers. */
export type NavContext = {
  navigate: (path: string, replace: boolean) => void;
  back: () => void;
};

export type BuiltinInstaller = (app: AppShape, nav: NavContext) => void;

export type RoutingImpl = {
  createRouter(mode: "history" | "memory" | undefined, initialPath?: string): Router;
  parseLocation(routes: AppShape["routes"], loc: LocationLike): ParsedRoute;
  matchPattern(pattern: string, path: string): Record<string, string> | null;
  findRedirect(routes: AppShape["routes"], loc: LocationLike): string | null;
  /** The URL a parsed route was read from: its path, query and hash. */
  href(route: ParsedRoute): string;
  /** Register navigate / navigate-replace / navigate-back / scroll-to on `app.effects`. */
  installNavEffects(app: AppShape, nav: NavContext): void;
};

/** Options accepted by `mount`. */
export type MountOptions = {
  /** Host implementations for custom capabilities, keyed by capability name. */
  providers?: Record<string, CapabilityProvider>;
  styleRoot?: Document | ShadowRoot;
  styleHost?: HTMLElement;
  router?: "history" | "memory";
  /** Initial path for the memory router (default `"/"`). Ignored in history mode. */
  initialPath?: string;
  tiles?: TileRenderers;
  tilePatchers?: TilePatchers;
  /** The routing feature module (`routing` from `router.ts`), when the app routes. */
  routing?: RoutingImpl;
  /** Built-in effect installers (e.g. `installToast`) this app can emit. */
  builtins?: BuiltinInstaller[];
  episodeLogger?: EpisodeLogger | null;
  onDiagnostic?: (d: RuntimeDiagnostic) => void;
  hostTileKinds?: readonly string[];
  ssrSnapshot?: SsrSnapshot;
  bootstrapEpisode?: Episode;
  hydrate?: boolean;
};

export type OutletFill = (tree: TileNode) => TileNode;

export type RouteEntry = {
  pattern: string;
  name?: string;
  tile: (fill?: OutletFill) => TileNode;
  subRoutes?: Array<RouteEntry | RedirectEntry>;
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
  /** Declared IndexedDB stores, opened on the first indexed-* effect. */
  indexedDb?: {
    name: string;
    version: number;
    stores: { name: string; key: string; indexes?: string[] }[];
  };
  themes?: Record<string, Theme>;
  /** selected theme name. */
  themeName?: string | null;
  icons?: Record<string, string>;
  /** reusable scoped animations by name (closed-grammar keyframes + timing). */
  motions?: Record<string, unknown>;
  /** Document-level metadata applied to <head> at mount. */
  meta?: {
    title?: string;
    description?: string;
    ogImage?: string;
    favicon?: string;
  };
  analytics?: {
    provider: "console" | "noop";
    appId?: string;
  };
  root?: () => TileNode;
  live?: Record<string, unknown>;
  _rerender?: () => void;
};

export type OptionOf<T> = { _tag: "Some"; _0: T } | { _tag: "None" };

export const someOf = <T>(value: T): OptionOf<T> => ({ _tag: "Some", _0: value });

export const NONE: OptionOf<never> = { _tag: "None" };

export type ParsedRoute = {
  path: string;
  pattern: string;
  params: Record<string, string>;
  query: Record<string, string>;
  /** `Option(Text)`: what a `match route.hash` expects. */
  hash: OptionOf<string>;
  /** Matched sub-route pattern when the parent route delegates to `route-outlet`. */
  childPattern?: string;
};

/** The slice of `Location` the routing path actually reads. */
export type LocationLike = { pathname: string; search: string; hash: string };

export interface Router {
  read(): LocationLike;
  push(path: string): void;
  replace(path: string): void;
  back(): void;
  /** Subscribe to out-of-band location changes (browser back/forward). */
  subscribe(cb: () => void): () => void;
}

export type MountedApp = AppShape & {
  _dispatch: (name: string, el: Record<string, unknown>) => void;
  _setSlot: (name: string, value: unknown, at?: readonly BindSegment[]) => boolean;
  _navigate: (path: string, replace?: boolean) => void;
  _prefetch: (name: string, args: Record<string, string>, to: string) => void;
  _rerender: () => void;
  _submitHeldBy: (e: Event) => readonly string[] | undefined;
  /** Prefetch dedupe set, created on the first link prefetch. */
  _prefetched?: Set<string>;
  _episodeId?: () => string | undefined;
  live: Record<string, unknown>;
};

export type BindReader = {
  as: "Int" | "Float" | "Time";
  read: (text: string) => { _tag: string; _0?: unknown };
};

/** What a mount (or an additional view of one) gives its caller back. */
export type MountHandle = {
  dispose: () => void;
  episodes: () => ReturnType<EpisodeLogger["list"]>;
};
