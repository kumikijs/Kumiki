// A type may carry several `where` predicates and they conjoin
// (spec/language.md §1.3.1), so `refine` — one function over the whole
// conjunction — cannot say which of them refused a value. `refineAll` keeps
// them apart, and the two places a predicate is named read it: the rejection
// the runtime reports for a discarded batch (spec/runtime.md §10.3.3) and the
// `error` tile's message (spec/forms.md §5.7.1).
//
// Without it both named `refineKind`, which holds one predicate of the chain —
// so a value refused by any of the others was reported against a bound it was
// nowhere near. Removing `refineAll` from a slot below puts each case back to
// that behaviour, which is what these assert against.

import type { AppShape, MountedApp } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** `handle : nominal Text where len-gt(3) where len-lt(9)`, as codegen emits it. */
function makeApp(overrides: Partial<AppShape> = {}): AppShape {
  return {
    slots: {
      handle: {
        value: "kumiki",
        refine: (v) => typeof v === "string" && v.length > 3 && v.length < 9,
        refineKind: "len-gt",
        refineArgs: [3],
        refineAll: [
          { kind: "len-gt", args: [3], refine: (v) => typeof v === "string" && v.length > 3 },
          { kind: "len-lt", args: [9], refine: (v) => typeof v === "string" && v.length < 9 },
        ],
      },
    },
    caps: [],
    effects: {},
    init: [],
    reducers: [
      {
        name: "short",
        event: { kind: "ui", ev: "click" },
        apply: () => ({ slots: { handle: "ab" }, emits: [] }),
      },
      {
        name: "long",
        event: { kind: "ui", ev: "click" },
        apply: () => ({ slots: { handle: "kumikijs!" }, emits: [] }),
      },
      {
        name: "empty",
        event: { kind: "ui", ev: "click" },
        apply: () => ({ slots: { handle: "" }, emits: [] }),
      },
    ],
    root: () => ({ kind: "text", text: "app" }),
    ...overrides,
  };
}

function mountApp(app: AppShape): MountedApp {
  const root = document.createElement("div");
  document.body.appendChild(root);
  mount(app, root);
  return app as MountedApp;
}

let errors: string[];

beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("a rejection names the predicate that refused the value", () => {
  it("names the first predicate when it is the one that fails", () => {
    const app = mountApp(makeApp());
    app._dispatch("short", {});
    expect(app.live.handle).toBe("kumiki");
    expect(errors.join("\n")).toContain('slot "handle" cannot hold "ab" (len-gt(3))');
  });

  it("names the later predicate when that is the one that fails", () => {
    const app = mountApp(makeApp());
    app._dispatch("long", {});
    expect(app.live.handle).toBe("kumiki");
    expect(errors.join("\n")).toContain('slot "handle" cannot hold "kumikijs!" (len-lt(9))');
  });

  it("names the first of the ones a value fails, not merely one of them", () => {
    // `""` is refused by BOTH predicates of a `len-gt(3)` / `len-lt(9)` type:
    // too short, and (vacuously) short enough. Only the order decides which is
    // named, so this is the case that tells `find` from `findLast`.
    const app = mountApp(makeApp());
    app._dispatch("empty", {});
    expect(app.live.handle).toBe("kumiki");
    expect(errors.join("\n")).toContain('slot "handle" cannot hold "" (len-gt(3))');
    expect(errors.join("\n")).not.toContain("len-lt");
  });

  it("still names the single predicate of a slot that carries one", () => {
    const app = mountApp(
      makeApp({
        slots: {
          handle: {
            value: "kumiki",
            refine: (v) => typeof v === "string" && v.length > 3,
            refineKind: "len-gt",
            refineArgs: [3],
          },
        },
      }),
    );
    app._dispatch("short", {});
    expect(errors.join("\n")).toContain('slot "handle" cannot hold "ab" (len-gt(3))');
  });
});

describe("the error tile renders the failed predicate's message", () => {
  const withError = (value: string): AppShape =>
    makeApp({
      slots: {
        handle: {
          ...makeApp().slots.handle,
          value,
        },
      },
      root: () => ({ kind: "error", field: "handle" }),
    });

  it("reads the first predicate's message when it is the one that fails", () => {
    mountApp(withError("ab"));
    expect(document.body.textContent).toContain("Must be more than 3 characters");
  });

  it("reads the later predicate's message when that is the one that fails", () => {
    mountApp(withError("kumikijs!"));
    expect(document.body.textContent).toContain("Must be less than 9 characters");
  });

  it("says nothing for a value both predicates accept", () => {
    mountApp(withError("kumiki"));
    expect(document.body.textContent).toBe("");
  });
});
