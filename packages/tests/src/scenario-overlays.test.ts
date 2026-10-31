// Every test in a file shares one document, and so does every scenario the
// example corpus runs, so a run reads and removes only the overlays it opened.

import { type AppShape, runScenario, type Scenario } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { withRoot } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";

const SRC = `slot n : Int = 0
reducer notify on=ui.click(NotifyBtn) do= n := n + 1
                                         emit toast({kind: "info", text: "Saved to the cloud"})
reducer ask    on=ui.click(AskBtn)    do= emit confirm({title: "Reset the counter?", message: "This cannot be undone.", onYes: agreed, onNo: declined})
reducer agreed   on=ui.click(_) do= n := 0
reducer declined on=ui.click(_) do= ()
tile NotifyBtn = button(text="Notify", onClick=notify)
tile AskBtn    = button(text="Ask", onClick=ask)
tile App       = column(NotifyBtn, AskBtn, text("n: " + n.show))
app Overlays
    caps   = [notification.show]
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

const YES = { click: "[data-kumiki-confirm] button[data-kumiki-confirm-action='yes']" };

// Written out rather than imported: these tests pin what a scenario author can rely on.
const OVERLAYS = "[data-kumiki-toast], [data-kumiki-confirm]";
const overlaysInDocument = (): Element[] => Array.from(document.querySelectorAll(OVERLAYS));

async function run(scenario: Scenario, app?: AppShape) {
  const shape = app ?? (await loadSource(SRC, ["notification.show"]));
  return withRoot((root) => runScenario(shape, root, scenario));
}

afterEach(() => {
  for (const el of overlaysInDocument()) el.remove();
});

describe("domIncludes / domExcludes read the runtime's overlays", () => {
  it("reads the text of a toast the step raised", async () => {
    const report = await run({
      steps: [
        { expect: { domExcludes: ["Saved to the cloud"] } },
        {
          do: { clickText: "Notify" },
          // Each text on its own: the root's "n: 1" and the toast's first word
          // are not one string that a substring can match across.
          expect: { domIncludes: ["Saved to the cloud"], domExcludes: ["1Saved"] },
        },
      ],
    });
    expect(report.steps.flatMap((s) => s.failures)).toEqual([]);
    expect(report.ok).toBe(true);
  });

  // The other direction, so a step can say "no toast said this".
  it("fails a domExcludes that only the toast's text breaks", async () => {
    const report = await run({
      steps: [{ do: { clickText: "Notify" }, expect: { domExcludes: ["Saved to the cloud"] } }],
    });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.failures).toEqual(['DOM should NOT include "Saved to the cloud"']);
  });

  it("reads the confirm dialog while it is open, and not once it is answered", async () => {
    const report = await run({
      steps: [
        { do: { clickText: "Notify" } },
        {
          do: { clickText: "Ask" },
          expect: { domIncludes: ["Reset the counter?", "This cannot be undone."] },
        },
        { do: YES, expect: { state: { n: 0 }, domExcludes: ["Reset the counter?"] } },
      ],
    });
    expect(report.steps.flatMap((s) => s.failures)).toEqual([]);
    expect(report.ok).toBe(true);
  });

  // The trace is where an agent looks when a DOM assertion fails, so it shows
  // the text the assertion read rather than a part of it.
  it("puts the overlay's text in the step's domText", async () => {
    const report = await run({ steps: [{ do: { clickText: "Notify" } }] });
    expect(report.steps[0]?.domText).toContain("n: 1");
    expect(report.steps[0]?.domText).toContain("Saved to the cloud");
  });
});

describe("a run reads and removes only the overlays it opened", () => {
  // Left by an earlier test that mounted an app itself, say: it is in the
  // document, but this run did not open it.
  it("does not read an overlay that was in the document before the run", async () => {
    const stale = document.createElement("div");
    stale.dataset.kumikiToast = "";
    stale.textContent = "Left over";
    document.body.appendChild(stale);

    const excluded = await run({ steps: [{ expect: { domExcludes: ["Left over"] } }] });
    expect(excluded.steps[0]?.failures).toEqual([]);
    const included = await run({ steps: [{ expect: { domIncludes: ["Left over"] } }] });
    expect(included.steps[0]?.failures).toEqual(['DOM should include "Left over"']);
    // Not this run's to remove either.
    expect(stale.isConnected).toBe(true);
  });

  it("removes the overlays it opened before it returns", async () => {
    const opened: Element[] = [];
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes)
          if (n instanceof Element && n.matches(OVERLAYS)) opened.push(n);
      }
    });
    observer.observe(document.body, { childList: true });
    const report = await run({
      steps: [{ do: { clickText: "Notify" } }, { do: { clickText: "Ask" } }],
    });
    observer.disconnect();
    expect(report.ok).toBe(true);
    expect(opened.map((el) => el.matches("[data-kumiki-toast]"))).toEqual([true, false]);
    // The toast's own timer has seconds left, and the dialog was never answered.
    expect(opened.filter((el) => el.isConnected)).toEqual([]);
  });

  it("does not read a toast an earlier run of the same app raised", async () => {
    const app = await loadSource(SRC, ["notification.show"]);
    await run({ steps: [{ do: { clickText: "Notify" } }] }, app);
    const report = await run({ steps: [{ expect: { domExcludes: ["Saved to the cloud"] } }] }, app);
    expect(report.steps[0]?.failures).toEqual([]);
  });
});
