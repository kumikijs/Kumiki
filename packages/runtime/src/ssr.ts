import {
  type AppShape,
  type CapabilityProvider,
  type CapabilityRegistry,
  computeSlotDiffs,
  type EffectResult,
  type EmitSpec,
  NONE,
  type ParsedRoute,
  panicInfo,
  pickRootTile,
  type RedirectEntry,
  type RoutingImpl,
  readStatus,
  reportCapabilityRefusal,
  reportRejectedBatch,
  reportUnhandledEffectError,
  type SsrSnapshot,
  withEnvRecord,
  withRenderingApp,
} from "./core.ts";
import { createEpisodeLogger, type Episode, type EpisodeLogger } from "./episode.ts";
import { followRedirects, splitPath } from "./router.ts";
import { renderTileToString } from "./ssr-render.ts";

export type RenderToStringOptions = {
  route?: string;
  routing?: RoutingImpl;
  /** Host capability providers — same shape as `MountOptions.providers`. */
  providers?: Record<string, CapabilityProvider>;
  /** Test seam — wall-clock by default. */
  now?: () => number;
  /** Test seam — ULID-shape episode ids by default. */
  idGen?: () => string;
};

export type RenderedSnapshot = {
  kumiki: 1;
  route: string;
  slots: SsrSnapshot;
  bootstrap: Episode;
  renderedAt: number;
};

export type RenderToStringResult = {
  html: string;
  snapshot: RenderedSnapshot;
  bootstrapEpisode: Episode;
};

/**
 * Renders into the app's shared `app.live`, so concurrent renders of one app mix slot values:
 * await each before the next, and read state from the result, not from `app.live`.
 */
export async function renderToString(
  app: AppShape,
  options: RenderToStringOptions = {},
): Promise<RenderToStringResult> {
  const routePath = options.route ?? "/";

  if (!app.live) app.live = {};
  const live = app.live;
  for (const [k, meta] of Object.entries(app.slots)) live[k] = meta.value;

  const requested = splitPath(routePath);
  const routes = app.routes ?? [];
  const redirectTo = options.routing
    ? options.routing.findRedirect(app.routes, requested)
    : followRedirects(
        requested.pathname,
        (path) =>
          routes.find((r): r is RedirectEntry => "redirectTo" in r && r.pattern === path)
            ?.redirectTo ?? null,
      );
  const servedPath = redirectTo ?? routePath;

  const parsedRoute: ParsedRoute =
    options.routing && app.routes && app.routes.length > 0
      ? options.routing.parseLocation(app.routes, splitPath(servedPath))
      : { path: servedPath, pattern: servedPath, params: {}, query: {}, hash: NONE };
  live.route = parsedRoute;

  const now = options.now ?? (() => Date.now());
  const loggerOpts: Parameters<typeof createEpisodeLogger>[0] = { now };
  if (options.idGen) loggerOpts.idGen = options.idGen;
  const logger = createEpisodeLogger(loggerOpts);

  const caps: CapabilityRegistry = {
    has: (cap: string) => app.caps.includes(cap),
    provider: (cap: string) => options.providers?.[cap],
  };

  try {
    logger.beginTrigger({ kind: "ssr.hydrate", target: servedPath });
    await Promise.all(app.init.map((emit) => dispatchEmit(app, live, emit, caps, logger)));
    logger.endTrigger();

    const list = logger.list();
    const bootstrap = list[list.length - 1];
    if (!bootstrap) {
      throw new Error("renderToString: bootstrap episode was not committed (in-flight effects?)");
    }

    const html = withRenderingApp(app, () => renderTileToString(pickRootTile(app, live)));

    const slots: SsrSnapshot = {};
    for (const [k, meta] of Object.entries(app.slots)) {
      if (meta.volatile) continue;
      slots[k] = live[k];
    }

    const snapshot: RenderedSnapshot = {
      kumiki: 1,
      route: servedPath,
      slots,
      bootstrap,
      renderedAt: now(),
    };
    return { html, snapshot, bootstrapEpisode: bootstrap };
  } finally {
    for (const [k, meta] of Object.entries(app.slots)) live[k] = meta.value;
  }
}

async function dispatchEmit(
  app: AppShape,
  live: Record<string, unknown>,
  emit: EmitSpec,
  caps: CapabilityRegistry,
  logger: EpisodeLogger,
): Promise<void> {
  const effect = app.effects[emit.effect];
  if (!effect) return;
  const input = emit.args[0];
  if (effect.cap !== "" && !caps.has(effect.cap)) {
    const token = logger.recordEffectStart(emit.effect, input);
    logger.recordPanic(reportCapabilityRefusal(emit.effect, effect.cap), token);
    logger.cancelPendingEffect(token, emit.effect);
    return;
  }
  const token = logger.recordEffectStart(emit.effect, input);
  let result: EffectResult;
  try {
    result = await Promise.resolve(effect.invoke(input, caps));
  } catch (e) {
    result = {
      kind: "err",
      value: e instanceof Error ? e.message : String(e),
    };
  }
  const exitScope = logger.recordEffectEnd(token, emit.effect, result.kind, result.value);
  try {
    const dirty: string[] = [];
    let matched = 0;
    const followUps: EmitSpec[] = [];
    for (const r of app.reducers) {
      if (
        r.event.kind !== "effect" ||
        r.event.effect !== emit.effect ||
        r.event.outcome !== result.kind
      ) {
        continue;
      }
      const applied = applyReducerOnSsr(r, live, app.slots, result.value, logger, dirty);
      if (applied) {
        matched++;
        followUps.push(...applied.emits);
      }
    }
    if (result.kind === "err" && app.http) {
      const status = readStatus(result.value);
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
          const r = app.reducers.find((x) => x.name === name);
          if (r) {
            const applied = applyReducerOnSsr(r, live, app.slots, result.value, logger, dirty);
            if (applied) {
              matched++;
              followUps.push(...applied.emits);
            }
          }
        }
      }
    }
    if (result.kind === "err" && matched === 0) {
      reportUnhandledEffectError(emit.effect, result.value);
    }
    for (const nextEmit of followUps) {
      await dispatchEmit(app, live, nextEmit, caps, logger);
    }
    if (dirty.length > 0) logger.recordSignalUpdate(dirty);
  } finally {
    exitScope();
  }
}

function applyReducerOnSsr(
  r: AppShape["reducers"][number],
  live: Record<string, unknown>,
  slotMetas: AppShape["slots"],
  value: unknown,
  logger: EpisodeLogger,
  dirtyAcc: string[],
): { emits: EmitSpec[] } | null {
  const outcome = withEnvRecord(() => r.apply(live, { $1: value, $2: undefined }));
  const envReads = outcome.env.reads;
  if (!outcome.ok) {
    // Route SSR panics through the same panicInfo pipeline as the live path so stack + Error.cause survive into the bootstrap episode.
    logger.recordPanic({
      ...panicInfo(outcome.error, "hydrate"),
      location: `reducer "${r.name}"`,
      name: r.name,
      ...(envReads.length > 0 ? { envReads } : {}),
    });
    return null;
  }
  const applied = outcome.value;
  const { diffs, dirty, rejected } = computeSlotDiffs(live, applied, slotMetas);
  if (rejected.length > 0) {
    reportRejectedBatch(r.name, rejected);
    logger.recordReducer(r.name, [], [], envReads);
    return { emits: [] };
  }
  logger.recordReducer(
    r.name,
    diffs,
    applied.emits.map((e) => e.effect),
    envReads,
  );
  dirtyAcc.push(...dirty);
  return { emits: applied.emits };
}
