// Kumiki runtime — assembled entry. The implementation lives in feature
// modules (#71): `core.ts` (mount/dispatch/theme), `tiles-*.ts` (renderers),
// `router.ts`, `effects-*.ts`, `stdlib.ts` + `testkit.ts`. This entry wires
// the FULL set back together and re-exports the classic API (`mount` with
// every built-in available, the merged `_stdlib`, `builtinEffects`), so the
// single-file `./bundle` / `./bundle.min` artifacts and package consumers are
// unchanged. `kumiki build` instead imports the feature modules directly
// (dist/modules/*) and ships only what the compiled app uses.

import { type AppShape, type MountOptions, mountCore, type TileRenderers } from "./core.ts";
import { installConfirm } from "./effects-confirm.ts";
import { httpFetch } from "./effects-http.ts";
import { indexedDelete, indexedQuery, indexedRead, indexedWrite } from "./effects-indexed.ts";
import { sessionRead, sessionWrite, storageRead, storageWrite } from "./effects-storage.ts";
import { installToast } from "./effects-toast.ts";
import { routing } from "./router.ts";
import { type RenderToStringResult, renderToString } from "./ssr.ts";
import { _stdlibCore } from "./stdlib.ts";
import { _stdlibTest } from "./testkit.ts";
import { collectionTiles } from "./tiles-collection.ts";
import { inputTiles } from "./tiles-input.ts";
import { layoutTiles } from "./tiles-layout.ts";
import { mediaTiles } from "./tiles-media.ts";
import { overlayTiles } from "./tiles-overlay.ts";
import { statusTiles } from "./tiles-status.ts";
import { textTiles } from "./tiles-text.ts";

export {
  type AppShape,
  applyContainerProps,
  applyTextProps,
  type BuiltinInstaller,
  type CapabilityProvider,
  type CapabilityRegistry,
  currentTheme,
  type EffectResult,
  type EffectSpec,
  type EmitSpec,
  type EventHandler,
  KumikiPanic,
  type LocationLike,
  type MountOptions,
  mountCore,
  type NavContext,
  overridableInvoke,
  type ParsedRoute,
  type RedirectEntry,
  type ReducerSpec,
  type RefinementCheck,
  type RouteEntry,
  type Router,
  type RoutingImpl,
  type SlotMeta,
  type SsrSnapshot,
  type Theme,
  type ThemeValue,
  type TileCtx,
  type TileNode,
  type TileProps,
  type TileRenderer,
  type TileRenderers,
  tokenRef,
} from "./core.ts";
export { installConfirm } from "./effects-confirm.ts";
export { httpFetch } from "./effects-http.ts";
export {
  type IndexedDbCfg,
  type IndexedDbStore,
  type IndexRange,
  indexedDelete,
  indexedQuery,
  indexedRead,
  indexedWrite,
} from "./effects-indexed.ts";
export {
  sessionRead,
  sessionWrite,
  storageRead,
  storageWrite,
} from "./effects-storage.ts";
export { installToast } from "./effects-toast.ts";
export {
  type AttributeSlotBinding,
  defineKumikiElement,
  type KumikiElementOptions,
} from "./element.ts";
export {
  createEpisodeLogger,
  type Episode,
  type EpisodeLocalStorage,
  type EpisodeLogger,
  type EpisodeLoggerOptions,
  type EpisodeStatus,
  type EpisodeStep,
  type EpisodeTrigger,
  type SlotDiff,
} from "./episode.ts";
export { routing } from "./router.ts";
export {
  type Action,
  type EffectScript,
  type Expect,
  runScenario,
  type Scenario,
  type ScenarioReport,
  type ScenarioStep,
  type StepResult,
} from "./scenario.ts";
export {
  type SmokeIssue,
  type SmokeOptions,
  type SmokePhase,
  type SmokeReport,
  smoke,
} from "./smoke.ts";
export {
  type RenderedSnapshot,
  type RenderToStringOptions,
  type RenderToStringResult,
  renderToString,
} from "./ssr.ts";
export { renderTileToString } from "./ssr-render.ts";
export { _stdlibCore } from "./stdlib.ts";
export {
  _stdlibTest,
  type EpisodeLogEntry,
  type EpisodeMockPolicy,
  type GenDesc,
  type ReplayApp,
  type ReplayEvent,
  type ReplayObserver,
  type ReplayReport,
  replayEpisodes,
  type TestResult,
} from "./testkit.ts";
export { collectionTiles } from "./tiles-collection.ts";
export { inputTiles } from "./tiles-input.ts";
export { layoutTiles } from "./tiles-layout.ts";
export { mediaTiles } from "./tiles-media.ts";
export { overlayTiles } from "./tiles-overlay.ts";
export { statusTiles } from "./tiles-status.ts";
export { textTiles } from "./tiles-text.ts";

/** Every built-in tile renderer, keyed by `TileNode["kind"]`. */
const allTiles: TileRenderers = {
  ...layoutTiles,
  ...textTiles,
  ...inputTiles,
  ...collectionTiles,
  ...overlayTiles,
  ...mediaTiles,
  ...statusTiles,
};

/**
 * Mount a compiled Kumiki app with the FULL built-in set: every tile renderer,
 * the router, and all built-in effects. This is the classic entry used by the
 * inlined bundle (smoke/run/test, playground), `defineKumikiElement`, and the
 * Vite plugin path. `kumiki build` output calls `mountCore` instead, passing
 * only the modules the app imports (#71). Options can still override/extend the
 * defaults (extra tiles win over built-ins; extra installers run after toast).
 */
export function mount(
  app: AppShape,
  target: HTMLElement,
  options: MountOptions = {},
): ReturnType<typeof mountCore> {
  return mountCore(app, target, {
    ...options,
    tiles: options.tiles ? { ...allTiles, ...options.tiles } : allTiles,
    routing: options.routing ?? routing,
    builtins: [installToast, installConfirm, ...(options.builtins ?? [])],
  });
}

/**
 * Hydrate an SSR-rendered DOM root (docs/spec/runtime.md §10.6.2). Same shape
 * as `mount`, but expects a `renderToString` result so the client can pick up
 * the snapshot + bootstrap episode in a single call. Internally a `mount`
 * with `hydrate: true`: the runtime overlays the snapshot on `app.live`,
 * ingests the bootstrap episode into the logger BEFORE `app.start`, and
 * skips `app.init` (whose effects already ran on the server).
 *
 * §10.6.2 step 1 contract: if the snapshot envelope's `kumiki` version does
 * not match what this runtime expects, drop the snapshot and run a cold CSR
 * boot. This protects deploy-time skew (server emits v2, client cache still
 * on v1) — a mismatched overlay would otherwise feed type-incoherent slots
 * to the live reducers.
 */
export function hydrate(
  app: AppShape,
  target: HTMLElement,
  rendered: Pick<RenderToStringResult, "snapshot" | "bootstrapEpisode">,
  options: MountOptions = {},
): ReturnType<typeof mountCore> {
  if (rendered?.snapshot?.kumiki !== 1) {
    return mount(app, target, options);
  }
  return mount(app, target, {
    ...options,
    ssrSnapshot: rendered.snapshot.slots,
    bootstrapEpisode: rendered.bootstrapEpisode,
    hydrate: true,
  });
}

/**
 * The classic `_stdlib` — production helpers merged with the test harness.
 * Generated monolith code (`bundle: true` paths, the Vite plugin) references
 * this; `kumiki build` output imports `_stdlibCore` (and `_stdlibTest` only
 * when tests are compiled in) so production payloads skip the runners.
 */
export const _stdlib = { ..._stdlibCore, ..._stdlibTest };

/** Built-in capability handlers, grouped — kept for back-compat (#70 contract). */
export const builtinEffects = {
  storageRead,
  storageWrite,
  sessionRead,
  sessionWrite,
  httpFetch,
  indexedRead,
  indexedWrite,
  indexedDelete,
  indexedQuery,
};
