import type { AppShape, MountedApp, TileNode } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appOf, bareApp, lifecycleReducer } from "./helpers/app.ts";
import { defined } from "./helpers/defined.ts";
import { freshRoot } from "./helpers/dom.ts";
import { childAt, childList, stripApp } from "./helpers/reconcile-apps.ts";

let root: HTMLElement;

beforeEach(() => {
  root = freshRoot();
});
afterEach(() => {
  root.remove();
});

function setCount(app: AppShape, count: number): void {
  defined(app.live, "the app's live slots").count = count;
  app._rerender?.();
}

describe("a re-render reuses the DOM of tiles whose data did not change", () => {
  it("keeps the root, the changed heading and every untouched sibling", () => {
    const app = stripApp(5);
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    const [heading, ...rows] = childList(column);

    setCount(app, 1);

    expect(root.firstElementChild).toBe(column);
    expect(childAt(column, 0)).toBe(heading);
    expect(childAt(column, 0).textContent).toBe("Count: 1");
    expect(childList(column).slice(1)).toEqual(rows);
    dispose();
  });

  it("keeps focus and caret on an input whose subtree was not rebuilt", () => {
    const app = stripApp(3, true);
    const { dispose } = mount(app, root);
    const input = defined(root.querySelector("input"), "the bound input");
    input.value = "abc";
    input.focus();
    input.setSelectionRange(2, 2);

    setCount(app, 1);

    expect(root.querySelector("input")).toBe(input);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 2]);
    dispose();
  });

  it("rebuilds the whole subtree when an unkeyed child list changes length", () => {
    let rows = 2;
    const app = appOf(() => ({
      kind: "column",
      children: Array.from({ length: rows }, (_, i) => ({ kind: "text", text: `row ${i}` })),
    }));
    const { dispose } = mount(app, root);
    const texts = (): (string | null)[] =>
      Array.from(root.querySelectorAll("[data-kumiki-tile='text']")).map((el) => el.textContent);
    expect(texts()).toEqual(["row 0", "row 1"]);

    rows = 4;
    app._rerender?.();

    expect(texts()).toEqual(["row 0", "row 1", "row 2", "row 3"]);
    dispose();
  });

  it("still fires tile.mount / tile.unmount across the reconcile path", () => {
    const events: string[] = [];
    let show = true;
    const app = bareApp({
      reducers: [
        lifecycleReducer('tile.mount("Panel")', (s) => {
          events.push("mount");
          return { slots: s, emits: [] };
        }),
        lifecycleReducer('tile.unmount("Panel")', (s) => {
          events.push("unmount");
          return { slots: s, emits: [] };
        }),
      ],
      root: () => {
        const text: TileNode = { kind: "text", text: "p" };
        const panel: TileNode = { kind: "box", children: [text], props: { _tile: "Panel" } };
        return { kind: "column", children: [show ? panel : text] };
      },
    });
    const { dispose } = mount(app, root);
    expect(events).toEqual(["mount"]);

    show = false;
    app._rerender?.();

    expect(events).toEqual(["mount", "unmount"]);
    dispose();
  });

  it("does not register a reused button's click listener again", () => {
    let clicks = 0;
    const app: AppShape = bareApp({
      slots: { n: { value: 0 } },
      reducers: [
        {
          name: "hit",
          event: { kind: "ui", ev: "click" },
          apply: (s) => {
            clicks++;
            return { slots: { n: (s.n as number) + 1 }, emits: [] };
          },
        },
      ],
      root: () => ({
        kind: "column",
        children: [
          { kind: "heading", text: "hdr" },
          {
            kind: "button",
            text: "hit",
            props: { onClick: () => (app as MountedApp)._dispatch("hit", {}) },
          },
        ],
      }),
    });
    const { dispose } = mount(app, root);
    const button = defined(root.querySelector("button"), "the button");
    app._rerender?.();
    app._rerender?.();
    app._rerender?.();

    expect(root.querySelector("button")).toBe(button);
    button.click();
    expect(clicks).toBe(1);
    dispose();
  });

  it("rebuilds only the element whose tile kind changed at its position", () => {
    let showHeading = true;
    const app = appOf(() => ({
      kind: "column",
      children: [
        { kind: "text", text: "top" },
        showHeading ? { kind: "heading", text: "swap me" } : { kind: "text", text: "swap me" },
        { kind: "text", text: "bottom" },
      ],
    }));
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    const [top, middle, bottom] = childList(column);
    expect(middle?.tagName).toBe("H1");

    showHeading = false;
    app._rerender?.();

    expect(root.firstElementChild).toBe(column);
    expect(childAt(column, 0)).toBe(top);
    expect(childAt(column, 2)).toBe(bottom);
    expect(childAt(column, 1)).not.toBe(middle);
    expect(childAt(column, 1).tagName).not.toBe("H1");
    expect(childAt(column, 1).textContent).toBe("swap me");
    dispose();
  });

  it("keeps every ancestor of a changed leaf deep in the tree", () => {
    let n = 0;
    const app = appOf(() => ({
      kind: "column",
      children: [
        { kind: "text", text: "sibling row" },
        {
          kind: "box",
          children: [{ kind: "card", children: [{ kind: "heading", text: `deep ${n}` }] }],
        },
      ],
    }));
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    const sibling = childAt(column, 0);
    const box = childAt(column, 1);
    const card = childAt(box, 0);
    const heading = childAt(card, 0);

    n = 7;
    app._rerender?.();

    expect(root.firstElementChild).toBe(column);
    expect(childAt(column, 0)).toBe(sibling);
    expect(childAt(column, 1)).toBe(box);
    expect(childAt(box, 0)).toBe(card);
    expect(childAt(card, 0)).toBe(heading);
    expect(heading.textContent).toBe("deep 7");
    dispose();
  });
});

describe("a patched tile keeps its element and the state the browser holds on it", () => {
  /** Mounts `tree(n)` and returns a `bump` that increments `n` and re-renders. */
  function drive(tree: (n: number) => TileNode): { bump: () => void; dispose: () => void } {
    let n = 0;
    const app = appOf(() => tree(n));
    const { dispose } = mount(app, root);
    return {
      bump: () => {
        n += 1;
        app._rerender?.();
      },
      dispose,
    };
  }

  const options = (values: string[]) => values.map((v) => ({ label: v.toUpperCase(), value: v }));

  type Row = [
    label: string,
    tree: (n: number) => TileNode,
    selector: string,
    before: (el: HTMLElement) => void,
    after: (el: HTMLElement) => void,
  ];
  const nothing = () => {};

  it.each<Row>([
    [
      "a select whose options list grows, keeping its value",
      (n) => ({
        kind: "select",
        value: "b",
        options: options(n === 0 ? ["a", "b", "c"] : ["a", "b", "c", "d"]),
      }),
      "select",
      (el) => expect((el as HTMLSelectElement).options.length).toBe(3),
      (el) => {
        const sel = el as HTMLSelectElement;
        expect(sel.options.length).toBe(4);
        expect(sel.value).toBe(JSON.stringify("b"));
      },
    ],
    [
      "an input whose value changes",
      (n) => ({ kind: "input", value: `v${n}` }),
      "input",
      (el) => expect((el as HTMLInputElement).value).toBe("v0"),
      (el) => expect((el as HTMLInputElement).value).toBe("v1"),
    ],
    [
      "a video whose controls flip",
      (n) => ({ kind: "video", src: "/demo.mp4", controls: n % 2 === 1 }),
      "video",
      (el) => expect((el as HTMLVideoElement).controls).toBe(false),
      (el) => expect((el as HTMLVideoElement).controls).toBe(true),
    ],
    [
      "an open details whose summary changes",
      (n) => ({
        kind: "details",
        summary: `count ${n}`,
        children: [{ kind: "text", text: "panel" }],
      }),
      "details",
      nothing,
      (el) => {
        expect((el as HTMLDetailsElement).open).toBe(true);
        expect(el.querySelector("summary")?.textContent).toBe("count 1");
      },
    ],
    [
      "an editable beside a changing sibling, keeping its text",
      (n) => ({
        kind: "column",
        children: [
          { kind: "editable", text: "hello", id: "e" },
          { kind: "text", text: `n=${n}` },
        ],
      }),
      "#e",
      (el) => expect(el.contentEditable).toBe("true"),
      (el) => {
        expect(el.contentEditable).toBe("true");
        expect(el.textContent).toBe("hello");
      },
    ],
  ])("%s", (_label, tree, selector, before, after) => {
    const { bump, dispose } = drive(tree);
    const el = defined(root.querySelector<HTMLElement>(selector), selector);
    before(el);
    el.dataset.probe = "seeded";
    if (el instanceof HTMLDetailsElement) el.open = true;

    bump();

    expect(root.querySelector(selector)).toBe(el);
    expect(el.dataset.probe).toBe("seeded");
    after(el);
    dispose();
  });

  it("moves a select's bind marker, which focus restoration looks it up by, with its bind", () => {
    const { bump, dispose } = drive((n) =>
      n === 0
        ? { kind: "select", bind: "draft", bindPath: ["title"], options: [] }
        : { kind: "select", options: [] },
    );
    const sel = defined(root.querySelector("select"), "the mounted select");
    expect(sel.dataset.kumikiBind).toBe("draft.title");

    bump();

    expect(root.querySelector("select")).toBe(sel);
    expect(sel.dataset.kumikiBind).toBeUndefined();
    dispose();
  });

  it("routes an input's writes to the new slot after its bind changes", () => {
    let bind: "a" | "b" = "a";
    const app = bareApp({
      slots: { a: { value: "" }, b: { value: "" } },
      root: () => ({ kind: "input", bind, placeholder: bind === "a" ? "first" : "second" }),
    });
    const { dispose } = mount(app, root);
    const live = defined(app.live, "the app's live slots");
    const input = defined(root.querySelector("input"), "the bound input");
    input.value = "x";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    bind = "b";
    app._rerender?.();

    expect(root.querySelector("input")).toBe(input);
    input.value = "y";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(live.b).toBe("y");
    expect(live.a).toBe("x");
    dispose();
  });

  it("does not grow a patched tile's state-style token or the shared stylesheet", () => {
    const app: AppShape = bareApp({
      slots: { n: { value: 0 } },
      reducers: [
        {
          name: "bump",
          event: { kind: "ui", ev: "click" },
          apply: (s) => ({ slots: { n: (s.n as number) + 1 }, emits: [] }),
        },
      ],
      root: () => ({
        kind: "column",
        props: { hover: { bg: "red" } },
        children: [{ kind: "text", text: `n=${app.live?.n ?? 0}` }],
      }),
    });
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    const token = column.dataset.kumikiState;
    expect(token).toBeTruthy();
    const sheet = document.getElementById("kumiki-state-styles");
    const rules = sheet?.childNodes.length ?? 0;

    for (let i = 0; i < 10; i++) (app as MountedApp)._dispatch("bump", {});

    expect(column.dataset.kumikiState).toBe(token);
    expect(sheet?.childNodes.length ?? 0).toBe(rules);
    dispose();
  });
});
