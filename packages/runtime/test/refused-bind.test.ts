// A `bind` its slot's refinement refuses leaves the slot on the last value it
// accepted and the control on what was typed (spec/forms.md §5.1.2). The two
// then disagree, and `error(field=…)` has to speak for what the field shows —
// it used to read the slot, which still held the old, valid value, so the
// field showed an address it was not holding and no message at all (#443).

import type { AppShape, MountedApp, TileNode } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { noteBindWrite, refusedBindControls, refusedBindShown } from "../src/core.ts";

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

// ---------------------------------------------------------------------------
// What each control "shows". A refused entry is only judged while its control
// still shows what was refused, and each control reports that differently: an
// `editable` has no `.value` and is read by its text, a `slider` is written
// `Number(value)` but shows a string, and a `select` writes the option's value
// while showing that option's key. A row that got its reading wrong would
// either never show the message or never let go of it.

type SlotMeta = NonNullable<AppShape["slots"]>[string];

type ControlCase = {
  name: string;
  meta: SlotMeta;
  node: (value: unknown) => Record<string, unknown>;
  /** Make the control show a value the slot refuses, the way a user would. */
  refuse: (el: HTMLElement) => void;
  message: string;
  /** An accepted value, different from the initial one, that a reducer writes. */
  resetTo: unknown;
};

const email: Omit<SlotMeta, "value"> = {
  refine: (v) => typeof v === "string" && EMAIL.test(v),
  refineKind: "email",
  refineArgs: [],
};

const setValue = (el: HTMLElement, value: string): void => {
  (el as HTMLInputElement).value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

const CONTROLS: ControlCase[] = [
  {
    name: "input",
    meta: { value: "ada@example.com", ...email },
    node: (v) => ({ kind: "input", bind: "f", value: String(v) }),
    refuse: (el) => setValue(el, "ada@examplecom"),
    message: "Invalid email format",
    resetTo: "reset@example.com",
  },
  {
    name: "textarea",
    meta: { value: "ada@example.com", ...email },
    node: (v) => ({ kind: "textarea", bind: "f", value: String(v) }),
    refuse: (el) => setValue(el, "ada@examplecom"),
    message: "Invalid email format",
    resetTo: "reset@example.com",
  },
  {
    name: "editable",
    meta: { value: "ada@example.com", ...email },
    node: (v) => ({ kind: "editable", bind: "f", text: String(v) }),
    refuse: (el) => {
      el.textContent = "ada@examplecom";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    message: "Invalid email format",
    resetTo: "reset@example.com",
  },
  {
    name: "slider",
    meta: {
      value: 2,
      refine: (v) => typeof v === "number" && v >= 0 && v <= 5,
      refineKind: "between",
      refineArgs: [0, 5],
    },
    node: (v) => ({ kind: "slider", bind: "f", value: v, min: 0, max: 10 }),
    refuse: (el) => setValue(el, "8"),
    message: "Must be between 0 and 5",
    resetTo: 4,
  },
  {
    name: "select",
    meta: {
      value: "x",
      refine: (v) => typeof v === "string" && v.length > 0,
      refineKind: "nonempty",
      refineArgs: [],
    },
    node: (v) => ({
      kind: "select",
      bind: "f",
      value: v,
      options: [
        { label: "none", value: "" },
        { label: "X", value: "x" },
        { label: "Y", value: "y" },
      ],
    }),
    refuse: (el) => {
      (el as HTMLSelectElement).selectedIndex = 0;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    message: "Required",
    resetTo: "y",
  },
];

function mountControl(c: ControlCase): {
  app: MountedApp;
  control: HTMLElement;
  error: () => string;
} {
  const app: AppShape = {
    slots: { f: c.meta, saved: { value: 0 } },
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
        apply: () => ({ slots: { f: c.resetTo }, emits: [] }),
      },
    ],
    root: () =>
      ({
        kind: "column",
        children: [c.node(app.live?.f ?? c.meta.value), { kind: "error", field: "f" }],
      }) as TileNode,
  };
  const root = document.createElement("div");
  document.body.appendChild(root);
  mount(app, root);
  const control = root.querySelector(`[data-kumiki-tile="${c.name}"]`) as HTMLElement;
  const error = () => (root.querySelector('[data-kumiki-tile="error"]')?.textContent ?? "").trim();
  return { app: app as MountedApp, control, error };
}

describe("a refused bind is judged by what its control shows", () => {
  for (const c of CONTROLS) {
    it(`${c.name}: holds the message across a re-render, drops it once the control moves`, () => {
      const { app, control, error } = mountControl(c);
      expect(error()).toBe("");
      c.refuse(control);
      expect(app.live.f).toEqual(c.meta.value);
      expect(error()).toBe(c.message);
      app._dispatch("save", {});
      expect(error()).toBe(c.message);
      app._dispatch("reset", {});
      expect(app.live.f).toEqual(c.resetTo);
      expect(error()).toBe("");
    });
  }
});

// ---------------------------------------------------------------------------
// One shape mounted twice is two views of one app (runtime.md §10.9.1). What a
// user typed into one view's field belongs to that view: the other view's
// field still shows the value the slot holds, so its error tile must not speak
// for a value it is not showing.

describe("a refused bind in one view of a shape", () => {
  it("is not reported by the error tile of another view", () => {
    const app = makeApp();
    const hostA = document.createElement("div");
    const hostB = document.createElement("div");
    document.body.append(hostA, hostB);
    mount(app, hostA);
    mount(app, hostB);
    const inputA = hostA.querySelector("input") as HTMLInputElement;
    const inputB = hostB.querySelector("input") as HTMLInputElement;
    const errorIn = (h: HTMLElement) =>
      (h.querySelector('[data-kumiki-tile="error"]')?.textContent ?? "").trim();
    type(inputA, "ada@examplecom");
    expect(inputA.value).toBe("ada@examplecom");
    expect(errorIn(hostA)).toBe("Invalid email format");
    expect(inputB.value).toBe("ada@example.com");
    expect(errorIn(hostB)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// IME composition. Every intermediate value of a JP/CN/KR composition goes
// through the bind, and a strict refinement refuses most of them; re-deriving
// the message on each one would flash it while the user is still composing.
// The message is settled once, when the composition ends.

describe("a refused bind during an IME composition", () => {
  it("leaves the message as it was until compositionend", () => {
    const { app, input, error } = mountApp();
    input.dispatchEvent(new Event("compositionstart"));
    type(input, "ada@examplecomあ");
    expect(app.live.contact).toBe("ada@example.com");
    expect(error()).toBe("");
    type(input, "ada@examplecom亜");
    expect(error()).toBe("");
    input.dispatchEvent(new Event("compositionend"));
    expect(error()).toBe("Invalid email format");
  });

  it("settles nothing when the composition ends on an accepted value", () => {
    const { app, input, error } = mountApp();
    input.dispatchEvent(new Event("compositionstart"));
    type(input, "ada@examplecomあ");
    type(input, "ada@example.jp");
    expect(app.live.contact).toBe("ada@example.jp");
    input.dispatchEvent(new Event("compositionend"));
    expect(error()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// The memory of refused binds must not outlive what it is about. A control
// that left the page, or no longer shows what was refused, is dropped — also
// when nothing ever asks about its slot, and also when an earlier entry for
// the same slot is still live.

describe("the refused-bind memory", () => {
  const control = (value: string): HTMLInputElement => {
    const el = document.createElement("input");
    el.value = value;
    document.body.appendChild(el);
    return el;
  };

  it("drops a control that left the page on the next write, whatever its slot", () => {
    const app = {};
    const gone = control("bad");
    noteBindWrite(app, gone, "a", "bad", false);
    gone.remove();
    const other = control("x");
    noteBindWrite(app, other, "b", "x", true);
    expect(refusedBindControls(app)).toEqual([]);
  });

  it("drops every stale entry for the slot asked about, not just those before a live one", () => {
    const app = {};
    const live = control("bad-1");
    const moved = control("bad-2");
    noteBindWrite(app, live, "a", "bad-1", false);
    noteBindWrite(app, moved, "a", "bad-2", false);
    moved.value = "something else";
    expect(refusedBindShown(app, "a", document.body)).toEqual({ value: "bad-1" });
    expect(refusedBindControls(app)).toEqual([live]);
  });
});
