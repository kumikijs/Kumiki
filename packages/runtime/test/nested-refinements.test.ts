// A predicate written inside a slot's type — a record field, a union payload,
// a container element — refuses a value as one on the type itself does
// (spec/language.md §1.3.3), and the report has to say where inside
// the value it failed: a record is not "an invalid email", its `email` field
// is. Codegen emits `refineFailure` for such a slot; these read it the way the
// rejection report and the `error` tile do (#444).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppShape, MountedApp, RefinementFailure } from "../src/core.ts";
import { mount } from "../src/index.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `form : {email: Text where email}`, as codegen emits it. */
const failure = (v: unknown): RefinementFailure | undefined => {
  const email = (v as { email?: unknown } | null)?.email;
  return typeof email === "string" && EMAIL.test(email)
    ? undefined
    : { kind: "email", args: [], path: ".email" };
};

function makeApp(value: unknown, root: NonNullable<AppShape["root"]>): AppShape {
  return {
    slots: {
      form: { value, refine: (v) => failure(v) === undefined, refineFailure: failure },
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

  it("gives the error tile the failed predicate's message", () => {
    mountApp(makeApp({ email: "nope" }, () => ({ kind: "error", field: "form" })));
    expect(document.body.textContent).toContain("Invalid email format");
  });
});
