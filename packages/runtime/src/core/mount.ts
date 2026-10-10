import type { EnvRead, EpisodeLogger } from "../episode.ts";
import { applyAppMeta } from "./app-meta.ts";
import { forgetRefusedBindsWithin, submitHeldBy } from "./binding.ts";
import {
  installLogEffect,
  makeCapabilityRegistry,
  makeEffectDispatcher,
  readStatus,
  withAnalyticsDefault,
} from "./effects.ts";
import { withEnvRecord } from "./env.ts";
import { restoreFocus, snapshotFocus } from "./focus.ts";
import { collectMountedTiles, installLifecycleListeners } from "./lifecycle.ts";
import { ensureMotionStyles, setSettling } from "./motion.ts";
import { createNavigation } from "./navigation.ts";
import {
  type EmitRefusal,
  type PanicRecord,
  panicInfo,
  renderPanicFallback,
  reportPanic,
  reportRefusedEmit,
  reportUnhandledEffectError,
  userPanicInfo,
} from "./panic.ts";
import { reconcileTree } from "./reconcile.ts";
import { makeReconcileDiag } from "./reconcile-diag.ts";
import { computeSlotDiffs, reportRejectedBatch, slotAccepts } from "./refinement.ts";
import {
  registerAppRoot,
  unregisterAppRoot,
  withRenderingApp,
  withRenderingView,
} from "./rendering.ts";
import { emptyRoute, pickRootTile } from "./route.ts";
import { useStyleRoot } from "./style-root.ts";
import { applyInitialTheme, maybeReapplyTheme, resolvedThemeName } from "./theme.ts";
import { makeMappingTileCtx, type TileElementMap } from "./tile-ctx.ts";
import {
  type AppShape,
  type MountedApp,
  type MountHandle,
  type MountOptions,
  type NavContext,
  NONE,
  type ParsedRoute,
  type ReducerSpec,
  type Router,
  type TileNode,
} from "./types.ts";

const mountedShapes = new WeakMap<AppShape, { attach: (target: HTMLElement) => MountHandle }>();

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
      `mount: this AppShape is already mounted, so a second mount is another view of the same app. ${refused.join(", ")} cannot be given per view — it configures the app itself, which is already running. Mount a \`createApp()\` instance for an independent one.`,
    );
  }
  const ignored = VIEW_IGNORED.filter((k) => optionGiven(record[k]));
  if (ignored.length > 0) {
    console.warn(
      `kumiki: this AppShape is already mounted, so ${ignored.join(", ")} was ignored — the mount that started the app owns it. Mount a \`createApp()\` instance to give this host its own.`,
    );
  }
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
  if (!("route" in app.live)) {
    app.live.route = emptyRoute();
  }
  useStyleRoot(options.styleRoot ?? document, options.styleHost ?? null);
  ensureMotionStyles(app);
  const slotValues = app.live;

  const tiles = options.tiles ?? {};
  const tilePatchers = options.tilePatchers ?? {};

  const routing = options.routing;
  const router: Router | null = routing
    ? routing.createRouter(options.router, options.initialPath)
    : null;

  applyAppMeta(app);
  const providers = withAnalyticsDefault(app, options.providers);
  const caps = makeCapabilityRegistry(app.caps, providers);
  const dispatcher = makeEffectDispatcher(
    app,
    caps,
    (effect, outcome, value, key, token) => {
      handleEffectResult(effect, outcome, value, key, token);
    },
    handleRefusedEmit,
    episode ? (effect, input) => episode.recordEffectStart(effect, input) : undefined,
    episode ? (targetId) => episode.recordEffectCancel(targetId) : undefined,
    episode ? (token, name) => episode.cancelPendingEffect(token, name) : undefined,
  );

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
  const placeRoot = (view: MountView, dom: HTMLElement): void => {
    if (view.root) view.target.replaceChild(dom, view.root);
    else if (view.hydrate && view.target.firstChild) view.target.replaceChildren(dom);
    else view.target.appendChild(dom);
  };
  const renderPass = (view: MountView): PassResult => {
    const target = view.target;
    const focus = snapshotFocus(target);
    maybeReapplyTheme(app);
    const theme = resolvedThemeName(app) ?? null;
    const themeChanged = theme !== view.theme;
    const repaint = themeChanged && view.tree !== null;
    view.theme = theme;
    setSettling(repaint);
    if (repaint) forgetRefusedBindsWithin(app, target);
    let newMap: TileElementMap = new WeakMap();
    let tileCtx = makeMappingTileCtx(tiles, newMap);
    let dom: HTMLElement | null = null;
    let renderedTree: TileNode | null = null;
    let touched: string[] = [];
    let panicked = false;
    const fullRender = (tree: TileNode): HTMLElement => {
      newMap = new WeakMap();
      tileCtx = makeMappingTileCtx(tiles, newMap);
      return tileCtx.render(tree);
    };
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
        placeRoot(view, dom);
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
      placeRoot(view, dom);
    }
    setSettling(false);
    view.root = dom;
    view.tree = panicked ? null : renderedTree;
    view.map = newMap;
    if (focus) restoreFocus(focus, target);
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

  function fireLifecycle(name: string, payload: Record<string, unknown> = {}): void {
    for (const r of app.reducers) {
      if (r.event.kind === "lifecycle" && r.event.name === name) applyReducer(r, payload);
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
          // applyReducer already reported it; the other handlers still run.
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

  function handleRefusedEmit(effect: string, why: EmitRefusal, token?: string): void {
    const rec = reportRefusedEmit(effect, why);
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
      navigation.noteEmit(emit.effect);
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

  installLogEffect(app);
  const navigation = createNavigation({
    app,
    slots: slotValues,
    routing,
    router,
    fireLifecycle,
    render,
  });
  const nav: NavContext = { navigate: navigation.navigate, back: navigation.back };
  routing?.installNavEffects(app, nav);
  for (const installer of options.builtins ?? []) installer(app, nav);

  applyInitialTheme(app);

  navigation.start();

  const seams = app as MountedApp & { _resolveLeave?: (outcome: "yes" | "no") => void };
  seams._rerender = render;
  seams._episodeId = safeEpisodeId;
  seams._dispatch = (reducerName, el) => {
    const r = app.reducers.find((x) => x.name === reducerName);
    if (!r) return;
    const wantId = r.selector?.id;
    if (wantId != null && el.id !== wantId) return;
    applyReducer(r, { $el: el, $event: el });
  };
  seams._prefetch = (reducerName, args, to) => {
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
  seams._setSlot = (name, value, at) => {
    if (!slotAccepts(app.slots[name], value, at)) return false;
    slotValues[name] = value;
    render();
    return true;
  };
  seams._navigate = (path, replace) => navigation.navigate(path, !!replace);
  seams._resolveLeave = navigation.resolveLeave;
  seams._submitHeldBy = submitHeldBy;

  if (options.hydrate) {
    if (!options.bootstrapEpisode) {
      throw new Error(
        "mountCore: `hydrate: true` requires `bootstrapEpisode`. Fall back to a fresh `mount` if the snapshot is missing or version-mismatched.",
      );
    }
    episode?.ingestBootstrap(options.bootstrapEpisode);
  } else {
    for (const emit of app.init) dispatcher.dispatch(emit);
  }
  fireLifecycle("app.start");
  const lifecycleUnsubs = installLifecycleListeners(app, applyReducer);
  for (const r of app.reducers) {
    if (r.event.kind === "timer") {
      const handle = setInterval(() => applyReducer(r, {}), r.event.intervalMs);
      if (r.event.name !== undefined) namedTimers.set(r.event.name, handle);
      else anonTimers.push(handle);
    }
  }
  if (app.routes && app.routes.length > 0) {
    const cur = slotValues.route as ParsedRoute;
    fireLifecycle(`route.enter(${JSON.stringify(cur.pattern)})`, { $route: cur });
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
    navigation.dispose();
    for (const unsub of lifecycleUnsubs) unsub();
    dispatcher.dispose();
    mountedShapes.delete(app);
  }
  return {
    dispose: () => disposeView(ownView),
    episodes: () => episode?.list() ?? [],
  };
}
