import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAndLoad } from "./helpers/build-and-load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const TODOMVC = resolve(here, "../../examples/apps/02-todomvc/app.kumiki");

const flush = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

function getInput(root: HTMLElement): HTMLInputElement {
  const inp = root.querySelector('input[data-kumiki-bind="draft"]');
  if (!inp) throw new Error("draft input not found");
  return inp as HTMLInputElement;
}

function getRows(root: HTMLElement): HTMLElement[] {
  // Each TodoRow expands to a `row` with a checkbox + text + remove button.
  // We pick rows whose first child is a label containing a checkbox.
  return Array.from(root.querySelectorAll<HTMLElement>('[data-kumiki-tile="row"]')).filter(
    (row) => {
      const first = row.children[0];
      return first?.getAttribute?.("data-kumiki-tile") === "check";
    },
  );
}

function rowTexts(root: HTMLElement): string[] {
  return getRows(root).map((r) => {
    const span = r.querySelector<HTMLElement>('[data-kumiki-tile="text"]');
    return span?.textContent ?? "";
  });
}

// Re-query the input on every keystroke: each bind write-back re-renders and
// swaps the node in place (focus restore keeps it focused), and a real user's
// next key lands on the LIVE element. Events on the detached previous node are
// a no-op by design — app resolution is anchored to the mounted tree.
async function typeInto(root: HTMLElement, text: string): Promise<void> {
  getInput(root).focus();
  for (const ch of text) {
    const input = getInput(root);
    input.value = input.value + ch;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
  }
}

function submitForm(root: HTMLElement): void {
  const form = root.querySelector<HTMLFormElement>('[data-kumiki-tile="form"]');
  if (!form) throw new Error("form not found");
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

describe("TodoMVC e2e (built from .kumiki)", () => {
  let root: HTMLElement;
  const rootId = "todomvc-root";
  let disposers: Array<{ dispose: () => void }> = [];

  // Track every mount so afterEach can dispose it. Without this, the
  // `saveTodos` debounce(300ms) timer outlives the test and fires AFTER the
  // next test's `localStorage.clear()`, writing stale data that the next
  // test's `loadTodos` then reads back — a cross-test race (flaky).
  function track(d: { dispose: () => void }): { dispose: () => void } {
    disposers.push(d);
    return d;
  }

  beforeEach(() => {
    localStorage.clear();
    root = document.createElement("div");
    root.id = rootId;
    document.body.appendChild(root);
  });

  afterEach(() => {
    for (const d of disposers) d.dispose();
    disposers = [];
    document.body.removeChild(root);
  });

  it("renders empty state with heading + input", async () => {
    const app = await buildAndLoad(TODOMVC, rootId);
    track(mount(app, root));
    expect(root.querySelector("h1")?.textContent).toBe("Todos");
    expect(getInput(root).placeholder).toBe("What needs to be done?");
    expect(getRows(root)).toHaveLength(0);
  });

  it("adds a todo on Enter", async () => {
    const app = await buildAndLoad(TODOMVC, rootId);
    track(mount(app, root));
    await typeInto(root, "Buy milk");
    submitForm(root);
    await flush();
    expect(rowTexts(root)).toEqual(["Buy milk"]);
    // Draft should be cleared.
    expect(getInput(root).value).toBe("");
  });

  it("toggles done state via checkbox", async () => {
    const app = await buildAndLoad(TODOMVC, rootId);
    track(mount(app, root));
    await typeInto(root, "task");
    submitForm(root);
    await flush();
    const check = root.querySelector<HTMLInputElement>(
      '[data-kumiki-tile="check"] input[type="checkbox"]',
    );
    expect(check?.checked).toBe(false);
    check?.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    const recheck = root.querySelector<HTMLInputElement>(
      '[data-kumiki-tile="check"] input[type="checkbox"]',
    );
    expect(recheck?.checked).toBe(true);
  });

  it("removes a todo via × button", async () => {
    const app = await buildAndLoad(TODOMVC, rootId);
    track(mount(app, root));
    await typeInto(root, "ephemeral");
    submitForm(root);
    await flush();
    expect(rowTexts(root)).toEqual(["ephemeral"]);
    const removeBtn = Array.from(
      root.querySelectorAll<HTMLButtonElement>('[data-kumiki-tile="button"]'),
    ).find((b) => b.textContent === "x");
    removeBtn?.click();
    await flush();
    expect(rowTexts(root)).toEqual([]);
  });

  it("filters Active / Done", async () => {
    const app = await buildAndLoad(TODOMVC, rootId);
    track(mount(app, root));
    await typeInto(root, "todo1");
    submitForm(root);
    await flush();
    await typeInto(root, "todo2");
    submitForm(root);
    await flush();
    // Toggle the first row done.
    const firstCheckbox = root.querySelectorAll<HTMLInputElement>(
      '[data-kumiki-tile="check"] input[type="checkbox"]',
    )[0];
    firstCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    // Find the filter buttons (text "All" / "Active" / "Done").
    const allBtns = Array.from(
      root.querySelectorAll<HTMLButtonElement>('[data-kumiki-tile="button"]'),
    );
    const active = allBtns.find((b) => b.textContent === "Active");
    const done = allBtns.find((b) => b.textContent === "Done");

    active?.click();
    await flush();
    expect(rowTexts(root)).toHaveLength(1);
    expect(rowTexts(root)[0]).not.toBe(""); // remaining = the un-toggled one

    done?.click();
    await flush();
    expect(rowTexts(root)).toHaveLength(1);
  });

  it("clears completed todos", async () => {
    const app = await buildAndLoad(TODOMVC, rootId);
    track(mount(app, root));
    await typeInto(root, "keep");
    submitForm(root);
    await flush();
    await typeInto(root, "drop");
    submitForm(root);
    await flush();
    const checkboxes = root.querySelectorAll<HTMLInputElement>(
      '[data-kumiki-tile="check"] input[type="checkbox"]',
    );
    // Toggle one (whichever happens to be "drop"). For simplicity, toggle both
    // and clear-completed should remove both.
    checkboxes[0].dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    checkboxes[1].dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    const clearBtn = Array.from(
      root.querySelectorAll<HTMLButtonElement>('[data-kumiki-tile="button"]'),
    ).find((b) => b.textContent === "Clear completed");
    clearBtn?.click();
    await flush();
    expect(rowTexts(root)).toEqual([]);
  });

  it("persists to localStorage", async () => {
    const app = await buildAndLoad(TODOMVC, rootId);
    track(mount(app, root));
    await typeInto(root, "persisted");
    submitForm(root);
    // saveTodos has policy=debounce(300ms). Wait long enough for it to fire.
    await flush(400);
    const stored = localStorage.getItem("todos");
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    const values = Object.values(parsed) as Array<{ text: string }>;
    expect(values.some((t) => t.text === "persisted")).toBe(true);
  });
});
