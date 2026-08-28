// Kumiki SSR — `renderToString` (docs/spec/runtime.md §10.6.1). Produces the
// initial-paint HTML, the non-`volatile` slot snapshot, and the bootstrap
// episode (`trigger.kind = "ssr.hydrate"`) that client `mount` ingests on
// hydration. The walker, the volatile/refine filter, the route picker, and
// the status-routing helpers are all shared with the live mount via
// `ssr-render.ts` and `core.ts` — no duplicate semantics live here.
//
// Per-request safety: this module guarantees no cross-request slot leak.
// The compiled `AppShape` is a module-singleton on Edge / Node runtimes
// where the same `App` is reused across requests, and the compiler emits
// tile closures that read from a module-level `_live` aliased to
// `app.live` — so the SSR pass must operate on `app.live` directly. We
// solve the leak by resetting `app.live` to slot defaults at both the
// START and END of every `renderToString` call: any value set during a
// previous request is overwritten before this one runs, and any value
// this request set is wiped before the next one. The host therefore MUST
// NOT assume `app.live` mirrors the latest pass after `renderToString`
// returns. Concurrent SSR calls against the same `app` instance in the
// same JS event loop are NOT supported — Edge / Node patterns serialise
// per request anyway (one fetch handler per request invocation).
//
// This module is browser-safe: it imports nothing Node-specific, so the
// same code runs on Cloudflare Workers / Vercel Edge (§10.6.3).

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
  type RoutingImpl,
  readStatus,
  reportRejectedBatch,
  reportUnhandledEffectError,
  type SsrSnapshot,
  withRenderingApp,
} from "./core.ts";
import { createEpisodeLogger, type Episode, type EpisodeLogger } from "./episode.ts";
import { renderTileToString } from "./ssr-render.ts";

export type RenderToStringOptions = {
  /**
   * Initial route path the SSR pass renders for. The string is treated as a
   * concrete URL path (e.g. `"/posts/abc"`). When `routing` is provided,
   * dynamic patterns (`/posts/:id`) match this path via
   * `RoutingImpl.parseLocation`; otherwise the path is compared to declared
   * route patterns verbatim (so only static routes match without routing).
   * Defaults to `"/"`.
   */
  route?: string;
  /**
   * Routing implementation. Pass `routing` from `@kumikijs/runtime` when the
   * app has dynamic / sub-route patterns — without it, `pickRootTile` only
   * matches exact-string routes and dynamic pages SSR-render the `/404`
   * fallback.
   */
  routing?: RoutingImpl;
  /** Host capability providers — same shape as `MountOptions.providers`. */
  providers?: Record<string, CapabilityProvider>;
  /** Test seam — wall-clock by default. */
  now?: () => number;
  /** Test seam — ULID-shape episode ids by default. */
  idGen?: () => string;
};

/**
 * Versioned SSR snapshot envelope (docs/spec/runtime.md §10.6.1). The
 * `kumiki` field is a hard contract: client hydration that sees a mismatched
 * version drops the snapshot and falls back to a full CSR boot.
 */
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
 * Render `app` to an HTML string and produce the SSR snapshot + bootstrap
 * episode that `mount`/`hydrate` will use on the client (§10.6.1, §10.6.2).
 * The pass runs `app.init` effects through host providers exactly once,
 * collapsing every reducer/effect step into a single `ssr.hydrate` episode
 * — the client takes that as `app.episodes()[0]` and does NOT re-run init,
 * keeping HTTP / IndexedDB / storage effects from firing twice.
 *
 * Per-request hygiene: `app.live` IS reset to slot defaults at both the
 * start and end of every call. This is the cross-request leak guard for
 * the module-singleton `AppShape`. The trade-off is that this module is
 * NOT safe for concurrent SSR calls against the same `app` in the same JS
 * event loop; Edge / Node SSR patterns serialise per request, so this is
 * the right trade-off in practice.
 */
export async function renderToString(
  app: AppShape,
  options: RenderToStringOptions = {},
): Promise<RenderToStringResult> {
  const routePath = options.route ?? "/";

  // Install slot defaults onto `app.live` BEFORE running any effect or
  // tile closure — this is what wipes a previous request's residue. The
  // tile factories the compiler emits read from this `_live`/`app.live`
  // alias, so we can't avoid touching the singleton.
  if (!app.live) app.live = {};
  const live = app.live;
  for (const [k, meta] of Object.entries(app.slots)) live[k] = meta.value;

  // Dynamic-route matching when the host hands us a routing implementation.
  // Without it we fall back to literal string matching (the path becomes
  // its own pattern) — static routes still work; dynamic ones won't.
  const parsedRoute: ParsedRoute =
    options.routing && app.routes && app.routes.length > 0
      ? options.routing.parseLocation(app.routes, {
          pathname: routePath,
          search: "",
          hash: "",
        })
      : { path: routePath, pattern: routePath, params: {}, query: {}, hash: NONE };
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
    logger.beginTrigger({ kind: "ssr.hydrate", target: routePath });
    // Run `app.init` emits concurrently to mirror the live `dispatcher.dispatch`
    // model — sequential await would let cache-first / network-first races land
    // a different "last write wins" than the client would observe.
    await Promise.all(app.init.map((emit) => dispatchEmit(app, live, emit, caps, logger)));
    logger.endTrigger();

    const list = logger.list();
    const bootstrap = list[list.length - 1];
    if (!bootstrap) {
      throw new Error("renderToString: bootstrap episode was not committed (in-flight effects?)");
    }

    // Inside the render bracket, so `@token` references resolve against this
    // app's theme rather than the built-in fallbacks.
    const html = withRenderingApp(app, () => renderTileToString(pickRootTile(app, live)));

    const slots: SsrSnapshot = {};
    for (const [k, meta] of Object.entries(app.slots)) {
      if (meta.volatile) continue;
      slots[k] = live[k];
    }

    const snapshot: RenderedSnapshot = {
      kumiki: 1,
      route: routePath,
      slots,
      bootstrap,
      renderedAt: now(),
    };
    return { html, snapshot, bootstrapEpisode: bootstrap };
  } finally {
    // Always wipe `app.live` back to slot defaults so the next request
    // starts clean. This is the per-request leak guard: even if the
    // host code never explicitly resets `app.live`, the singleton is
    // restored before this call returns.
    for (const [k, meta] of Object.entries(app.slots)) live[k] = meta.value;
  }
}

/**
 * Run one effect emit on the SSR pass: invoke the capability, record
 * `effect-start` / `effect-end`, then propagate the result through any
 * matching `{kind: "effect", outcome}` reducer (which may emit further
 * effects — those get awaited inline so the bootstrap episode captures the
 * full causal chain, not just the first level).
 *
 * Mirrors the live `handleEffectResult` semantics:
 *  - `$1` / `$2` payload shape (`$2` is the dispatcher key — absent on SSR);
 *  - reducer panics surface via `logger.recordPanic` instead of being
 *    silently caught (#37 no-silent-failure);
 *  - `app.http.on401/on403/on5xx` status routing fires for err results;
 *  - an `err` outcome with no matching `.err` reducer is reported via
 *    `reportUnhandledEffectError`.
 */
async function dispatchEmit(
  app: AppShape,
  live: Record<string, unknown>,
  emit: EmitSpec,
  caps: CapabilityRegistry,
  logger: EpisodeLogger,
): Promise<void> {
  const effect = app.effects[emit.effect];
  if (!effect) return;
  // EmitSpec args are positional; the live dispatcher passes `args[0]` as the
  // effect input (the compiler emits a single-value tuple even for unary
  // effects). Mirror that here so SSR and CSR share the same effect signature.
  const input = emit.args[0];
  // Same gate as the live dispatcher's `launch` (§10.4.2): an effect whose
  // capability is absent from `app.caps` is not executed. Empty cap = standard
  // presentation effect (e.g. scroll-to); no permission gate. Claiming the
  // start and cancelling it — the shape a policy-cancelled launch leaves —
  // puts the emit that did not run into the bootstrap episode, which is the
  // only account of the server pass the hydrated client can read.
  if (effect.cap !== "" && !caps.has(effect.cap)) {
    console.warn(`Capability "${effect.cap}" not declared in app.caps`);
    logger.cancelPendingEffect(logger.recordEffectStart(emit.effect, input), emit.effect);
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
    // Status-coded routing for HTTP-shaped err payloads (core.ts:
    // handleEffectResult, spec §6.3.2): err with 401/403/5xx forwards to the
    // global `app.http.on-*` reducer regardless of whether the per-effect
    // `.err` matched.
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
    // No-silent-failure (#37): an err with no `.err` consumer is reported so
    // the host's console / verification tier sees it. Without this, an SSR
    // failure would surface as a successful-looking HTML response.
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

/**
 * Apply one reducer on the SSR pass: capture its slot map, fold it through
 * the shared `computeSlotDiffs` filter, and record either a `reducer` step
 * (success) or a `panic` step (throw). Returns the produced emits so the
 * dispatcher can chain follow-up effects, or `null` if the reducer panicked.
 */
function applyReducerOnSsr(
  r: AppShape["reducers"][number],
  live: Record<string, unknown>,
  slotMetas: AppShape["slots"],
  value: unknown,
  logger: EpisodeLogger,
  dirtyAcc: string[],
): { emits: EmitSpec[] } | null {
  let applied: ReturnType<typeof r.apply>;
  try {
    // `$2` is the dispatcher key on the live path; SSR has no per-emit key
    // (no `latest-per-key` policy resolution), so we pass `undefined` for
    // shape parity rather than omitting it.
    applied = r.apply(live, { $1: value, $2: undefined });
  } catch (e) {
    // Route SSR panics through the same panicInfo pipeline as the live
    // path so stack + Error.cause survive into the bootstrap episode.
    logger.recordPanic({ ...panicInfo(e, "hydrate"), location: `reducer "${r.name}"` });
    return null;
  }
  const { diffs, dirty, rejected } = computeSlotDiffs(live, applied, slotMetas);
  if (rejected.length > 0) {
    // §10.3.3 all-or-nothing, on the server too: nothing was written, so the
    // emits must not chain either. Reported here as well as on the client so a
    // rejection baked into the SSR pass is not discovered only after hydration.
    reportRejectedBatch(r.name, rejected);
    logger.recordReducer(r.name, [], []);
    return { emits: [] };
  }
  logger.recordReducer(
    r.name,
    diffs,
    applied.emits.map((e) => e.effect),
  );
  dirtyAcc.push(...dirty);
  return { emits: applied.emits };
}
