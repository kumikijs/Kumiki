import { feature } from "@kumikijs/examples";
import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { freshRoot } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";

describe("examples driven by a scenario", () => {
  it("surfaces an unavailable storage backend as a status (20-effect-storage)", async () => {
    const app = await loadApp(feature("20-effect-storage"));
    const report = await runScenario(app, freshRoot(), {
      steps: [
        { expect: { noErrors: true, state: { status: "storage unavailable", ready: true } } },
      ],
      effects: { loadText: [{ outcome: "err", value: "SecurityError" }] },
    });
    expect(report.ok, failureDetail(report)).toBe(true);
  });

  it("reads record fields named like methods, not the shadowing method (33-field-vs-method)", async () => {
    const app = await loadApp(feature("33-field-vs-method"));
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
    expect(report.ok, failureDetail(report)).toBe(true);
  });

  it("loads a quote on the success path (19-effect-http)", async () => {
    const app = await loadApp(feature("19-effect-http"));
    const report = await runScenario(app, freshRoot(), {
      steps: [
        {
          do: { clickText: "Load quote" },
          expect: { noErrors: true, domIncludes: ["Make it work", "Kent Beck"] },
        },
      ],
      effects: {
        fetchQuote: [
          { outcome: "ok", value: { text: "Make it work, make it right.", author: "Kent Beck" } },
        ],
      },
    });
    expect(report.ok, failureDetail(report)).toBe(true);
  });
});

describe("examples driven by a scenario under a memory router", () => {
  it("routes the initial path, a link, and path params (18-routing)", async () => {
    const app = await loadApp(feature("18-routing"));
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
    expect(report.ok, failureDetail(report)).toBe(true);
  });

  it("fires a route.enter(pattern) reducer on each navigation (23-lifecycle-route-enter)", async () => {
    const app = await loadApp(feature("23-lifecycle-route-enter"));
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
    expect(report.ok, failureDetail(report)).toBe(true);
  });

  it("gates a route.leave with confirm; No reverts, Yes commits (38-confirm-leave-guard)", async () => {
    const app = await loadApp(feature("38-confirm-leave-guard"));
    const report = await runScenario(
      app,
      freshRoot(),
      {
        steps: [
          { do: { navigate: "/edit" }, expect: { noErrors: true } },
          { do: { fill: "textarea", value: "draft" }, expect: { state: { dirty: true } } },
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
    expect(report.ok, failureDetail(report)).toBe(true);
  });

  it("selects the nested child through route-outlet (40-nested-routes)", async () => {
    const app = await loadApp(feature("40-nested-routes"));
    const report = await runScenario(
      app,
      freshRoot(),
      {
        steps: [
          {
            label: "the landing tile mounts at /",
            expect: { noErrors: true, domIncludes: ["Landing"], domExcludes: ["Settings home"] },
          },
          {
            label: "/settings renders the parent and the default sub-route home",
            do: { navigate: "/settings" },
            expect: {
              noErrors: true,
              domIncludes: ["Settings", "Settings home", "Account", "Billing"],
              domExcludes: ["Account settings", "Billing settings"],
            },
          },
          {
            label: "/settings/account swaps the outlet to the account child",
            do: { navigate: "/settings/account" },
            expect: {
              noErrors: true,
              domIncludes: ["Settings", "Account settings"],
              domExcludes: ["Settings home", "Billing settings"],
            },
          },
          {
            label: "/settings/billing swaps the outlet to the billing child",
            do: { navigate: "/settings/billing" },
            expect: {
              noErrors: true,
              domIncludes: ["Settings", "Billing settings"],
              domExcludes: ["Settings home", "Account settings"],
            },
          },
          {
            label: "an unmatched child falls back to the parent's default sub-route",
            do: { navigate: "/settings/unknown-child" },
            expect: {
              noErrors: true,
              domIncludes: ["Settings", "Settings home"],
              domExcludes: ["Account settings", "Billing settings", "404"],
            },
          },
          {
            label: "a sub-route redirect lands the user on the redirect target",
            do: { navigate: "/settings/legacy" },
            expect: {
              noErrors: true,
              domIncludes: ["Settings", "Billing settings"],
              domExcludes: ["Settings home", "Account settings"],
            },
          },
          {
            label: "a path with no matching parent still hits the global /404",
            do: { navigate: "/totally-unrelated" },
            expect: {
              noErrors: true,
              domIncludes: ["404 — not found"],
              domExcludes: ["Settings home", "Account settings", "Billing settings"],
            },
          },
        ],
      },
      { router: "memory" },
    );
    expect(report.ok, failureDetail(report)).toBe(true);
  });
});
