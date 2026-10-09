import InitialApp from "__KUMIKI_TARGET__";
import {
  type AppShape,
  createEpisodeLogger,
  type Episode,
  mount,
  type RuntimeDiagnostic,
} from "@kumikijs/runtime";
import { installDevPanel } from "/@kumiki-dev/panel.ts";

const root = document.getElementById("app");
if (!root) throw new Error("kumiki dev: #app container missing from index.html");

let currentApp: AppShape = InitialApp;

const logger = createEpisodeLogger({
  onEpisode(ep: Episode) {
    panel.push();
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

const mountOptions = {
  episodeLogger: logger,
  onDiagnostic: (d: RuntimeDiagnostic) => {
    switch (d.kind) {
      case "never-equal-prop":
        return console.warn("[kumiki] never-equal prop", d);
      case "reconcile-fallback":
        return console.warn("[kumiki] reconcile fallback", d);
      default: {
        const unlabelled: never = d;
        return console.warn("[kumiki] diagnostic", unlabelled);
      }
    }
  },
};

let handle = mount(currentApp, root, mountOptions);

if (import.meta.hot) {
  import.meta.hot.accept("__KUMIKI_TARGET__", (mod) => {
    if (!mod) return;
    const next = (mod as { default: AppShape }).default;
    const savedLive = currentApp.live;
    try {
      handle.dispose();
      currentApp = next;
      if (savedLive) currentApp.live = savedLive;
      handle = mount(currentApp, root, mountOptions);
      panel.onRemount();
    } catch (e) {
      const err = e as Error;
      panel.showError(err.message ?? String(e), err.stack ?? "");
    }
  });
}
