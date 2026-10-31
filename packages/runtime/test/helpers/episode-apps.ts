import type {
  AppShape,
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
  dispatch: MountedApp["_dispatch"];
  dispose: () => void;
};

/** Mount `app` on a fresh root with an episode logger that keeps `memoryMax` episodes. */
export function mountLogged(app: AppShape, memoryMax = 10): LoggedMount {
  const logger = createEpisodeLogger({ memoryMax });
  const root = freshRoot();
  const mounted = mount(app, root, { episodeLogger: logger });
  return {
    logger,
    dispatch: (app as MountedApp)._dispatch,
    dispose: () => {
      mounted.dispose();
      root.remove();
    },
  };
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
