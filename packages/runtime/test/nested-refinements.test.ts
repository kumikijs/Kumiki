import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppShape, MountedApp, RefinementFailure } from "../src/core.ts";
import { showRefinementPath, slotAccepts } from "../src/index.ts";
import { bareApp, mountApp } from "./helpers/app.ts";
import { captureConsole } from "./helpers/console.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `form : {email: Text where email}`, as codegen emits it. */
const failure = (v: unknown): RefinementFailure | undefined => {
  const email = (v as { email?: unknown } | null)?.email;
  return typeof email === "string" && EMAIL.test(email)
    ? undefined
    : { kind: "email", args: [], path: ["email"] };
};

function makeApp(value: unknown, root: NonNullable<AppShape["root"]>): AppShape {
  return bareApp({
    slots: {
      form: { value, refineFailure: failure },
    },
    reducers: [
      {
        name: "breakIt",
        event: { kind: "ui", ev: "click" },
        apply: () => ({ slots: { form: { email: "nope" } }, emits: [] }),
      },
    ],
    root,
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

describe("a predicate inside the value", () => {
  it("is named in the rejection with the path it failed at", () => {
    const app = mountApp(
      makeApp({ email: "ada@example.com" }, () => ({ kind: "text", text: "app" })),
    );
    app._dispatch("breakIt", {});
    expect(app.live.form).toEqual({ email: "ada@example.com" });
    expect(errors.join("\n")).toContain(
      'slot "form" cannot hold {"email":"nope"} (email at .email)',
    );
  });

  it("gates a bind write-back too", () => {
    const app = mountApp(
      makeApp({ email: "ada@example.com" }, () => ({ kind: "text", text: "app" })),
    ) as MountedApp & { _setSlot: (name: string, value: unknown) => void };
    app._setSlot("form", { email: "nope" });
    expect(app.live.form).toEqual({ email: "ada@example.com" });
    app._setSlot("form", { email: "grace@example.com" });
    expect(app.live.form).toEqual({ email: "grace@example.com" });
  });

  it("gives the error tile the failed predicate's message", () => {
    mountApp(makeApp({ email: "nope" }, () => ({ kind: "error", field: "form" })));
    expect(document.body.textContent).toContain("Invalid email format");
  });
});

describe("slotAccepts", () => {
  it("reads refineFailure as the whole gate when it is present", () => {
    // A `refine` that disagrees cannot let a value past the walk, or keep one out.
    const meta = { refine: () => true, refineFailure: failure };
    expect(slotAccepts(meta, { email: "nope" })).toBe(false);
    expect(slotAccepts({ refine: () => false, refineFailure: failure }, { email: "a@b.co" })).toBe(
      true,
    );
  });

  it("falls back to refine, and lets everything into a slot with neither", () => {
    expect(slotAccepts({ refine: (v) => v === 1 }, 2)).toBe(false);
    expect(slotAccepts({}, 2)).toBe(true);
    expect(slotAccepts(undefined, 2)).toBe(true);
  });
});

describe("showRefinementPath", () => {
  it("writes each step in path notation", () => {
    expect(showRefinementPath([])).toBe("");
    expect(showRefinementPath(["rows", 2, "email"])).toBe(".rows[2].email");
    expect(showRefinementPath([{ variant: "Some" }, { variant: "Pair", payload: 1 }])).toBe(
      ".Some.Pair[1]",
    );
    expect(showRefinementPath([{ key: "p001" }])).toBe('.keys["p001"]');
    expect(showRefinementPath([{ entry: "p001" }, { entry: 3 }])).toBe('["p001"][3]');
    expect(showRefinementPath([{ member: "" }, { member: 0 }])).toBe('{""}{0}');
  });
});
