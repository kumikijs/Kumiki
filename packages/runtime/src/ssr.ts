// Kumiki SSR — `renderToString` (docs/spec/runtime.md §10.6.1). Produces the
// initial-paint HTML, the non-`volatile` slot snapshot, and the bootstrap
// episode (`trigger.kind = "ssr.hydrate"`) that client `mount` ingests on
// hydration. The walker, the volatile/refine filter, and the route picker
// are all shared with the live mount via `ssr-render.ts` and `core.ts` — no
// duplicate semantics live here. This module is browser-safe: it imports
// nothing Node-specific, so the same code runs on Cloudflare Workers / Vercel
// Edge (§10.6.3).

import {
  type AppShape,
  type CapabilityProvider,
  type CapabilityRegistry,
  computeSlotDiffs,
  type EffectResult,
  type EmitSpec,
  pickRootTile,
  type SsrSnapshot,
} from "./core.ts";
import { createEpisodeLogger, type Episode, type EpisodeLogger } from "./episode.ts";
import { renderTileToString } from "./ssr-render.ts";

export type RenderToStringOptions = {
  /**
   * Initial route path the SSR pass renders for (becomes `app.live.route`
   * and the `bootstrap.trigger.target`). Defaults to `"/"`.
   */
  route?: string;
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
 */
export async function renderToString(
  app: AppShape,
  options: RenderToStringOptions = {},
): Promise<RenderToStringResult> {
  const route = options.route ?? "/";
  if (!app.live) {
    app.live = {};
    for (const [k, v] of Object.entries(app.slots)) app.live[k] = v.value;
  }
  // Synthesise a `route` slot so `pickRootTile` can match against
  // `app.routes` (when present) without bringing in the router module.
  if (!("route" in app.live)) {
    app.live.route = {
      path: route,
      pattern: route,
      params: {},
      query: {},
      hash: null,
    };
  }

  const now = options.now ?? (() => Date.now());
  const loggerOpts: Parameters<typeof createEpisodeLogger>[0] = { now };
  if (options.idGen) loggerOpts.idGen = options.idGen;
  const logger = createEpisodeLogger(loggerOpts);

  const caps: CapabilityRegistry = {
    has: (cap: string) => app.caps.includes(cap),
    provider: (cap: string) => options.providers?.[cap],
  };

  logger.beginTrigger({ kind: "ssr.hydrate", target: route });
  for (const emit of app.init) {
    await dispatchEmit(app, emit, caps, logger);
  }
  logger.endTrigger();

  const list = logger.list();
  const bootstrap = list[list.length - 1];
  if (!bootstrap) {
    throw new Error("renderToString: bootstrap episode was not committed (in-flight effects?)");
  }

  const html = renderTileToString(pickRootTile(app, app.live));

  const slots: SsrSnapshot = {};
  for (const [k, meta] of Object.entries(app.slots)) {
    if (meta.volatile) continue;
    slots[k] = app.live[k];
  }

  const snapshot: RenderedSnapshot = {
    kumiki: 1,
    route,
    slots,
    bootstrap,
    renderedAt: now(),
  };
  return { html, snapshot, bootstrapEpisode: bootstrap };
}

/**
 * Run one effect emit on the SSR pass: invoke the capability, record
 * `effect-start` / `effect-end`, then propagate the result through any
 * matching `{kind: "effect", outcome}` reducer (which may emit further
 * effects — those get awaited inline so the bootstrap episode captures the
 * full causal chain, not just the first level).
 */
async function dispatchEmit(
  app: AppShape,
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
    for (const r of app.reducers) {
      if (
        r.event.kind !== "effect" ||
        r.event.effect !== emit.effect ||
        r.event.outcome !== result.kind
      ) {
        continue;
      }
      let applied: ReturnType<typeof r.apply>;
      try {
        applied = r.apply(app.live as Record<string, unknown>, { $1: result.value });
      } catch {
        // A reducer panic on the server is non-fatal for SSR: leave the slot
        // map unchanged, omit the reducer step, and keep going. The
        // bootstrap episode reflects whatever did succeed.
        continue;
      }
      const { diffs, dirty: d } = computeSlotDiffs(
        app.live as Record<string, unknown>,
        applied.slots,
        app.slots,
      );
      logger.recordReducer(
        r.name,
        diffs,
        applied.emits.map((e) => e.effect),
      );
      for (const nextEmit of applied.emits) {
        await dispatchEmit(app, nextEmit, caps, logger);
      }
      dirty.push(...d);
    }
    if (dirty.length > 0) logger.recordSignalUpdate(dirty);
  } finally {
    exitScope();
  }
}
