// A predicate written inside a slot's type — a record field, a union payload,
// a container element — refuses a value as one on the type itself does
// (spec/language.md §1.3.3), and the report has to say where inside
// the value it failed: a record is not "an invalid email", its `email` field
// is. Codegen emits `refineFailure` for such a slot, and nothing else to gate
// it: every check reads it through `slotAccepts`, so these build the slot with
// `refineFailure` alone — a host that assembles a `SlotMeta` the same way gets
// the same gate.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppShape, MountedApp, RefinementFailure } from "../src/core.ts";
import { mount, showRefinementPath, slotAccepts } from "../src/index.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `form : {email: Text where email}`, as codegen emits it. */
const failure = (v: unknown): RefinementFailure | undefined => {
  const email = (v as { email?: unknown } | null)?.email;
  return typeof email === "string" && EMAIL.test(email)
    ? undefined
    : { kind: "email", args: [], path: ["email"] };
};

function makeApp(value: unknown, root: NonNullable<AppShape["root"]>): AppShape {
  return {
    slots: {
      form: { value, refineFailure: failure },
    },
    caps: [],
    effects: {},
    init: [],
    reducers: [
      {
        name: "breakIt",
        event: { kind: "ui", ev: "click" },
        apply: () => ({ slots: { form: { email: "nope" } }, emits: [] }),
      },
    ],
    root,
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
  it("writes each step the way language.md §1.3.3 does", () => {
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
