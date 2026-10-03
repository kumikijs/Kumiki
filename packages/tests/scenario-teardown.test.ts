// What `runScenario` leaves behind when it returns.
//
// It used to leave the app mounted. The handle `mount` hands back was dropped
// on the floor, so nothing ever called `dispose`: the timer reducers kept their
// `setInterval`, the host lifecycle listeners stayed installed, and the shape
// stayed in the runtime's mounted registry.
//
// Two things break because of that, and only one of them is loud:
//
//   - A timer outlives the test file that ran the scenario. Vitest tears the
//     happy-dom environment down between files, and the next tick renders into
//     a world with no `document` — `ReferenceError: document is not defined`,
//     raised as an unhandled error, from a run whose every test passed. It
//     depends on whether a tick lands before the process exits, so it is a
//     flake: it failed CI twice during the v0.13 release and passed on re-run.
//   - A second run of the same `AppShape` is not a second run at all. The shape
//     is still registered as mounted, so the mount becomes another *view* of
//     the first one: `app.init` does not fire again, and `onDiagnostic` — which
//     this runner always passes, to fill each step's `diagnostics` — is refused
//     with a warning, leaving the report silently short.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount, runScenario } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadApp, loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const stopTimer = join(here, "..", "examples", "features", "25-stop-timer.kumiki");

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
  // `25-stop-timer.kumiki` counts `remaining` down from 5 every 100ms. The
  // scenario below never waits, so the run returns with the countdown barely
  // started — and a live timer would keep taking it down afterwards.
  //
  // Asserted as "the value does not move", not as a specific number: how many
  // ticks land inside the run is the scheduler's business.
  it("stops a timer reducer, so nothing renders after the report is returned", async () => {
    const app = await loadApp(stopTimer);
    await runScenario(app, freshRoot(), { steps: [{ expect: { noErrors: true } }] });

    const settled = app.live?.remaining;
    expect(settled).toBeGreaterThan(0); // else the clamp at 0 would hide a live timer
    await sleep(350); // three ticks and change
    expect(app.live?.remaining).toBe(settled);
  });

  // The registry half. A shape still marked as mounted turns the next mount
  // into a view, and a view may not bring its own `onDiagnostic`.
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

  // Teardown must not cost the caller the machinery: after a run, the same
  // shape mounts and renders normally.
  it("leaves the shape mountable, and that mount renders", async () => {
    const app = await loadSource(COUNTER);
    await runScenario(app, freshRoot(), { steps: [{ expect: { noErrors: true } }] });

    const root = freshRoot();
    const handle = mount(app, root);
    expect(root.textContent).toContain("bump");
    handle.dispose();
  });

  // A document the runner refuses never reaches `mount`, so there is nothing to
  // dispose — and the teardown path must not throw on its way out.
  it("returns cleanly when the scenario document is rejected before the mount", async () => {
    const app = await loadSource(COUNTER);
    const report = await runScenario(app, freshRoot(), {
      steps: [{ expect: { animating: [".a"] } as never }],
    });
    expect(report.ok).toBe(false);
  });
});
