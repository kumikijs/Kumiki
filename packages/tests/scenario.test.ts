// Validates the scenario runner — the substrate for an agent's autonomous
// generate → run → observe → fix loop. Drives real examples by reducer name and
// by clicking text, and asserts on reliable slot state (not scraped pixels).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runScenario, type Scenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, "..", "examples");
const counter = join(examples, "features", "01-slot-and-reducer.kumiki");

function freshRoot(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

describe("scenario runner", () => {
  it("drives a reducer by name and asserts slot state", async () => {
    const app = await loadApp(counter);
    const report = await runScenario(app, freshRoot(), {
      steps: [
        { do: { dispatch: "inc" }, expect: { noErrors: true, state: { count: 1 } } },
        { do: { dispatch: "inc" }, expect: { state: { count: 2 } } },
      ],
    });
    expect(report.ok).toBe(true);
    expect(report.steps[1]?.state.count).toBe(2);
  });

  it("drives the UI by visible text", async () => {
    const app = await loadApp(counter);
    const report = await runScenario(app, freshRoot(), {
      steps: [
        { do: { clickText: "+1" }, expect: { state: { count: 1 }, domIncludes: ["Count: 1"] } },
      ],
    });
    expect(report.ok).toBe(true);
  });

  it("reports assertion failures with detail instead of throwing", async () => {
    const app = await loadApp(counter);
    const report = await runScenario(app, freshRoot(), {
      steps: [{ do: { dispatch: "inc" }, expect: { state: { count: 99 } } }],
    });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.failures[0]).toContain("count");
  });

  // A manifest-registered custom capability (telemetry.track) must compile and
  // its effect must be emittable + dispatched — mocked deterministically here,
  // exactly like a standard effect. loadApp resolves examples/features/kumiki.caps.json.
  it("dispatches a manifest-registered custom effect (mocked deterministically)", async () => {
    const app = await loadApp(join(examples, "features", "27-custom-capability.kumiki"));
    const report = await runScenario(app, freshRoot(), {
      steps: [
        { do: { clickText: "Track" }, expect: { noErrors: true, state: { sent: 1 } } },
        { do: { clickText: "Track" }, expect: { state: { sent: 2 } } },
      ],
      effects: { track: [{ outcome: "ok" }, { outcome: "ok" }] },
    });
    expect(report.ok).toBe(true);
  });

  // M2 (#37): an unavailable storage backend (sandbox / private mode) returns
  // `err`; the example's `.err` reducer turns that into a visible status instead
  // of a silent no-op. Mock loadText → err and assert the status, not silence.
  it("surfaces an unavailable storage backend as a status (20-effect-storage)", async () => {
    const app = await loadApp(join(examples, "features", "20-effect-storage.kumiki"));
    const report = await runScenario(app, freshRoot(), {
      steps: [
        {
          expect: {
            noErrors: true,
            state: { status: "storage unavailable", ready: true },
          },
        },
      ],
      effects: { loadText: [{ outcome: "err", value: { message: "SecurityError" } }] },
    });
    expect(report.ok).toBe(true);
  });

  // Regression (#20 example): typing must run the `edit` reducer
  // (on=ui.input(NoteInput)) so it persists via `saveText`. The textarea
  // renderer previously wired only `bind`, dropping the onInput/onChange props
  // codegen emits — so a bound textarea updated its slot but never ran its
  // reducer, and the auto-save never fired (status stuck, no `saveText` emit).
  // settleMs covers the save effect's debounce(300ms).
  it("runs a textarea's ui.input reducer so the note auto-saves (20-effect-storage)", async () => {
    const app = await loadApp(join(examples, "features", "20-effect-storage.kumiki"));
    const report = await runScenario(
      app,
      freshRoot(),
      {
        steps: [
          { expect: { noErrors: true, state: { ready: true } } },
          {
            do: { fill: "textarea", value: "buy milk" },
            expect: { noErrors: true, state: { text: "buy milk", status: "saved" } },
          },
        ],
        effects: {
          loadText: [{ outcome: "err", value: { message: "SecurityError" } }],
          saveText: [{ outcome: "ok" }],
        },
      },
      { settleMs: 400 },
    );
    expect(report.ok).toBe(true);
    expect(report.steps[1]?.emits.some((e) => e.effect === "saveText")).toBe(true);
  });

  // M1 (#24): a render panic under an `error-boundary` is caught and the
  // fallback shown — cleanly, with no surfaced error (the boundary recovery is
  // silent). Clicking "reveal" makes a child tile read `.get` on a None, which
  // panics during render; the boundary turns it into "recovered: …".
  it("recovers from a render panic via an error-boundary (32-panic-boundary)", async () => {
    const app = await loadApp(join(examples, "features", "32-panic-boundary.kumiki"));
    const report = await runScenario(app, freshRoot(), {
      steps: [
        { do: { clickText: "reveal" }, expect: { noErrors: true, domIncludes: ["recovered:"] } },
      ],
    });
    expect(report.ok).toBe(true);
    expect(report.steps[0]?.domText).toContain("get called on None");
  });

  // M2 (#23): a record field named like a method renders as the FIELD, not the
  // shadowing method — proven end-to-end (the value "start" is the field, not a
  // List.head result), while a real List receiver still uses the shortcut.
  it("reads record fields named like methods, not the shadowing method (33-field-vs-method)", async () => {
    const app = await loadApp(join(examples, "features", "33-field-vs-method.kumiki"));
    const report = await runScenario(app, freshRoot(), {
      steps: [
        {
          expect: {
            noErrors: true,
            domIncludes: ["record field):  start", "record field):  3", "List shortcut): 10"],
          },
        },
      ],
    });
    expect(report.ok).toBe(true);
  });

  // M4 (#38): the HTTP showcase demonstrates the success path deterministically.
  // The effect is mocked at the capability boundary (exactly what the playground
  // does with a deterministic http.get provider), so the ok reducer populates
  // the quote into Loaded(...).
  it("loads a quote on the success path (19-effect-http)", async () => {
    const app = await loadApp(join(examples, "features", "19-effect-http.kumiki"));
    const report = await runScenario(app, freshRoot(), {
      steps: [
        {
          do: { clickText: "Load quote" },
          expect: {
            noErrors: true,
            domIncludes: ["Make it work", "Kent Beck"],
          },
        },
      ],
      effects: {
        fetchQuote: [
          { outcome: "ok", value: { text: "Make it work, make it right.", author: "Kent Beck" } },
        ],
      },
    });
    expect(report.ok).toBe(true);
  });

  // M3 (#36): path-based routing works in memory-router mode (the playground
  // srcdoc sandbox / any embedded host that owns the URL), with no reliance on
  // the ambient location/history: initial "/" resolves to Home (not /404), a
  // link click navigates, and the path param survives into the routed tile.
  it("routes in memory mode: initial /, link nav, path params (18-routing)", async () => {
    const app = await loadApp(join(examples, "features", "18-routing.kumiki"));
    const report = await runScenario(
      app,
      freshRoot(),
      {
        steps: [
          { expect: { noErrors: true, domIncludes: ["Home"], domExcludes: ["not found"] } },
          { do: { clickText: "Go to item 42" }, expect: { domIncludes: ["Item 42"] } },
        ],
      },
      { router: "memory" },
    );
    expect(report.ok).toBe(true);
  });

  // Regression (#23 example): a `route.enter(pattern)` reducer must fire on
  // entering that route. The parser previously discarded the pattern argument,
  // so the reducer's event name was the bare "route.enter" and never matched the
  // runtime's `route.enter("/page")` lookup — navigation worked but the counter
  // stayed at 0. Each entry into "/page" bumps `visits`.
  it("fires a route.enter(pattern) reducer on navigation (23-lifecycle-route-enter)", async () => {
    const app = await loadApp(join(examples, "features", "23-lifecycle-route-enter.kumiki"));
    const report = await runScenario(
      app,
      freshRoot(),
      {
        steps: [
          { expect: { noErrors: true, state: { started: true, visits: 0 } } },
          {
            do: { clickText: "Visit page" },
            expect: { state: { visits: 1 }, domIncludes: ["entered 1 time(s)"] },
          },
          { do: { clickText: "Home" }, expect: { state: { visits: 1 } } },
          {
            do: { clickText: "Visit page" },
            expect: { state: { visits: 2 }, domIncludes: ["entered 2 time(s)"] },
          },
        ],
      },
      { router: "memory" },
    );
    expect(report.ok).toBe(true);
  });

  // Issue #82: route.leave guard + confirm effect. Drives the example end-to-end
  // through the compiled .kumiki: dirty edit → navigation triggers the modal
  // → click No reverts → click Yes commits and the user reducer cleans up dirty.
  it("gates a route.leave with confirm; No reverts, Yes commits (38-confirm-leave-guard)", async () => {
    const app = await loadApp(join(examples, "features", "38-confirm-leave-guard.kumiki"));
    const root = freshRoot();
    const report = await runScenario(
      app,
      root,
      {
        steps: [
          { do: { navigate: "/edit" }, expect: { noErrors: true } },
          { do: { fill: "textarea", value: "draft" }, expect: { state: { dirty: true } } },
          // Click the link back home — the leave guard emits `confirm`, the modal
          // is appended to <body>. Wait briefly for the modal to mount.
          { do: { clickText: "Back home" } },
          {
            label: "No keeps us on /edit, dirty preserved",
            do: { click: "[data-kumiki-confirm] button[data-kumiki-confirm-action='no']" },
            expect: { state: { dirty: true } },
          },
          { do: { clickText: "Back home" } },
          {
            label: "Yes commits — continueLeave clears dirty, route.enter('/') runs",
            do: { click: "[data-kumiki-confirm] button[data-kumiki-confirm-action='yes']" },
            expect: { state: { dirty: false, visits: 2 }, domIncludes: ["Home"] },
          },
        ],
      },
      { router: "memory" },
    );
    if (!report.ok) {
      const detail = report.steps
        .flatMap((s, i) => [...s.errors, ...s.failures].map((m) => `step ${i}: ${m}`))
        .join("\n");
      throw new Error(`confirm/leave scenario failed:\n${detail}`);
    }
    expect(report.ok).toBe(true);
  });

  // Regression: this app's scenario guards two framework fixes found via the
  // iterate loop — List.fold codegen, and Int.parse numeric coercion (a total
  // that was silently wrong via string concatenation).
  it("runs the expense-tracker acceptance scenario (fold + Int.parse)", async () => {
    const dir = join(examples, "apps", "06-expenses");
    const app = await loadApp(join(dir, "app.kumiki"));
    const scenario = JSON.parse(readFileSync(join(dir, "scenario.json"), "utf8")) as Scenario;
    const report = await runScenario(app, freshRoot(), scenario);
    if (!report.ok) {
      const detail = report.steps
        .flatMap((s, i) => [...s.errors, ...s.failures].map((m) => `step ${i}: ${m}`))
        .join("\n");
      throw new Error(`expense scenario failed:\n${detail}`);
    }
    expect(report.ok).toBe(true);
  });
});
