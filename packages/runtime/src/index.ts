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
import {
  sessionClear,
  sessionRead,
  sessionWrite,
  storageClear,
  storageRead,
  storageWrite,
} from "./effects-storage.ts";
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
  CONTROL_DEMANDS,
  type ControlDemand,
  ControlRefusal,
  type ControlRefusalReason,
  type ControlState,
  type ControlVerb,
  controlFault,
  judgeRefusal,
  type RefusalVerdict,
  readControl,
  refusesControl,
  type StepFault,
  StepRefusal,
} from "./control-check.ts";
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
  type EnvScopeOutcome,
  type EnvScopeReport,
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
  type OutletFill,
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
  type RefinementFailure,
  type RefinementPart,
  type RefinementStep,
  type RouteEntry,
  type Router,
  type RoutingImpl,
  type RuntimeDiagnostic,
  resolveApp,
  type SlotMeta,
  type SsrSnapshot,
  showRefinementPath,
  slotAccepts,
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
  userPanicInfo,
  withEnvRecord,
  withEnvReplay,
} from "./core.ts";
export { type DispatchTarget, dispatchFault } from "./dispatch-check.ts";
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
  sessionClear,
  sessionRead,
  sessionWrite,
  storageClear,
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
  HEADLESS_EXPECT_KEYS,
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
export { _stdlibCore, type KeyKind } from "./stdlib.ts";
export {
  ConstraintRefusal,
  constraintFault,
  type InvalidControl,
  readInvalidControls,
  SubmitRefusal,
  submitFault,
} from "./submit-check.ts";
export {
  _stdlibTest,
  type EnvDrift,
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
export { levenshtein, nearestName } from "./text-distance.ts";
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

const allTilePatchers: TilePatchers = {
  ...layoutPatchers,
  ...textPatchers,
  ...inputPatchers,
  ...collectionPatchers,
  ...overlayPatchers,
  ...mediaPatchers,
  ...statusPatchers,
};

export function mount(
  app: AppShape,
  target: HTMLElement,
  options: MountOptions = {},
): ReturnType<typeof mountCore> {
  return mountCore(app, target, {
    ...options,
    hostTileKinds: options.hostTileKinds ?? Object.keys(options.tiles ?? {}),
    tiles: options.tiles ? { ...allTiles, ...options.tiles } : allTiles,
    tilePatchers: options.tilePatchers
      ? { ...allTilePatchers, ...options.tilePatchers }
      : allTilePatchers,
    routing: options.routing ?? routing,
    builtins: [installToast, installConfirm, ...(options.builtins ?? [])],
  });
}

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

export const _stdlib = { ..._stdlibCore, ..._stdlibTest };

export const builtinEffects = {
  storageRead,
  storageWrite,
  storageClear,
  sessionRead,
  sessionWrite,
  sessionClear,
  httpFetch,
  indexedRead,
  indexedWrite,
  indexedDelete,
  indexedQuery,
};
