// A `bind` its slot's refinement refuses leaves the slot on the last value it
// accepted and the control on what was typed (spec/forms.md §5.1.2). The two
// then disagree, and `error(field=…)` has to speak for what the field shows —
// it used to read the slot, which still held the old, valid value, so the
// field showed an address it was not holding and no message at all (#443).

import type { AppShape, MountedApp } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `slot contact : Text where email`, an input bound to it, and its error tile. */
function makeApp(): AppShape {
  const app: AppShape = {
    slots: {
      contact: {
        value: "ada@example.com",
        refine: (v) => typeof v === "string" && EMAIL.test(v),
        refineKind: "email",
        refineArgs: [],
      },
      saved: { value: 0 },
    },
    caps: [],
    effects: {},
    init: [],
    reducers: [
      {
        name: "save",
        event: { kind: "ui", ev: "click" },
        apply: (s) => ({ slots: { saved: (s.saved as number) + 1 }, emits: [] }),
      },
      {
        name: "reset",
        event: { kind: "ui", ev: "click" },
        apply: () => ({ slots: { contact: "reset@example.com" }, emits: [] }),
      },
    ],
    root: () => ({
      kind: "column",
      children: [
        { kind: "input", bind: "contact", value: String(app.live?.contact ?? "") },
        { kind: "error", field: "contact" },
      ],
    }),
  };
  return app;
}

function mountApp(): { app: MountedApp; input: HTMLInputElement; error: () => string } {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const app = makeApp();
  mount(app, root);
  const input = root.querySelector("input") as HTMLInputElement;
  const error = () => (root.querySelector('[data-kumiki-tile="error"]')?.textContent ?? "").trim();
  return { app: app as MountedApp, input, error };
}

const type = (input: HTMLInputElement, value: string): void => {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("a bind its refinement refuses", () => {
  it("leaves the slot, and the error tile speaks for what the field shows", () => {
    const { app, input, error } = mountApp();
    type(input, "ada@examplecom");
    expect(app.live.contact).toBe("ada@example.com");
    expect(input.value).toBe("ada@examplecom");
    expect(error()).toBe("Invalid email format");
    // …until the field is edited to a value the slot takes.
    type(input, "ada@example.org");
    expect(app.live.contact).toBe("ada@example.org");
    expect(error()).toBe("");
  });

  it("keeps saying so across an unrelated reducer, until the field moves", () => {
    const { app, input, error } = mountApp();
    type(input, "ada@examplecom");
    app._dispatch("save", {});
    expect(app.live.saved).toBe(1);
    expect(input.value).toBe("ada@examplecom");
    expect(error()).toBe("Invalid email format");
    // The refused value is judged only while the field still shows it: a
    // reducer that rewrites the slot moves the field too, and the message is
    // then about what the field shows now.
    app._dispatch("reset", {});
    expect(input.value).toBe("reset@example.com");
    expect(error()).toBe("");
  });
});
