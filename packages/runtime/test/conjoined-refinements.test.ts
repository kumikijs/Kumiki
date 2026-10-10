import type { AppShape } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bareApp, mountApp } from "./helpers/app.ts";
import { captureConsole } from "./helpers/console.ts";

/** `handle : nominal Text where len-gt(3) where len-lt(9)`, as codegen emits it. */
function makeApp(overrides: Partial<AppShape> = {}): AppShape {
  return bareApp({
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
  });
}

let errors: string[];

beforeEach(() => {
  errors = captureConsole("error");
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
