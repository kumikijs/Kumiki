import { feature } from "@kumikijs/examples";
import { mount, runScenario } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadApp, loadSource } from "./helpers/load.ts";

const stopTimer = feature("25-stop-timer");

const COUNTER = `slot n : Int = 0
reducer bump on=ui.click(Btn) do= n := n + 1
tile Btn = button(text="bump", onClick=bump)
tile App = column(Btn, text("n: " + n.show))
app Counter
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

function freshRoot(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runScenario tears its mount down", () => {
  it("stops a timer reducer, so nothing renders after the report is returned", async () => {
    const app = await loadApp(stopTimer);
    await runScenario(app, freshRoot(), { steps: [{ expect: { noErrors: true } }] });

    const settled = app.live?.remaining;
    expect(settled).toBeGreaterThan(0); // else the clamp at 0 would hide a live timer
    await sleep(350); // three ticks and change
    expect(app.live?.remaining).toBe(settled);
  });

  it("frees the shape, so a second run is a mount rather than a view", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = await loadSource(COUNTER);

    const first = await runScenario(app, freshRoot(), {
      steps: [{ do: { clickText: "bump" }, expect: { state: { n: 1 } } }],
    });
    const second = await runScenario(app, freshRoot(), {
      steps: [{ do: { clickText: "bump" }, expect: { state: { n: 2 } } }],
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(warn.mock.calls.flat().join("\n")).not.toMatch(/already mounted/);
  });

  it("leaves the shape mountable, and that mount renders", async () => {
    const app = await loadSource(COUNTER);
    await runScenario(app, freshRoot(), { steps: [{ expect: { noErrors: true } }] });

    const root = freshRoot();
    const handle = mount(app, root);
    expect(root.textContent).toContain("bump");
    handle.dispose();
  });

  it("returns cleanly when the scenario document is rejected before the mount", async () => {
    const app = await loadSource(COUNTER);
    const report = await runScenario(app, freshRoot(), {
      steps: [{ expect: { animating: [".a"] } as never }],
    });
    expect(report.ok).toBe(false);
  });
});
