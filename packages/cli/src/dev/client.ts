// Browser entry served by `kumiki dev` (spec §10.7). Loaded as a virtual
// module via /@kumiki-dev/client.ts. The dev plugin substitutes the
// target-path placeholder (see InitialApp import below) with the absolute
// path of the target .kumiki file BEFORE serving this file, so the static
// `import App` line and the `import.meta.hot.accept` boundary share the
// same specifier (a requirement for Vite's HMR matcher).
//
// Lifecycle:
//   1. Create an EpisodeLogger that mirrors every committed Episode into the
//      panel UI AND POSTs it to /__kumiki/episode so `--episode-log` can
//      append a JSONL line matching `kumiki run`'s format.
//   2. Mount the initial AppShape with that logger as MountOptions.episodeLogger.
//   3. On HMR for the target .kumiki: dispose the current mount, copy
//      `currentApp.live` onto the freshly compiled module's default export,
//      and remount — so slot values and route survive the reload.

import InitialApp from "__KUMIKI_TARGET__";
import { type AppShape, createEpisodeLogger, type Episode, mount } from "@kumikijs/runtime";
import { installDevPanel } from "/@kumiki-dev/panel.ts";

const root = document.getElementById("app");
if (!root) throw new Error("kumiki dev: #app container missing from index.html");

let currentApp: AppShape = InitialApp;

const logger = createEpisodeLogger({
  onEpisode(ep: Episode) {
    panel.push(ep);
    void fetch("/__kumiki/episode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ep),
    }).catch(() => {
      // best-effort: dev only; a failed POST shouldn't break the page.
    });
  },
});

const panel = installDevPanel({ logger, getApp: () => currentApp });

let handle = mount(currentApp, root, { episodeLogger: logger });

if (import.meta.hot) {
  import.meta.hot.accept("__KUMIKI_TARGET__", (mod) => {
    if (!mod) return;
    const next = (mod as { default: AppShape }).default;
    // Preserve runtime slot values (and route) across the reload so editing
    // a tile body doesn't reset state — §10.7 "slots are retained".
    const savedLive = currentApp.live;
    handle.dispose();
    currentApp = next;
    if (savedLive) currentApp.live = savedLive;
    handle = mount(currentApp, root, { episodeLogger: logger });
    panel.onRemount(currentApp);
  });
}
