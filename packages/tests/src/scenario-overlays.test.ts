// Every test in a file shares one document, and so does every scenario the
// example corpus runs, so a run reads the overlays that appear during it and
// leaves the document as it found it.

import { type AppShape, type MountedApp, runScenario, type Scenario } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { dialogs, overlays, removeOverlays } from "./helpers/confirm.ts";
import { mountApp, withRoot } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { answerConfirm } from "./helpers/scenario.ts";

const SRC = `slot n : Int = 0
reducer notify on=ui.click(NotifyBtn) do= n := n + 1
                                         emit toast({kind: "info", text: "Saved to the cloud"})
reducer ask    on=ui.click(AskBtn)    do= emit confirm({title: "Reset the counter?", message: "This cannot be undone.", onYes: agreed, onNo: declined})
reducer agreed   on=ui.click(_) do= n := 0
reducer declined on=ui.click(_) do= n := 99
tile NotifyBtn = button(text="Notify", onClick=notify)
tile AskBtn    = button(text="Ask", onClick=ask)
tile App       = column(NotifyBtn, AskBtn, text("n: " + n.show))
app Overlays
    caps   = [notification.show]
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

const INIT_SRC = `tile App = text("ready")
app InitToast
    caps   = [notification.show]
    routes = {"/" -> App, "/404" -> App}
    init   = [toast({kind: "info", text: "Welcome back"})]
`;

const load = (src = SRC): Promise<AppShape> => loadSource(src, ["notification.show"]);

async function run(scenario: Scenario, app?: AppShape) {
  const shape = app ?? (await load());
  return withRoot((root) => runScenario(shape, root, scenario));
}

afterEach(removeOverlays);

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
        {
          do: answerConfirm("yes"),
          expect: { state: { n: 0 }, domExcludes: ["Reset the counter?"] },
        },
      ],
    });
    expect(report.steps.flatMap((s) => s.failures)).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("reads a toast `init` raised, from the first step on", async () => {
    const report = await run(
      { steps: [{ expect: { domIncludes: ["Welcome back"] } }] },
      await load(INIT_SRC),
    );
    expect(report.steps.flatMap((s) => s.failures)).toEqual([]);
  });

  // The trace is where an agent looks when a DOM assertion fails, so it shows
  // the text the assertion read rather than a part of it.
  it("puts the overlay's text in the step's domText", async () => {
    const report = await run({ steps: [{ do: { clickText: "Notify" } }] });
    expect(report.steps[0]?.domText).toContain("n: 1");
    expect(report.steps[0]?.domText).toContain("Saved to the cloud");
  });

  // So a substring copied from the trace is not proof that a step would match it.
  it("collapses whitespace in domText, which the assertions read as it is", async () => {
    const report = await run({
      steps: [{ do: { clickText: "Notify" }, expect: { domExcludes: ["1 Saved"] } }],
    });
    expect(report.steps[0]?.failures).toEqual([]);
    expect(report.steps[0]?.domText).toContain("1 Saved");
  });
});

describe("a run reads only the overlays that appear during it, and cleans up after itself", () => {
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

  it("leaves no overlay of its app behind when it returns", async () => {
    const opened: Element[] = [];
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes)
          if (n instanceof Element && overlays().includes(n)) opened.push(n);
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

  it("removes a toast `init` raised", async () => {
    await run({ steps: [{ expect: { domIncludes: ["Welcome back"] } }] }, await load(INIT_SRC));
    expect(overlays()).toEqual([]);
  });

  // The shape's seams belong to whichever mount owns it now, so a dialog left
  // live would answer into the next run.
  it("leaves no dialog that answers into a later run of the same app", async () => {
    const app = await load();
    await run({ steps: [{ do: { clickText: "Ask" } }] }, app);
    const report = await run(
      {
        steps: [{ do: { key: "button", value: "Escape" }, expect: { state: { n: 0 } } }],
      },
      app,
    );
    expect(report.steps.flatMap((s) => s.failures)).toEqual([]);
  });

  // Its own app closes it when it is disposed, and until then it holds what
  // that app is waiting on.
  it("reads a dialog another app opened during the run, and leaves it open", async () => {
    const other = (await load()) as AppShape & Partial<MountedApp>;
    const app = await load();
    const { root, handle } = mountApp(other);
    try {
      // The run notes what is already open before its promise is handed back.
      const pending = run({ steps: [{ expect: { domIncludes: ["Reset the counter?"] } }] }, app);
      other._dispatch?.("ask", {});
      const report = await pending;
      expect(report.steps.flatMap((s) => s.failures)).toEqual([]);
      expect(dialogs()).toHaveLength(1);
    } finally {
      handle.dispose();
      root.remove();
    }
    expect(dialogs()).toEqual([]);
  });

  it("clicks its own dialog, not one an earlier run left in the document", async () => {
    const stale = document.createElement("div");
    stale.dataset.kumikiConfirm = "1";
    const staleYes = document.createElement("button");
    staleYes.dataset.kumikiConfirmAction = "yes";
    let staleClicks = 0;
    staleYes.addEventListener("click", () => staleClicks++);
    stale.appendChild(staleYes);
    document.body.appendChild(stale);

    const report = await run({
      steps: [
        { do: { clickText: "Notify" } },
        { do: { clickText: "Ask" } },
        {
          do: answerConfirm("yes"),
          expect: { state: { n: 0 }, domExcludes: ["Reset the counter?"] },
        },
      ],
    });
    expect(report.steps.flatMap((s) => s.failures)).toEqual([]);
    expect(staleClicks).toBe(0);
  });
});
