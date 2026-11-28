import type {
  AppShape,
  Episode,
  EpisodeLocalStorage,
  EpisodeLogEntry,
  EpisodeLogger,
  MountedApp,
  ReplayObserver,
  ReplayReport,
} from "@kumikijs/runtime";
import { createEpisodeLogger, mount, replayEpisodes } from "@kumikijs/runtime";
import { bareApp } from "./app.ts";
import { freshRoot } from "./dom.ts";

/** An app whose `live` map is already populated, which is what replay needs. */
export type ReplayableApp = AppShape & { live: Record<string, unknown> };

/** A bare app plus `overrides`, its `live` map seeded from the slot defaults. */
export function replayableApp(overrides: Partial<AppShape>): ReplayableApp {
  const app = bareApp({ root: () => ({ kind: "text", text: "" }), ...overrides });
  const live: Record<string, unknown> = {};
  for (const [k, m] of Object.entries(app.slots)) live[k] = m.value;
  return { ...app, live };
}

/** A mount with an episode logger. `dispose` tears it down and takes its root out of the page. */
export type LoggedMount = {
  logger: EpisodeLogger;
  root: HTMLElement;
  dispatch: MountedApp["_dispatch"];
  dispose: () => void;
};

/** Mount `app` on a fresh root with `logger`, by default one that keeps 10 episodes. */
export function mountLogged(
  app: AppShape,
  logger: EpisodeLogger = createEpisodeLogger({ memoryMax: 10 }),
): LoggedMount {
  const root = freshRoot();
  const mounted = mount(app, root, { episodeLogger: logger });
  return {
    logger,
    root,
    dispatch: (app as MountedApp)._dispatch,
    dispose: () => {
      mounted.dispose();
      root.remove();
    },
  };
}

/** What {@link throwingLogger} throws, as a host's episode sink that went offline would. */
export const SINK_DOWN = "episode sink offline";

/**
 * An episode logger whose `method` does its work and then throws {@link SINK_DOWN}, each time
 * `when` holds for what it was handed.
 */
export function throwingLogger<M extends keyof EpisodeLogger>(
  method: M,
  when: (...args: Parameters<EpisodeLogger[M]>) => boolean,
): EpisodeLogger {
  const logger = createEpisodeLogger();
  const work = logger[method] as (...args: Parameters<EpisodeLogger[M]>) => unknown;
  const throwing = (...args: Parameters<EpisodeLogger[M]>): unknown => {
    const out = work(...args);
    if (when(...args)) throw new Error(SINK_DOWN);
    return out;
  };
  return { ...logger, [method]: throwing };
}

/**
 * Mount `app` with an episode logger, dispatch `reducer` once, tear the mount down, and return
 * what was logged as it reads back from a log line (a JSON round trip).
 */
export function recordDispatch(app: AppShape, reducer: string): EpisodeLogEntry[] {
  const { logger, dispatch, dispose } = mountLogged(app);
  try {
    dispatch(reducer, {});
  } finally {
    dispose();
  }
  return JSON.parse(JSON.stringify(logger.list())) as EpisodeLogEntry[];
}

/**
 * An episode logger with a deterministic clock and ids that collects each episode as it commits,
 * then hands it to `onCommit`.
 */
export function recordingLogger(onCommit?: (ep: Episode) => void): {
  logger: EpisodeLogger;
  committed: Episode[];
} {
  const committed: Episode[] = [];
  let t = 1000;
  let seq = 0;
  const logger = createEpisodeLogger({
    now: () => ++t,
    idGen: () => `ep_${(seq++).toString().padStart(4, "0")}`,
    onEpisode: (ep) => {
      committed.push(ep);
      onCommit?.(ep);
    },
  });
  return { logger, committed };
}

/** Replay `episodes` against `app`'s live map with no mocks. */
export function replayInto(
  app: ReplayableApp,
  episodes: EpisodeLogEntry[],
  observer: ReplayObserver = () => "continue",
): ReplayReport {
  return replayEpisodes({
    app: { live: app.live, slots: app.slots, reducers: app.reducers, effects: app.effects },
    episodes,
    mocks: {},
    observer,
  });
}

/** An in-memory `localStorage` for the episode mirror, and the map behind it. */
export function memoryStorage(): { impl: EpisodeLocalStorage; backing: Map<string, string> } {
  const backing = new Map<string, string>();
  return {
    backing,
    impl: {
      getItem: (k) => backing.get(k) ?? null,
      setItem: (k, v) => {
        backing.set(k, v);
      },
      removeItem: (k) => {
        backing.delete(k);
      },
    },
  };
}
