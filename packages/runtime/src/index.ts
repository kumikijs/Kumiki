// Kumiki runtime — assembled entry. The implementation lives in feature
// modules (#71): `core.ts` (mount/dispatch/theme), `tiles-*.ts` (renderers),
// `router.ts`, `effects-*.ts`, `stdlib.ts` + `testkit.ts`. This entry wires
// the FULL set back together and re-exports the classic API (`mount` with
// every built-in available, the merged `_stdlib`, `builtinEffects`), so the
// single-file `./bundle` / `./bundle.min` artifacts and package consumers are
// unchanged. `kumiki build` instead imports the feature modules directly
// (dist/modules/*) and ships only what the compiled app uses.

import {
  type AppShape,
  type MountOptions,
  mountCore,
  type TilePatchers,
  type TileRenderers,
} from "./core.ts";
import { installConfirm } from "./effects-confirm.ts";
import { httpFetch } from "./effects-http.ts";
import { indexedDelete, indexedQuery, indexedRead, indexedWrite } from "./effects-indexed.ts";
import { sessionRead, sessionWrite, storageRead, storageWrite } from "./effects-storage.ts";
import { installToast } from "./effects-toast.ts";
import { routing } from "./router.ts";
import type { RenderToStringResult } from "./ssr.ts";
import { _stdlibCore } from "./stdlib.ts";
import { _stdlibTest } from "./testkit.ts";
import { collectionPatchers, collectionTiles } from "./tiles-collection.ts";
import { inputPatchers, inputTiles } from "./tiles-input.ts";
import { layoutPatchers, layoutTiles } from "./tiles-layout.ts";
import { mediaPatchers, mediaTiles } from "./tiles-media.ts";
import { overlayPatchers, overlayTiles } from "./tiles-overlay.ts";
import { statusPatchers, statusTiles } from "./tiles-status.ts";
import { textPatchers, textTiles } from "./tiles-text.ts";

export {
  _setPathHelper,
  type AppShape,
  applyContainerProps,
  applyTextProps,
  type BindSegment,
  type BuiltinInstaller,
  beginEnvRecord,
  beginEnvReplay,
  bindLabel,
  type CapabilityProvider,
  type CapabilityRegistry,
  currentTheme,
  type DiagnosticSite,
  type EffectResult,
  type EffectSpec,
  type EmitSpec,
  type EnvRead,
  type EnvReadKind,
  type EventHandler,
  emptyRoute,
  endEnvScope,
  KumikiPanic,
  type LocationLike,
  type MountedApp,
  type MountOptions,
  mountCore,
  type NavContext,
  type NeverEqualCause,
  overridableInvoke,
  type PanicCategory,
  type PanicCauseLink,
  type PanicRecord,
  type ParsedRoute,
  type PathSegment,
  panicInfo,
  type ReconcileFallback,
  type ReconcileFallbackReason,
  type RedirectEntry,
  type ReducerSpec,
  type RefinementCheck,
  type RouteEntry,
  type Router,
  type RoutingImpl,
  type RuntimeDiagnostic,
  resolveApp,
  type SlotMeta,
  type SsrSnapshot,
  type Theme,
  type ThemeValue,
  type TileCtx,
  type TileNode,
  type TilePatcher,
  type TilePatchers,
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
  HEADLESS_ACTION_KEYS,
  runScenario,
  type Scenario,
  type ScenarioReport,
  type ScenarioStep,
  type StepResult,
} from "./scenario.ts";
export {
  describeDiagnostic,
  SMOKE_CONTENT_SELECTORS,
  type SmokeDiagnostic,
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
export { collectionPatchers, collectionTiles } from "./tiles-collection.ts";
export { inputPatchers, inputTiles } from "./tiles-input.ts";
export { layoutPatchers, layoutTiles } from "./tiles-layout.ts";
export { mediaPatchers, mediaTiles } from "./tiles-media.ts";
export { overlayPatchers, overlayTiles } from "./tiles-overlay.ts";
export { statusPatchers, statusTiles } from "./tiles-status.ts";
export { textPatchers, textTiles } from "./tiles-text.ts";

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
 * Every built-in tile patcher (#190), keyed by `TileNode["kind"]`. When a kind
 * appears here, the reconcile diff mutates the mounted element in place on a
 * data-prop change (preserving `<select>` open / focus / caret / `<video>`
 * playback / `<details>` open / `contenteditable`). A kind absent from this
 * map continues to fall back to a full subtree rebuild — patching remains
 * incrementally adoptable rather than an all-or-nothing runtime rewrite.
 */
const allTilePatchers: TilePatchers = {
  ...layoutPatchers,
  ...textPatchers,
  ...inputPatchers,
  ...collectionPatchers,
  ...overlayPatchers,
  ...mediaPatchers,
  ...statusPatchers,
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
    // Whatever the host put in `tiles` here is by definition its own renderer
    // for that kind — this entry supplies the built-ins itself. Note this
    // includes OVERRIDES of built-in kinds, which is intended: a host that
    // replaces the `card` renderer loses the per-element handler slots that
    // make closure reuse safe, exactly like a brand-new kind would. Scopes the
    // per-field host-tile scans; see `MountOptions`.
    hostTileKinds: options.hostTileKinds ?? Object.keys(options.tiles ?? {}),
    tiles: options.tiles ? { ...allTiles, ...options.tiles } : allTiles,
    tilePatchers: options.tilePatchers
      ? { ...allTilePatchers, ...options.tilePatchers }
      : allTilePatchers,
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
