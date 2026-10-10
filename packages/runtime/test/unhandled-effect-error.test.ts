import type { AppShape, MountedApp } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { captureConsole } from "./helpers/console.ts";
import { freshRoot } from "./helpers/dom.ts";
import { tick } from "./helpers/time.ts";

/** An app whose `track` effect always errs, since no provider is registered for its capability. */
function makeErringApp(withErrReducer: boolean): AppShape {
  const cap = "telemetry.track";
  return bareApp({
    slots: { failed: { value: false } },
    caps: [cap],
    effects: {
      track: {
        name: "track",
        cap,
        invoke: async (input, caps) => {
          const p = caps.provider(cap);
          if (!p) return { kind: "err", value: { message: "no provider" } };
          return p(input, caps);
        },
      },
    },
    reducers: [
      {
        name: "fire",
        event: { kind: "ui", ev: "click" },
        apply: () => ({ slots: {}, emits: [{ effect: "track", args: [{ name: "click" }] }] }),
      },
      ...(withErrReducer
        ? [
            {
              name: "onFail",
              event: { kind: "effect", effect: "track", outcome: "err" } as const,
              apply: () => ({ slots: { failed: true }, emits: [] }),
            },
          ]
        : []),
    ],
    root: () => ({ kind: "column", children: [] }),
  });
}

describe("an effect error no reducer handles", () => {
  let root: HTMLElement;
  let errors: string[];
  beforeEach(() => {
    root = freshRoot();
    errors = captureConsole("error");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    root.remove();
  });

  it("is surfaced through console.error", async () => {
    const app = makeErringApp(false);
    mount(app, root);
    (app as MountedApp)._dispatch("fire", {});
    await tick(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('effect "track" returned an error');
    expect(errors[0]).toContain("no .err reducer");
  });

  it("stays silent once an .err reducer handles it", async () => {
    const app = makeErringApp(true);
    mount(app, root);
    (app as MountedApp)._dispatch("fire", {});
    await tick(0);
    expect(app.live?.failed).toBe(true);
    expect(errors).toEqual([]);
  });
});
