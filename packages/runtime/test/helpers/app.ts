import type { AppShape, EffectSpec, MountedApp, ReducerSpec, TileNode } from "@kumikijs/runtime";
import { _stdlibCore, mount } from "@kumikijs/runtime";

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

/**
 * A `latest-per-key` effect `name` whose key throws `thrown(arg)` for the argument it is emitted
 * with. The dispatcher reads the key when it takes the emit, after the reducer body that emitted
 * it has returned, so a reducer that emits it throws past its body.
 */
export function keylessEffect(name: string, thrown: (arg: unknown) => unknown): EffectSpec {
  return {
    name,
    cap: "",
    policy: {
      kind: "latest-per-key",
      keyOf: (arg) => {
        throw thrown(arg);
      },
    },
    invoke: async () => ({ kind: "ok", value: null }),
  };
}

export function lifecycleReducer(name: string, apply: ReducerSpec["apply"]): ReducerSpec {
  return {
    name: `r-${name.replace(/[^a-z0-9]/gi, "")}`,
    event: { kind: "lifecycle", name },
    apply,
  };
}

/**
 * `body` under an `error-boundary` that `tile` declares, lowered as codegen lowers one. The
 * fallback is `fallback` of the `episode-id` it was handed, or of `(none)`; by default a text
 * naming it.
 */
export function boundaryAround(
  tile: string,
  body: () => TileNode,
  fallback: (episode: string) => TileNode = (episode) => ({
    kind: "text",
    text: `fallback episode: ${episode}`,
  }),
): TileNode {
  try {
    return body();
  } catch (e) {
    const info = _stdlibCore.boundaryPanic(e, tile) as {
      "episode-id": { _tag: string; _0?: string };
    };
    const ep = info["episode-id"];
    return fallback(ep._tag === "Some" ? (ep._0 ?? "") : "(none)");
  }
}
