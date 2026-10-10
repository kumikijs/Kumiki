import type { AppShape, MountedApp, ReducerSpec, TileNode } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";

/** An app with no slots, capabilities, effects, init emits or reducers, plus `overrides`. */
export function bareApp(overrides: Partial<AppShape> = {}): AppShape {
  return { slots: {}, caps: [], effects: {}, init: [], reducers: [], ...overrides };
}

/** A bare app whose root tile is produced by `root` on every render pass. */
export function appOf(root: () => TileNode): AppShape {
  return bareApp({ root });
}

/** Mount `app` into a fresh element under `document.body` and hand back its live seams. */
export function mountApp(app: AppShape): MountedApp {
  const root = document.createElement("div");
  document.body.appendChild(root);
  mount(app, root);
  return app as MountedApp;
}

export function lifecycleReducer(name: string, apply: ReducerSpec["apply"]): ReducerSpec {
  return {
    name: `r-${name.replace(/[^a-z0-9]/gi, "")}`,
    event: { kind: "lifecycle", name },
    apply,
  };
}
