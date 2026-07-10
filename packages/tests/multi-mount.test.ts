// Two compiled Kumiki apps mounted on ONE page must not cross-wire: clicks
// dispatch to the app owning the clicked tree (generated handlers reference
// their own instance) and bind write-back resolves the owning mount through
// the runtime's root registry — no shared-global last-mount-wins.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount, runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, "..", "examples");
const counter = join(examples, "features", "01-slot-and-reducer.kumiki");
const binder = join(examples, "features", "13-text-input-bind.kumiki");

function freshRoot(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

function clickButton(root: HTMLElement, text: string): void {
  const btn = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);
  if (!btn) throw new Error(`button "${text}" not found`);
  btn.click();
}

function typeInto(root: HTMLElement, value: string): void {
  const inp = root.querySelector("input");
  if (!inp) throw new Error("input not found");
  inp.value = value;
  inp.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("multi-mount isolation (two compiled apps, one page)", () => {
  it("keeps clicks and bind input isolated between two mounted apps", async () => {
    const counterApp = await loadApp(counter);
    const binderApp = await loadApp(binder);
    const counterRoot = freshRoot();
    const binderRoot = freshRoot();
    mount(counterApp, counterRoot);
    mount(binderApp, binderRoot); // last mount must NOT capture the counter's events

    clickButton(counterRoot, "+1");
    expect(counterApp.live?.count).toBe(1);
    expect(counterRoot.textContent ?? "").toContain("Count: 1");
    expect(binderApp.live?.name).toBe("");

    typeInto(binderRoot, "ada");
    expect(binderApp.live?.name).toBe("ada");
    expect(binderRoot.textContent ?? "").toContain("Hello, ada");
    expect(counterApp.live?.count).toBe(1);

    clickButton(counterRoot, "+1");
    expect(counterApp.live?.count).toBe(2);
    expect(binderApp.live?.name).toBe("ada");
  });

  it("runs a scenario against one app without touching the other", async () => {
    const counterApp = await loadApp(counter);
    const binderApp = await loadApp(binder);
    const binderRoot = freshRoot();
    mount(binderApp, binderRoot);

    const report = await runScenario(counterApp, freshRoot(), {
      steps: [
        { do: { clickText: "+1" }, expect: { noErrors: true, state: { count: 1 } } },
        { do: { clickText: "+1" }, expect: { state: { count: 2 } } },
      ],
    });
    expect(report.ok).toBe(true);
    expect(binderApp.live?.name).toBe("");

    typeInto(binderRoot, "grace");
    expect(binderApp.live?.name).toBe("grace");
    expect(counterApp.live?.count).toBe(2);
  });
});
