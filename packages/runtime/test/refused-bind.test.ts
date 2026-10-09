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

describe("a refused bind into a slot gated by a predicate inside its type", () => {
  it("is refused, and its error tile names the field's predicate", () => {
    const ok = { email: "ada@example.com" };
    const bad = { email: "nope" };
    const c: ControlCase = {
      name: "select",
      meta: {
        value: ok,
        refineFailure: (v) =>
          EMAIL.test(String((v as { email?: unknown }).email))
            ? undefined
            : { kind: "email", args: [], path: ["email"] },
      },
      node: (v) => ({
        kind: "select",
        bind: "f",
        value: v,
        options: [
          { label: "ada", value: ok },
          { label: "broken", value: bad },
          { label: "grace", value: { email: "grace@example.com" } },
        ],
      }),
      refuse: (el) => {
        (el as HTMLSelectElement).selectedIndex = 1;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      },
      message: "Invalid email format",
      resetTo: { email: "grace@example.com" },
    };
    const { app, control, error } = mountControl(c);
    expect(error()).toBe("");
    c.refuse(control);
    expect(app.live.f).toEqual(ok);
    expect(error()).toBe(c.message);
    app._dispatch("reset", {});
    expect(app.live.f).toEqual({ email: "grace@example.com" });
    expect(error()).toBe("");
  });
});

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

  const boxes: [string, string][] = [
    ["check", "checkbox"],
    ["switch", "checkbox"],
    ["radio", "radio"],
  ];
  for (const [kind, type] of boxes) {
    it(`judges a ${kind} by its tick: unticked, the refused tick is stale`, () => {
      const app = {};
      const box = control("on");
      box.type = type;
      box.checked = true;
      noteBindWrite(app, box, "a", true, false);
      expect(refusedBindShown(app, "a", document.body)).toEqual({ value: true });
      box.checked = false;
      expect(refusedBindShown(app, "a", document.body)).toBeUndefined();
      expect(refusedBindControls(app)).toEqual([]);
    });
  }
});

describe("refused values laid over a slot", () => {
  const control = (value: string): HTMLInputElement => {
    const el = document.createElement("input");
    el.value = value;
    document.body.appendChild(el);
    return el;
  };

  it("lays the refused values at two paths over the slot, both of them", () => {
    const app = {};
    noteBindWrite(app, control("1"), "a", "1", false, ["name"]);
    noteBindWrite(app, control("2"), "a", "2", false, ["nick"]);
    const held = { name: "held", nick: "held", email: "e" };
    expect(refusedBindShown(app, "a", document.body, held)).toEqual({
      value: { name: "1", nick: "2", email: "e" },
    });
  });

  it("lets the first of two controls on one path speak for it", () => {
    const app = {};
    noteBindWrite(app, control("first"), "a", "first", false, ["name"]);
    noteBindWrite(app, control("second"), "a", "second", false, ["name"]);
    const held = { name: "held", nick: "n" };
    expect(refusedBindShown(app, "a", document.body, held)).toEqual({
      value: { name: "first", nick: "n" },
    });
  });

  // A control bound to the whole slot shows the value the field controls sit
  // in, so it is laid first and theirs over it — whichever was refused first.
  const whole = { name: "whole-name", nick: "whole-nick" };
  const orders: [string, boolean][] = [
    ["the whole slot first", true],
    ["the field first", false],
  ];
  for (const [order, wholeFirst] of orders) {
    it(`lays a field over a whole-slot refusal, ${order}`, () => {
      const app = {};
      const noteWhole = () => noteBindWrite(app, control("whole"), "a", whole, false, []);
      const noteField = () => noteBindWrite(app, control("x"), "a", "x", false, ["name"]);
      if (wholeFirst) {
        noteWhole();
        noteField();
      } else {
        noteField();
        noteWhole();
      }
      expect(refusedBindShown(app, "a", document.body, { name: "held", nick: "held" })).toEqual({
        value: { name: "x", nick: "whole-nick" },
      });
    });
  }
});
