import { feature } from "@kumikijs/examples";
import { mount, runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { click, fill, freshRoot } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";

const counter = feature("01-slot-and-reducer");
const binder = feature("13-text-input-bind");

describe("two compiled apps mounted on one page", () => {
  it("keeps clicks and bind input isolated between them", async () => {
    const counterApp = await loadApp(counter);
    const binderApp = await loadApp(binder);
    const counterRoot = freshRoot();
    const binderRoot = freshRoot();
    mount(counterApp, counterRoot);
    // Mounted last, so a page-wide listener of its own would capture the counter's events.
    mount(binderApp, binderRoot);

    click(counterRoot, "+1");
    expect(counterApp.live?.count).toBe(1);
    expect(counterRoot.textContent ?? "").toContain("Count: 1");
    expect(binderApp.live?.name).toBe("");

    fill(binderRoot, "input", "ada");
    expect(binderApp.live?.name).toBe("ada");
    expect(binderRoot.textContent ?? "").toContain("Hello, ada");
    expect(counterApp.live?.count).toBe(1);

    click(counterRoot, "+1");
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

    fill(binderRoot, "input", "grace");
    expect(binderApp.live?.name).toBe("grace");
    expect(counterApp.live?.count).toBe(2);
  });
});
