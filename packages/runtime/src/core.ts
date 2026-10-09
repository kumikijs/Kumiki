import type {
  EnvRead,
  EnvReadKind,
  Episode,
  EpisodeLogger,
  PanicCategory,
  PanicCauseLink,
  SlotDiff,
} from "./episode.ts";

export type { EnvRead, EnvReadKind, PanicCategory, PanicCauseLink } from "./episode.ts";

type EnvFrame =
  | { mode: "record"; reads: EnvRead[] }
  | { mode: "replay"; remaining: EnvRead[]; live: number; malformed: number };

type EnvJournalHost = { __kumikiEnvJournal__?: EnvFrame[] };

const envStack: EnvFrame[] = ((): EnvFrame[] => {
  const host = globalThis as EnvJournalHost;
  const existing = host.__kumikiEnvJournal__;
  if (existing) return existing;
  const created: EnvFrame[] = [];
  host.__kumikiEnvJournal__ = created;
  return created;
})();

const ENV_VALUE_TYPE: Record<EnvReadKind, "number" | "string" | "boolean"> = {
  now: "number",
  random: "number",
  "fresh-id": "string",
  "prefers-dark": "boolean",
};

export type EnvScopeReport = {
  /** What a record scope journalled, in the order the body asked. Empty for a replay scope. */
  reads: EnvRead[];
  /** Reads a replay scope had no recorded answer for, and took from the live source. */
  live: number;
  /** Recorded answers the replayed body never asked for. */
  unused: number;
  /** Entries rejected as malformed when the scope opened. */
  malformed: number;
};

export type EnvScopeOutcome<T> =
  | { ok: true; value: T; env: EnvScopeReport }
  | { ok: false; error: unknown; env: EnvScopeReport };

/** Open a scope that records every environment read until `endEnvScope`. */
export function beginEnvRecord(): void {
  envStack.push({ mode: "record", reads: [] });
}

export function beginEnvReplay(reads: unknown): void {
  const list = Array.isArray(reads) ? (reads as unknown[]) : [];
  // A non-array that is not simply absent is itself one malformed input.
  let malformed = Array.isArray(reads) || reads == null ? 0 : 1;
  const remaining: EnvRead[] = [];
  for (const entry of list) {
    const read =
      entry && typeof entry === "object"
        ? (entry as { kind?: unknown; value?: unknown })
        : { kind: undefined, value: undefined };
    const want = ENV_VALUE_TYPE[read.kind as EnvReadKind];
    if (want !== undefined && typeof read.value === want) {
      remaining.push({ kind: read.kind as EnvReadKind, value: read.value });
    } else {
      malformed++;
    }
  }
  envStack.push({ mode: "replay", remaining, live: 0, malformed });
}

export function endEnvScope(): EnvScopeReport {
  const frame = envStack.pop();
  if (!frame) return { reads: [], live: 0, unused: 0, malformed: 0 };
  if (frame.mode === "record") return { reads: frame.reads, live: 0, unused: 0, malformed: 0 };
  return {
    reads: [],
    live: frame.live,
    unused: frame.remaining.length,
    malformed: frame.malformed,
  };
}

function withEnvScope<T>(body: () => T): EnvScopeOutcome<T> {
  let value: T;
  try {
    value = body();
  } catch (error) {
    return { ok: false, error, env: endEnvScope() };
  }
  return { ok: true, value, env: endEnvScope() };
}

/** Run `body` inside a recording scope. The scope closes on both exits. */
export function withEnvRecord<T>(body: () => T): EnvScopeOutcome<T> {
  beginEnvRecord();
  return withEnvScope(body);
}

/** Run `body` inside a replay scope seeded with `reads`. Closes on both exits. */
export function withEnvReplay<T>(reads: unknown, body: () => T): EnvScopeOutcome<T> {
  beginEnvReplay(reads);
  return withEnvScope(body);
}

export function readEnv<T>(kind: EnvReadKind, live: () => T): T {
  const frame = envStack[envStack.length - 1];
  if (!frame) return live();
  if (frame.mode === "record") {
    const value = live();
    frame.reads.push({ kind, value });
    return value;
  }
  for (let i = 0; i < frame.remaining.length; i++) {
    if (frame.remaining[i]?.kind !== kind) continue;
    const [read] = frame.remaining.splice(i, 1);
    return (read as EnvRead).value as T;
  }
  frame.live++;
  return live();
}

export type SsrSnapshot = Record<string, unknown>;

export type RefinementCheck = (v: unknown) => boolean;
export type EventHandler = (el: Record<string, unknown>) => void;

export class KumikiPanic extends Error {
  readonly isKumikiPanic = true as const;
  location: string | undefined;
  constructor(message: string, location?: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "KumikiPanic";
    this.location = location;
  }
}

/** True for a KumikiPanic — also matches across realms where `instanceof` fails. */
export function isPanic(e: unknown): e is KumikiPanic {
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

export type RefinementPart = {
  kind: string;
  args?: (number | string)[];
  refine: RefinementCheck;
};

export type SlotMeta = {
  value: unknown;
  refine?: RefinementCheck;
  volatile?: boolean;
  /** Refinement predicate name + args — drives the `error` tile's message. */
  refineKind?: string;
  refineArgs?: (number | string)[];
  refineAll?: RefinementPart[];
  refineFailure?: (v: unknown, at?: readonly BindSegment[]) => RefinementFailure | undefined;
};

export type RefinementStep =
  | string
  | number
  | { readonly variant: string; readonly payload?: number }
  | { readonly key: string | number }
  | { readonly entry: string | number }
  | { readonly member: string | number };

export type RefinementFailure = {
  kind: string;
  args: (number | string)[];
  path: readonly RefinementStep[];
};

export function showRefinementPath(path: readonly RefinementStep[]): string {
  return path
    .map((step) => {
      if (typeof step === "string") return `.${step}`;
      if (typeof step === "number") return `[${step}]`;
      if ("variant" in step)
        return step.payload === undefined
          ? `.${step.variant}`
          : `.${step.variant}[${step.payload}]`;
      if ("key" in step) return `.keys[${JSON.stringify(step.key)}]`;
      if ("entry" in step) return `[${JSON.stringify(step.entry)}]`;
      return `{${JSON.stringify(step.member)}}`;
    })
    .join("");
}

export function showRefinementFailure(f: {
  kind?: string;
  args?: readonly (number | string)[];
  path?: readonly RefinementStep[];
}): string {
  const pred =
    f.kind === undefined
      ? "its refinement"
      : f.args && f.args.length > 0
        ? `${f.kind}(${f.args.join(", ")})`
        : f.kind;
  const at = f.path && f.path.length > 0 ? ` at ${showRefinementPath(f.path)}` : "";
  return `${pred}${at}`;
}

/** The slot fields that decide whether a value is let in. */
export type SlotGate = {
  refine?: RefinementCheck;
  refineFailure?: RefinementNaming["refineFailure"];
};

export function slotAccepts(
  meta: SlotGate | undefined,
  value: unknown,
  at?: readonly BindSegment[],
): boolean {
  if (meta?.refineFailure) return meta.refineFailure(value, at) === undefined;
  return meta?.refine ? meta.refine(value) : true;
}

export type RefinementNaming = {
  refineKind?: string;
  refineArgs?: (number | string)[];
  refineAll?: RefinementPart[];
  refineFailure?: (v: unknown, at?: readonly BindSegment[]) => RefinementFailure | undefined;
};

export function failedRefinement(
  value: unknown,
  meta: RefinementNaming | undefined,
): { kind?: string; args?: (number | string)[]; path?: readonly RefinementStep[] } {
  // A type with predicates below its own chain answers with the failure itself, which is the only reader that can say *where* inside the value.
  if (meta?.refineFailure) {
    const deep = meta.refineFailure(value);
    if (!deep) return {};
    return deep.path.length === 0 ? { kind: deep.kind, args: deep.args } : deep;
  }
  const part = meta?.refineAll?.find((p) => !p.refine(value));
  if (part) return { kind: part.kind, args: part.args ?? [] };
  const named: { kind?: string; args?: (number | string)[] } = {};
  if (meta?.refineKind !== undefined) named.kind = meta.refineKind;
  if (meta?.refineArgs) named.args = meta.refineArgs;
  return named;
}

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

export class PatchRequiresRebuild extends Error {
  readonly isPatchRequiresRebuild = true as const;
  constructor(reason: string) {
    super(`patcher declined in-place update: ${reason}`);
    this.name = "PatchRequiresRebuild";
  }
}

export type ReconcileFallbackReason = ReconcileFallback["reason"];

export type ReconcileFallback =
  | { reason: "no-patcher" }
  | { reason: "child-count-change"; oldCount: number; newCount: number }
  | { reason: "child-hole"; index: number }
  | { reason: "child-unmapped"; index: number; childKind: string }
  | { reason: "wrapped-children"; index: number; childKind: string }
  | { reason: "unplaceable-insert"; index: number; childKind: string };

export type NeverEqualCause =
  | "non-plain-object"
  | "nan"
  | "function-identity";

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
  /** Register navigate / navigate-replace / navigate-back on `app.effects`. */
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
  /** §6.7.4: declared IndexedDB stores. The runtime opens the DB on first indexed-* effect. */
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
  /** §4.10: document-level metadata applied to <head> at mount. */
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
  /** `Option(Text)` — routing.md §3.2, and what a `match route.hash` expects. */
  hash: OptionOf<string>;
  /** Matched sub-route pattern when the parent route delegates to `route-outlet` (§3.6). */
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

export function emptyRoute(): ParsedRoute {
  return { path: "/", pattern: "/", params: {}, query: {}, hash: NONE };
}

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

export function pickRootTile(app: AppShape, slotValues: Record<string, unknown>): TileNode {
  if (app.routes && app.routes.length > 0) {
    const cur = slotValues.route as ParsedRoute;
    for (const r of app.routes) {
      if (r.pattern === cur.pattern && "tile" in r) {
        const childEntry =
          cur.childPattern && r.subRoutes
            ? r.subRoutes.find(
                (sr): sr is RouteEntry => "tile" in sr && sr.pattern === cur.childPattern,
              )
            : undefined;
        if (!childEntry) return routeTree(r, keepTree);
        const fill: OutletFill = (tree) => {
          if (!injectRouteOutlet(tree, routeTree(childEntry, keepTree))) {
            console.error(
              `[kumiki] route "${r.pattern}" matched sub-route "${childEntry.pattern}" but tile "${r.name ?? r.pattern}" rendered no route-outlet — the child was discarded`,
            );
          }
          return tree;
        };
        const root = routeTree(r, fill);
        return r.tile.length === 0 ? fill(root) : root;
      }
    }
    // 404 fallback tile
    for (const r of app.routes) {
      if (r.pattern === "/404" && "tile" in r) return routeTree(r, keepTree);
    }
  }
  return app.root ? app.root() : { kind: "text", text: "(no root)" };
}

/** The fill for a factory whose outlet has nothing to show (or that has none). */
const keepTree: OutletFill = (tree) => tree;

function routeTree(entry: RouteEntry, fill: OutletFill): TileNode {
  try {
    return entry.tile(fill);
  } catch (e) {
    if (isPanic(e) && entry.name !== undefined) {
      try {
        if (e.location === undefined) e.location = entry.name;
      } catch {
        // host-frozen panic: attribution is best-effort
      }
    }
    throw e;
  }
}

/** One slot in a reducer batch whose new value its refinement refuses. */
export type RefinementRejection = {
  slot: string;
  value: unknown;
  /** The predicate name + args, when the slot carries them (`between`, [0, 3]). */
  kind?: string;
  args?: (number | string)[];
  /**
   * Where inside the value the predicate failed, when that is not the value
   * itself — see {@link RefinementFailure}.
   */
  path?: readonly RefinementStep[];
};

export function refinementRejectionOf(
  slot: string,
  value: unknown,
  meta: RefinementNaming,
): RefinementRejection {
  const rejection: RefinementRejection = { slot, value };
  const { kind, args, path } = failedRefinement(value, meta);
  if (kind !== undefined) rejection.kind = kind;
  if (args !== undefined) rejection.args = args;
  if (path !== undefined) rejection.path = path;
  return rejection;
}

export function refinementRejections(
  next: Record<string, unknown>,
  slotMetas: Record<string, { refine?: RefinementCheck } & RefinementNaming>,
): RefinementRejection[] {
  const out: RefinementRejection[] = [];
  for (const [k, v] of Object.entries(next)) {
    const meta = slotMetas[k];
    if (!meta || slotAccepts(meta, v)) continue;
    out.push(refinementRejectionOf(k, v, meta));
  }
  return out;
}

export function batchRejections(
  result: { slots?: Record<string, unknown>; rejected?: RefinementRejection[] } | null | undefined,
  slotMetas: Record<string, { refine?: RefinementCheck } & RefinementNaming>,
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

function describeRejection(r: RefinementRejection): string {
  return `slot ${JSON.stringify(r.slot)} cannot hold ${showRejectedValue(r.value)} (${showRefinementFailure(r)})`;
}

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

const ROOT_ATTR = "data-kumiki-root";

export type MountedApp = AppShape & {
  _dispatch: (name: string, el: Record<string, unknown>) => void;
  _setSlot: (name: string, value: unknown, at?: readonly BindSegment[]) => boolean;
  _navigate: (path: string, replace?: boolean) => void;
  _prefetch: (name: string, args: Record<string, string>, to: string) => void;
  _rerender: () => void;
  _submitHeldBy: (e: Event) => readonly string[] | undefined;
  /** Prefetch dedupe set (§3.8), lazily created on first link prefetch. */
  _prefetched?: Set<string>;
  _episodeId?: () => string | undefined;
  live: Record<string, unknown>;
};

const appByRoot = new WeakMap<Element, MountedApp>();

export type BindReader = {
  as: "Int" | "Float" | "Time";
  read: (text: string) => { _tag: string; _0?: unknown };
};

type RefusedBind = {
  slot: string;
  path: readonly BindSegment[];
  value: unknown;
  shown: string;
  unread: BindReader["as"] | undefined;
};

const refusedBinds = new WeakMap<object, Map<HTMLElement, RefusedBind>>();

/** What a bound control shows: a box's tick, its value, or an editable's text. */
function shownValue(el: HTMLElement): string {
  const inp = el as HTMLInputElement;
  if (inp.type === "checkbox" || inp.type === "radio") return String(inp.checked);
  return "value" in el ? String(inp.value) : (el.textContent ?? "");
}

export function noteBindWrite(
  app: object,
  el: HTMLElement,
  slot: string,
  value: unknown,
  accepted: boolean,
  path: readonly BindSegment[] = [],
  unread?: BindReader["as"],
): void {
  let byEl = refusedBinds.get(app);
  if (byEl) {
    for (const other of byEl.keys()) if (!other.isConnected) byEl.delete(other);
  }
  if (accepted) {
    byEl?.delete(el);
    return;
  }
  if (!byEl) {
    byEl = new Map();
    refusedBinds.set(app, byEl);
  }
  byEl.set(el, { slot, path, value, shown: shownValue(el), unread });
}

/** Where a refused value counts as shown: a view's root, or any set of controls. */
export type BindView = Pick<Node, "contains">;

export function refusedBindShown(
  app: object,
  slot: string,
  view: BindView | undefined,
  held?: unknown,
): Pick<RefusedBind, "value" | "unread"> | undefined {
  const byEl = refusedBinds.get(app);
  if (!byEl) return undefined;
  const shown: RefusedBind[] = [];
  for (const [el, r] of byEl) {
    if (r.slot !== slot) continue;
    if (!el.isConnected || shownValue(el) !== r.shown) {
      byEl.delete(el);
      continue;
    }
    if (view?.contains(el)) shown.push(r);
  }
  if (shown.length === 0) return undefined;
  shown.sort((a, b) => a.path.length - b.path.length);
  const laid = new Set<string>();
  let value = held;
  let unread: BindReader["as"] | undefined;
  for (const r of shown) {
    const at = JSON.stringify(r.path);
    if (laid.has(at)) continue;
    laid.add(at);
    value = r.path.length > 0 ? _setPathHelper(value ?? {}, r.path, r.value) : r.value;
    unread ??= r.unread;
  }
  return { value, unread };
}

/** A field as it shows, judged: valid, or why not (see `judgeShownField`). */
export type ShownField =
  | { valid: true }
  | { valid: false; unread: BindReader["as"] }
  | { valid: false; unread?: undefined; value: unknown };

export function judgeShownField(
  app: AppShape,
  slot: string,
  view: BindView | undefined,
): ShownField {
  const meta = app.slots?.[slot];
  const held = app.live?.[slot] ?? meta?.value;
  const refused = refusedBindShown(app, slot, view, held);
  if (refused?.unread) return { valid: false, unread: refused.unread };
  const value = refused ? refused.value : held;
  return slotAccepts(meta, value) ? { valid: true } : { valid: false, value };
}

const heldSubmits = new WeakMap<Event, readonly string[]>();

/** Record that a form's gate held `e` back, and which bound slots did it. */
export function noteHeldSubmit(e: Event, slots: readonly string[]): void {
  heldSubmits.set(e, slots);
}

export function submitHeldBy(e: Event): readonly string[] | undefined {
  return heldSubmits.get(e);
}

/** The controls a refused bind is remembered against, for `app`. */
export function refusedBindControls(app: object): HTMLElement[] {
  return [...(refusedBinds.get(app)?.keys() ?? [])];
}

const mountedShapes = new WeakMap<AppShape, { attach: (target: HTMLElement) => MountHandle }>();

/** What a mount (or an additional view of one) gives its caller back. */
export type MountHandle = {
  dispose: () => void;
  episodes: () => ReturnType<EpisodeLogger["list"]>;
};

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
function withRenderingView<T>(view: Element, fn: () => T): T {
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

export function mountCore(
  app: AppShape,
  target: HTMLElement,
  options: MountOptions = {},
): MountHandle {
  const running = mountedShapes.get(app);
  if (running) {
    rejectViewOptions(options);
    return running.attach(target);
  }
  const episode: EpisodeLogger | null = options.episodeLogger ?? null;
  const diag = options.onDiagnostic ? makeReconcileDiag(options.onDiagnostic, options) : undefined;
  if (!app.live) {
    app.live = {};
    for (const [k, v] of Object.entries(app.slots)) app.live[k] = v.value;
  }
  registerAppRoot(target, app);
  if (options.ssrSnapshot) {
    for (const [k, v] of Object.entries(options.ssrSnapshot)) {
      if (k in app.slots) app.live[k] = v;
    }
  }
  // Ensure `route` slot exists (auto-managed by runtime when routes are declared).
  if (!("route" in app.live)) {
    app.live.route = emptyRoute();
  }
  currentStyleRoot = options.styleRoot ?? document;
  currentStyleHost = options.styleHost ?? null;
  stateStylesEl = null;
  // Inject the app's `motion` keyframes (+ prefers-reduced-motion guard) once.
  ensureMotionStyles(app);
  const slotValues = app.live;

  const tiles = options.tiles ?? {};
  const tilePatchers = options.tilePatchers ?? {};
  const ctxWrap = { applyMotion, applyUiEventHandlers, renderMissingTile };

  const routing = options.routing;
  const router: Router | null = routing
    ? routing.createRouter(options.router, options.initialPath)
    : null;
  let routerUnsub: (() => void) | undefined;

  applyAppMeta(app);
  const providers = withAnalyticsDefault(app, options.providers);
  const caps = makeCapabilityRegistry(app.caps, providers);
  const dispatcher = makeEffectDispatcher(
    app,
    caps,
    (effect, outcome, value, key, token) => {
      handleEffectResult(effect, outcome, value, key, token);
    },
    handleCapabilityRefusal,
    episode ? (effect, input) => episode.recordEffectStart(effect, input) : undefined,
    episode ? (targetId) => episode.recordEffectCancel(targetId) : undefined,
    episode ? (token, name) => episode.cancelPendingEffect(token, name) : undefined,
  );

  let pendingLeave: { oldRoute: ParsedRoute; newRoute: ParsedRoute } | null = null;
  let observeLeaveConfirm = false;
  let leaveAskedConfirm = false;

  const scrollSaved = new Map<string, { x: number; y: number }>();
  let lastNavSource: "push" | "replace" | "pop" = "push";

  type MountView = {
    target: HTMLElement;
    hydrate: boolean;
    root: HTMLElement | null;
    tree: TileNode | null;
    map: TileElementMap;
    theme: string | null;
  };
  /** What one pass produced: the tree it painted, and what it freshly built. */
  type PassResult = { tree: TileNode | null; touched: string[] };
  const newView = (into: HTMLElement, hydrate: boolean): MountView => ({
    target: into,
    hydrate,
    root: null,
    tree: null,
    map: new WeakMap(),
    theme: null,
  });
  const ownView = newView(target, options.hydrate === true);
  const views: MountView[] = [ownView];
  const attach = (into: HTMLElement): MountHandle => {
    const view = newView(into, false);
    views.push(view);
    registerAppRoot(into, app);
    withRenderingApp(app, () => {
      withRenderingView(view.target, () => renderPass(view));
    });
    return { dispose: () => disposeView(view), episodes: () => episode?.list() ?? [] };
  };
  let lastRenderTouched: string[] = [];
  let disposed = false;
  const namedTimers = new Map<string, ReturnType<typeof setInterval>>();
  const anonTimers: ReturnType<typeof setInterval>[] = [];
  let prevMountedTiles = new Set<string>();
  let inRouteErrorHandlers = false;
  const render = (): void => {
    if (disposed || inRouteErrorHandlers) return;
    withRenderingApp(app, () => {
      const touched: string[] = [];
      let tree: TileNode | null = null;
      for (let i = 0; i < views.length; i++) {
        const view = views[i]!;
        const pass = withRenderingView(view.target, () => renderPass(view));
        if (i === 0) tree = pass.tree;
        touched.push(...pass.touched);
      }
      lastRenderTouched = touched;
      syncMountedTiles(tree);
    });
  };
  const renderPass = (view: MountView): PassResult => {
    const target = view.target;
    let touched: string[] = [];
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
    const theme = resolvedThemeName(app) ?? null;
    const themeChanged = theme !== view.theme;
    const repaint = themeChanged && view.tree !== null;
    view.theme = theme;
    settling = repaint;
    const refused = refusedBinds.get(app);
    if (repaint && refused) {
      for (const el of refused.keys()) if (target.contains(el)) refused.delete(el);
    }
    let newMap: TileElementMap = new WeakMap();
    let tileCtx = makeMappingTileCtx(tiles, newMap, ctxWrap);
    let dom: HTMLElement | null = null;
    let renderedTree: TileNode | null = null;
    let panicked = false;
    const fullRender = (tree: TileNode): HTMLElement => {
      newMap = new WeakMap();
      tileCtx = makeMappingTileCtx(tiles, newMap, ctxWrap);
      return tileCtx.render(tree);
    };
    touched = [];
    try {
      renderedTree = pickRootTile(app, slotValues);
      if (view.tree && view.root && !themeChanged) {
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
          reportPanic("reconcile", reconcileErr);
          episode?.recordPanic({
            ...panicInfo(reconcileErr, "tile-render"),
            location: "reconcile",
          });
          dom = fullRender(renderedTree);
          target.replaceChild(dom, view.root);
        }
      } else {
        dom = tileCtx.render(renderedTree);
        if (view.root) {
          target.replaceChild(dom, view.root);
        } else if (view.hydrate && target.firstChild) {
          target.replaceChildren(dom);
        } else {
          target.appendChild(dom);
        }
      }
    } catch (e) {
      const renderRec = panicInfo(e, "tile-render");
      reportPanic("render", e);
      episode?.recordPanic({ ...renderRec, location: "render" });
      if (!fireRouteError(renderRec)) {
        dom = renderPanicFallback(e);
        panicked = true;
      } else {
        try {
          renderedTree = pickRootTile(app, slotValues);
          dom = fullRender(renderedTree);
        } catch (e2) {
          reportPanic("render", e2);
          episode?.recordPanic({ ...panicInfo(e2, "tile-render"), location: "render" });
          renderedTree = null;
          dom = renderPanicFallback(e2);
          panicked = true;
        }
      }
      if (view.root) {
        target.replaceChild(dom, view.root);
      } else if (view.hydrate && target.firstChild) {
        target.replaceChildren(dom);
      } else {
        target.appendChild(dom);
      }
    }
    settling = false;
    view.root = dom;
    view.tree = panicked ? null : renderedTree;
    view.map = newMap;

    if (snap) {
      const byBind = snap.bind
        ? target.querySelectorAll(`[data-kumiki-bind="${snap.bind}"]`)
        : null;
      let sel: Element | null =
        byBind?.length === 1
          ? (byBind[0] ?? null)
          : snap.id
            ? target.querySelector(`#${CSS.escape(snap.id)}`)
            : null;
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
            // Some input types reject setSelectionRange with an InvalidStateError.
            // Focus already landed, which is the load-bearing part of the fallback.
          }
        }
      }
    }

    return { tree: renderedTree, touched };
  };

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
    const info = {
      ...userPanicInfo(rec, rec.location ?? "render", safeEpisodeId()),
      pattern,
    };
    inRouteErrorHandlers = true;
    try {
      for (const h of handlers) {
        try {
          applyReducer(h, { $event: info, $route: cur });
        } catch {
          // a panic inside route.error itself is logged via the inner applyReducer path; we just keep iterating other handlers.
        }
      }
    } finally {
      inRouteErrorHandlers = false;
    }
    return true;
  }

  let inPanicHandler = false;

  let warnedEpisodeSeam = false;

  function safeEpisodeId(): string | undefined {
    try {
      return episode?.currentId();
    } catch (e) {
      if (!warnedEpisodeSeam) {
        warnedEpisodeSeam = true;
        console.warn(`kumiki: episode logger has no currentId(); episode-id will be None`, e);
      }
      return undefined;
    }
  }

  function handleLivePanic(
    location: string,
    e: unknown,
    reducer?: string,
    envReads?: readonly EnvRead[],
  ): void {
    reportPanic(location, e);
    fireAppError(panicInfo(e, "reducer"), location, {
      ...(reducer !== undefined ? { name: reducer } : {}),
      ...(envReads !== undefined && envReads.length > 0 ? { envReads } : {}),
    });
  }

  function fireAppError(
    rec: PanicRecord,
    location: string,
    extra: { name?: string; envReads?: readonly EnvRead[] } = {},
    token?: string,
  ): void {
    const episodeId = episode?.recordPanic({ ...rec, location, ...extra }, token);
    if (inPanicHandler) return;
    const handlers = app.reducers.filter(
      (h) => h.event.kind === "lifecycle" && h.event.name === "app.error",
    );
    if (handlers.length === 0) return;
    const info = userPanicInfo(rec, location, episodeId ?? safeEpisodeId());
    inPanicHandler = true;
    try {
      for (const h of handlers) applyReducer(h, { $event: info });
    } finally {
      inPanicHandler = false;
    }
  }

  function handleCapabilityRefusal(effect: string, cap: string, token?: string): void {
    const rec = reportCapabilityRefusal(effect, cap);
    fireAppError(rec, rec.location, {}, token);
  }

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
    const opened = episode && !episode.hasOpenEpisode();
    if (opened) {
      const t = triggerOfReducer(r);
      episode.beginTrigger({ kind: t.kind, target: t.target, payload });
    }
    try {
      applyReducerBody(r, payload);
    } finally {
      if (opened) episode?.endTrigger();
    }
  }

  /** {@link applyReducer}'s body, minus the episode bracket it runs inside. */
  function applyReducerBody(r: ReducerSpec, payload: Record<string, unknown>): void {
    const outcome = withEnvRecord(() => r.apply(slotValues, payload));
    const envReads = outcome.env.reads;
    if (!outcome.ok) {
      handleLivePanic(`reducer "${r.name}"`, outcome.error, r.name, envReads);
      return;
    }
    const result = outcome.value;
    const { diffs, dirty, rejected } = computeSlotDiffs(slotValues, result, app.slots);
    if (rejected.length > 0) {
      reportRejectedBatch(r.name, rejected);
      episode?.recordReducer(r.name, [], [], envReads);
      return;
    }
    episode?.recordReducer(
      r.name,
      diffs,
      result.emits.map((e) => e.effect),
      envReads,
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
    if (dirty.length > 0) {
      episode?.recordSignalUpdate(dirty, Array.from(new Set(lastRenderTouched)));
    }
  }

  function handleEffectResult(
    effect: string,
    outcome: "ok" | "err",
    value: unknown,
    key: unknown,
    token = "",
  ): void {
    const exitScope = episode?.recordEffectEnd(token, effect, outcome, value);
    let matched = 0;
    try {
      for (const r of app.reducers) {
        if (r.event.kind === "effect" && r.event.effect === effect && r.event.outcome === outcome) {
          applyReducer(r, { $1: value, $2: key });
          matched++;
        }
      }
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
    if (pendingLeave) return;
    const redirectTo = routing.findRedirect(app.routes, router.read());
    if (redirectTo !== null) router.replace(redirectTo);
    const oldRoute = slotValues.route as ParsedRoute;
    const newRoute = routing.parseLocation(app.routes, router.read());
    if (oldRoute && typeof window !== "undefined") {
      const sx = typeof window.scrollX === "number" ? window.scrollX : 0;
      const sy = typeof window.scrollY === "number" ? window.scrollY : 0;
      scrollSaved.set(oldRoute.path, { x: sx, y: sy });
    }
    if (oldRoute && oldRoute.path !== newRoute.path) {
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
      if (routing) router?.replace(routing.href(p.oldRoute));
      slotValues.route = p.oldRoute;
      render();
    }
  }

  installLogEffect(app);
  const nav: NavContext = { navigate: updateRoute, back: () => router?.back() };
  routing?.installNavEffects(app, nav);
  for (const installer of options.builtins ?? []) installer(app, nav);

  lastAppliedThemeName = null;
  applyThemeDefaults(app);
  lastAppliedThemeName = resolvedThemeName(app) ?? null;

  if (routing && router && app.routes && app.routes.length > 0) {
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
  (app as AppShape & { _episodeId?: () => string | undefined })._episodeId = safeEpisodeId;
  (
    app as AppShape & { _dispatch?: (name: string, el: Record<string, unknown>) => void }
  )._dispatch = (reducerName: string, el: Record<string, unknown>) => {
    const r = app.reducers.find((x) => x.name === reducerName);
    if (!r) return;
    const wantId = r.selector?.id;
    if (wantId != null && el.id !== wantId) return;
    applyReducer(r, { $el: el, $event: el });
  };
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
      hash: NONE,
    };
    applyReducer(r, { $route: syntheticRoute });
  };
  (
    app as AppShape & {
      _setSlot?: (name: string, value: unknown, at?: readonly BindSegment[]) => boolean;
    }
  )._setSlot = (name: string, value: unknown, at?: readonly BindSegment[]) => {
    if (!slotAccepts(app.slots[name], value, at)) return false;
    slotValues[name] = value;
    render();
    return true;
  };
  (app as AppShape & { _navigate?: (path: string, replace?: boolean) => void })._navigate = (
    path: string,
    replace?: boolean,
  ) => {
    updateRoute(path, !!replace);
  };
  (app as AppShape & { _resolveLeave?: (outcome: "yes" | "no") => void })._resolveLeave =
    resolveLeave;
  (
    app as AppShape & { _submitHeldBy?: (e: Event) => readonly string[] | undefined }
  )._submitHeldBy = submitHeldBy;

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
  const lifecycleUnsubs = installLifecycleListeners(app, applyReducer);
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
  mountedShapes.set(app, { attach });
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

export function reportCapabilityRefusal(
  effect: string,
  cap: string,
): PanicRecord & { location: string } {
  const location = `effect "${effect}"`;
  const rec: PanicRecord & { location: string } = {
    message: `capability "${cap}" is not declared in app.caps`,
    location,
    stack: undefined,
    cause: undefined,
    category: "capability",
  };
  reportPanicRecord(location, rec, "panic");
  return rec;
}

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
  onCapabilityRefusal: (effect: string, cap: string, token?: string) => void,
  onLaunch?: (effect: string, input: unknown) => string,
  onCancel?: (targetId: string) => void,
  onPolicyCancel?: (token: string, effectName: string) => void,
): Dispatcher {
  type TimerEntry = {
    kind: "debounce" | "throttle";
    h: ReturnType<typeof setTimeout>;
    token?: string;
    effectName?: string;
  };
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
      try {
        onCapabilityRefusal(eff.name, eff.cap, presetToken);
      } finally {
        if (presetToken) onPolicyCancel?.(presetToken, eff.name);
      }
      return;
    }
    const token = presetToken ?? onLaunch?.(eff.name, input) ?? "";
    const id = `${eff.name}:${key}`;
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
      if (eff.cap === "http.cancel") {
        const target = String(emit.args[0] ?? "");
        if (target.length > 0) {
          const ic = state.inflight.get(target);
          if (ic) {
            ic.abort();
            state.inflight.delete(target);
          }
          const q = state.queues.get(target);
          if (q) {
            const waiting = q.pending.splice(0, q.pending.length);
            for (const e of waiting) {
              if (e.token) onPolicyCancel?.(e.token, e.effectName);
            }
          }
          const t = state.timers.get(target);
          if (t !== undefined && t.kind === "debounce") {
            clearTimeout(t.h);
            state.timers.delete(target);
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
      const key = policy.kind === "latest-per-key" ? (emit.key ?? policy.keyOf(input)) : "_";
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
          if (prev.token && prev.effectName) {
            onPolicyCancel?.(prev.token, prev.effectName);
          }
        }
        const token = onLaunch?.(eff.name, input) ?? "";
        const h = setTimeout(() => {
          state.timers.delete(id);
          void launch(eff, input, key, token);
        }, policy.ms);
        state.timers.set(id, { kind: "debounce", h, token, effectName: eff.name });
        return;
      }
      if (policy.kind === "queue") {
        const token = onLaunch?.(eff.name, input) ?? "";
        const entry: QueueEntry = { token, effectName: eff.name };
        const q = state.queues.get(id) ?? { tail: Promise.resolve(), pending: [] };
        q.pending.push(entry);
        const runNext = async (): Promise<void> => {
          const idx = q.pending.indexOf(entry);
          if (idx === -1) return;
          q.pending.splice(idx, 1);
          await launch(eff, input, key, token);
        };
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
      const pendingTimers = [...state.timers.values()];
      state.timers.clear();
      for (const t of pendingTimers) {
        clearTimeout(t.h);
        if (t.kind === "debounce" && t.token && t.effectName) {
          onPolicyCancel?.(t.token, t.effectName);
        }
      }
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

export type PathSegment = string | number | { get: true } | { at: unknown };

/** The segments a `bind=` path can hold — what `TileNode.bindPath` carries. */
export type BindSegment = Extract<PathSegment, string | { get: true }>;

function isUnwrapSegment(seg: PathSegment): seg is { get: true } {
  return typeof seg === "object" && seg !== null && (seg as { get?: unknown }).get === true;
}

function isIndexSegment(seg: PathSegment): seg is { at: unknown } {
  return typeof seg === "object" && seg !== null && Object.hasOwn(seg, "at");
}

export function entryKey(x: unknown): string {
  return x !== null && typeof x === "object" ? sortedJson(x) : String(x);
}

function sortedJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(sortedJson).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const fields = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${sortedJson(o[k])}`);
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export function listPosition(list: readonly unknown[], index: unknown): number {
  if (typeof index === "number" && Number.isInteger(index) && index >= 0 && index < list.length) {
    return index;
  }
  const shown = typeof index === "string" ? JSON.stringify(index) : String(index);
  throw new KumikiPanic(`Index ${shown} is out of range for a List of length ${list.length}`);
}

export function _setPathHelper(
  obj: unknown,
  path: readonly PathSegment[],
  value: unknown,
): unknown {
  if (path.length === 0) return value;
  const step = path[0] as PathSegment;
  const rest = path.slice(1);
  const indexed = isIndexSegment(step);
  const head = (indexed ? step.at : step) as PathSegment;
  if (!indexed && isUnwrapSegment(head)) {
    if (obj && typeof obj === "object" && "_tag" in obj) {
      const o = obj as { _tag: string; _0?: unknown };
      if (o._tag === "None" || o._tag === "Err") return obj;
      if (o._tag === "Some" || o._tag === "Ok") {
        return { ...o, _0: _setPathHelper(o._0, rest, value) };
      }
    }
    return _setPathHelper(obj, rest, value);
  }
  if (Array.isArray(obj)) {
    const at = listPosition(obj, head);
    const element = obj[at];
    if (rest.length > 0 && (element === undefined || element === null)) {
      throw new KumikiPanic(`Index ${at} of a List holds no value to write through`);
    }
    const out = [...obj];
    out[at] = _setPathHelper(element, rest, value);
    return out;
  }
  if (typeof head === "number" && (obj === null || typeof obj !== "object")) {
    throw new KumikiPanic(`Index ${head} reaches no List or Map, but ${String(obj)}`);
  }
  if (indexed && rest.length > 0 && !isEntryOf(obj, head)) return obj;
  const cur = (obj && typeof obj === "object" ? obj : {}) as Record<string, unknown>;
  const key = entryKey(head);
  return { ...cur, [key]: _setPathHelper(cur[key], rest, value) };
}

export function isEntryOf(m: unknown, key: unknown): boolean {
  return m !== null && typeof m === "object" && Object.hasOwn(m, entryKey(key));
}

export function bindLabel(bind: string, path?: readonly BindSegment[]): string {
  if (!path || path.length === 0) return bind;
  return [bind, ...path.map((seg) => (typeof seg === "string" ? seg : "get"))].join(".");
}

export type PanicRecord = {
  message: string;
  location: string | undefined;
  stack: string | undefined;
  cause: PanicCauseLink[] | undefined;
  category: PanicCategory;
};

export function userPanicInfo(
  rec: PanicRecord,
  location: string,
  episodeId: string | undefined,
): {
  message: string;
  location: string;
  "episode-id": OptionOf<string>;
  cause: OptionOf<string>;
  category: PanicCategory;
} {
  const nearest = rec.cause?.[0]?.message;
  return {
    message: rec.message,
    location,
    "episode-id": episodeId === undefined ? NONE : someOf(episodeId),
    cause: nearest ? someOf(nearest) : NONE,
    category: rec.category,
  };
}

const PANIC_CAUSE_MAX_DEPTH = 8;

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

function reportPanic(where: string, e: unknown): void {
  reportPanicRecord(where, panicInfo(e), isPanic(e) ? "panic" : "error");
}

function reportPanicRecord(where: string, rec: PanicRecord, kind: "panic" | "error"): void {
  const lines: string[] = [`[kumiki] ${kind} in ${where}: ${rec.message}`];
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
    if (last.kind !== "err" || last.final) return last;
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
  const { message, location } = panicInfo(e, "tile-render");
  const div = document.createElement("div");
  div.dataset.kumikiPanic = location ?? "";
  div.setAttribute("role", "alert");
  div.textContent = `Something went wrong: ${message}`;
  return div;
}

// ---- tile-level keyed diff ----

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
      applyCommonProps(el, node.props);
      setDecls(el, propStyleDecls(node.props, pickForViewport, node.kind));
      map.set(node, el);
      return el;
    },
  };
  return ctx;
}

type ReconcileDiag = {
  fallback: (fallback: ReconcileFallback, node: TileNode) => void;
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
  const emit = (d: RuntimeDiagnostic): void => {
    try {
      report(d);
    } catch {
      // deliberately ignored — see above
    }
  };
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
  // Different kind → whole subtree is a different thing. Build fresh, splice.
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

function tileTouchedId(node: TileNode): string {
  const asBindable = node as { bind?: unknown; bindPath?: unknown };
  if (typeof asBindable.bind === "string") {
    const bind = asBindable.bind;
    if (Array.isArray(asBindable.bindPath) && asBindable.bindPath.length > 0) {
      return bindLabel(bind, asBindable.bindPath as BindSegment[]);
    }
    return bind;
  }
  if (typeof node.key === "string") return node.key;
  return node.kind;
}

const EMPTY_TILES: TileNode[] = [];
function getTileChildren(node: TileNode): TileNode[] {
  const c = (node as { children?: TileNode[] }).children;
  return Array.isArray(c) ? c : EMPTY_TILES;
}

const TILE_SKIP_TOP: ReadonlySet<string> = new Set(["kind", "children", "key"]);

function tileFieldsEqual(a: TileNode, b: TileNode): boolean {
  const oa = a as unknown as Record<string, unknown>;
  const ob = b as unknown as Record<string, unknown>;
  const keys = new Set<string>();
  for (const k of Object.keys(oa)) if (!TILE_SKIP_TOP.has(k)) keys.add(k);
  for (const k of Object.keys(ob)) if (!TILE_SKIP_TOP.has(k)) keys.add(k);
  for (const k of keys) if (!tileValueEqual(oa[k], ob[k])) return false;
  return true;
}

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
  if (!isPlainDataBag(a) || !isPlainDataBag(b)) return false;
  const oa = a as Record<string, unknown>;
  const ob = b as Record<string, unknown>;
  const keys = new Set<string>([...Object.keys(oa), ...Object.keys(ob)]);
  for (const k of keys) if (!tileValueEqual(oa[k], ob[k])) return false;
  return true;
}

export function isPlainDataBag(v: object): boolean {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function neverEqualCause(a: unknown, b: unknown): NeverEqualCause | undefined {
  if (Number.isNaN(a) && Number.isNaN(b)) return "nan";
  if (a === b) return undefined;
  if (typeof a === "function" && typeof b === "function") return "function-identity";
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return undefined;
  if (Array.isArray(a) || Array.isArray(b)) return undefined;
  if (!isPlainDataBag(a) && !isPlainDataBag(b)) return "non-plain-object";
  return undefined;
}

type UiHandlerSlot = {
  onKeyDown?: EventHandler;
  onMouseEnter?: EventHandler;
  onFocus?: EventHandler;
  onBlur?: EventHandler;
  el?: Record<string, unknown>;
};
const UI_HANDLER_STATE = new WeakMap<HTMLElement, UiHandlerSlot>();
const UI_HANDLER_LISTENING = new WeakSet<HTMLElement>();

const slotHasHandler = (slot: UiHandlerSlot): boolean =>
  Boolean(slot.onKeyDown ?? slot.onMouseEnter ?? slot.onFocus ?? slot.onBlur);

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

function refreshUiHandlerSlot(el: HTMLElement, props?: TileProps): void {
  const slot = toUiHandlerSlot(props);
  UI_HANDLER_STATE.set(el, slot);
  if (slotHasHandler(slot)) installUiEventListeners(el);
}

function applyUiEventHandlers(el: HTMLElement, props?: TileProps): void {
  if (!props) return;
  const slot = toUiHandlerSlot(props);
  if (!slotHasHandler(slot)) return;
  UI_HANDLER_STATE.set(el, slot);
  installUiEventListeners(el);
}

/** Register the four native listeners, once per element. */
function installUiEventListeners(el: HTMLElement): void {
  if (UI_HANDLER_LISTENING.has(el)) return;
  UI_HANDLER_LISTENING.add(el);
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

function renderMissingTile(node: TileNode): HTMLElement {
  console.error(`[kumiki] no renderer registered for tile kind "${node.kind}"`);
  const span = document.createElement("span");
  span.dataset.kumikiTile = node.kind;
  const text = (node as { text?: unknown }).text;
  if (text !== undefined) span.textContent = String(text);
  return span;
}

export type StyleDecl = [property: string, value: string];

export type ResponsivePick = (raw: unknown) => string | number | undefined;

const asScalar = (v: unknown): string | number | undefined =>
  (typeof v === "string" && v !== "") || typeof v === "number" ? v : undefined;

/** The value a server can know: the base, or the literal if it is not a map. */
export const pickBaseValue: ResponsivePick = (raw) => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return asScalar(raw);
  return asScalar((raw as Record<string, unknown>).base);
};

/** style.md §4.2's breakpoints, for a theme that declares none of its own. */
const DEFAULT_BREAKPOINTS: Record<string, ThemeValue> = {
  sm: "640px",
  md: "768px",
  lg: "1024px",
  xl: "1280px",
};

function breakpointWidth(w: ThemeValue): [string, number] | undefined {
  if (typeof w === "object") return undefined;
  const m = /^(\d+(?:\.\d+)?|\.\d+)(px|rem|em)?$/.exec(String(w).trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] ? [`${m[1]}${m[2]}`, m[2] === "px" ? n : n * 16] : [`${n}px`, n];
}

export const pickForViewport: ResponsivePick = (raw) => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return asScalar(raw);
  const m = raw as Record<string, unknown>;
  const declared = currentTheme()?.breakpoints;
  const bps = {
    ...DEFAULT_BREAKPOINTS,
    ...(declared && typeof declared === "object" ? declared : {}),
  };
  const widest: [string, string, number][] = [];
  for (const [k, w] of Object.entries(bps)) {
    const width = breakpointWidth(w);
    if (width) widest.push([k, ...width]);
  }
  widest.sort((a, b) => b[2] - a[2]);
  for (const [bp, w] of widest) {
    if (m[bp] !== undefined && window.matchMedia(`(min-width: ${w})`).matches) {
      return asScalar(m[bp]);
    }
  }
  return asScalar(m.base);
};

export function gridTracks(
  props: TileProps | undefined,
  pick: ResponsivePick,
): { cols: string; rows: string | undefined } {
  return { cols: track(pick(props?.cols)) ?? "repeat(3, 1fr)", rows: track(pick(props?.rows)) };
}

function track(v: string | number | undefined): string | undefined {
  return typeof v === "number" ? `repeat(${v}, 1fr)` : v;
}

function styleBlockDecls(raw: unknown): StyleDecl[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: StyleDecl[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    out.push([key, typeof value === "number" ? `${value}px` : String(value)]);
  }
  return out;
}

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
  for (const [prop, css] of SIZING_PROPS) {
    const v = pick(props[prop]);
    if (v !== undefined) out.push([css, mapLength(v)]);
  }
  // `aspect` is a ratio, not a length: `1` means 1/1, and `1px` means nothing.
  const aspect = pick(props.aspect);
  if (aspect !== undefined) out.push(["aspect-ratio", String(aspect)]);
  if (typeof props.wrap === "boolean") out.push(["flex-wrap", props.wrap ? "wrap" : "nowrap"]);
  const bg = token(props.bg);
  if (bg !== undefined) out.push(["background", mapColor(bg)]);
  const radius = token(props.radius);
  if (radius !== undefined) out.push(["border-radius", mapRadius(radius)]);
  const shadow = token(props.shadow);
  if (shadow !== undefined) out.push(["box-shadow", mapShadow(shadow)]);
  if (props.strike) out.push(["text-decoration", "line-through"]);
  const color = token(props.color);
  if (color !== undefined) out.push(["color", mapColor(color)]);
  const size = token(props.size);
  if (size !== undefined) out.push(["font-size", mapSize(size)]);
  if (props.weight === "bold") out.push(["font-weight", "700"]);
  out.push(...styleBlockDecls(props.style));
  return out;
}

const KIND_OWNED_PROPS: Record<string, readonly string[] | undefined> = {
  spinner: ["size"],
  icon: ["size"],
  skeleton: ["h"],
};

/** A token name a tile wrote, or `undefined` when it wrote none. */
const token = (v: unknown): string | undefined =>
  typeof v === "string" && v !== "" ? v : undefined;

const SIZING_PROPS: ReadonlyArray<readonly [prop: string, css: string]> = [
  ["w", "width"],
  ["h", "height"],
  ["min_w", "min-width"],
  ["min_h", "min-height"],
  ["max_w", "max-width"],
  ["max_h", "max-height"],
];

function mapLength(v: string | number): string {
  if (typeof v === "number") return `${v}px`;
  return v === "full" ? "100%" : v;
}

function setDecls(el: HTMLElement, decls: StyleDecl[]): void {
  for (const [k, v] of decls) el.style.setProperty(k, v);
}

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

export function commonAttrDecls(props?: TileProps): AttrDecl[] {
  if (!props) return [];
  const out: AttrDecl[] = [];
  if (typeof props.class === "string" && props.class.trim() !== "")
    out.push(["class", props.class]);

  if (attrValue(props.id) !== undefined) out.push(["id", String(props.id)]);
  if (attrValue(props.test_id) !== undefined) out.push(["data-kumiki-test", String(props.test_id)]);
  if (attrValue(props.role) !== undefined) out.push(["role", String(props.role)]);
  // A map, or nothing: a `Text` here would spread into `aria-0` / `aria-1`,
  // one attribute per character.
  const aria = props.aria;
  if (aria !== null && typeof aria === "object" && !Array.isArray(aria)) {
    for (const [key, value] of Object.entries(aria as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
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

let settling = false;

function settle(el: HTMLElement): void {
  if (settling) el.setAttribute("data-kumiki-settled", "");
}

function applyTransition(el: HTMLElement, props?: TileProps): void {
  if (!props) return;
  const t = props.transition;
  if (typeof t !== "string") return;
  ensureAnimationStyles();
  settle(el);
  el.classList.add("kumiki-anim", `kumiki-anim-${t}`);
  const d = props.transition_duration;
  if (typeof d === "string") el.classList.add(`kumiki-anim-${d}`);
}

// ----- motion layer -----

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
    "[data-kumiki-settled] { animation-delay: -99999s !important }",
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
  settle(el);
}

let stateStyleSeq = 0;
let stateStylesEl: HTMLStyleElement | null = null;

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

let lastAppliedThemeName: string | null = null;
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
