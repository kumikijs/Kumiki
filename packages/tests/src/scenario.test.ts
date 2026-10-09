import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app as appExample, appsDir, feature } from "@kumikijs/examples";
import { createEpisodeLogger, runScenario, type Scenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp, TMP_ROOT } from "./helpers/load.ts";

const counter = feature("01-slot-and-reducer");

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

  describe("errorIncludes", () => {
    const atomicity = feature("63-reducer-batch-atomicity");

    const toCeiling = [
      { do: { clickText: "bump" } },
      { do: { clickText: "bump" } },
      { do: { clickText: "bump" } },
    ];

    it("passes when the named error is reported, and keeps it out of the failures", async () => {
      const app = await loadApp(atomicity);
      const report = await runScenario(app, freshRoot(), {
        steps: [
          ...toCeiling,
          {
            do: { clickText: "bump" },
            // `noErrors` still holds: it means "nothing this step did not ask for", so the two compose instead of contradicting.
            expect: { noErrors: true, errorIncludes: ['reducer "bump" was rejected'] },
          },
        ],
      });
      expect(report.ok).toBe(true);
      const last = report.steps[3];
      expect(last?.errors).toEqual([]);
      expect(last?.expectedErrors).toHaveLength(1);
      expect(last?.expectedErrors[0]).toContain("cannot hold 4 (between(0, 3))");
      expect(last?.actionError).toBeUndefined();
    });

    it("fails when the named error is not reported", async () => {
      const app = await loadApp(atomicity);
      const report = await runScenario(app, freshRoot(), {
        steps: [{ do: { clickText: "bump" }, expect: { errorIncludes: ["was rejected"] } }],
      });
      expect(report.ok).toBe(false);
      expect(report.steps[0]?.failures[0]).toContain('expected an error including "was rejected"');
      expect(report.steps[0]?.failures[0]).toContain("none");
    });

    it("still fails on an error the step did not name", async () => {
      const app = await loadApp(atomicity);
      const report = await runScenario(app, freshRoot(), {
        steps: [...toCeiling, { do: { clickText: "bump" }, expect: { errorIncludes: [] } }],
      });
      expect(report.ok).toBe(false);
      expect(report.steps[3]?.errors).toHaveLength(1);
    });
  });

  describe("a step cannot drive a control the platform refuses", () => {
    const disabled = feature("95-disabled-controls-refuse-a-step");

    it("fails the step and leaves the slot where it was", async () => {
      const app = await loadApp(disabled);
      const report = await runScenario(app, freshRoot(), {
        steps: [{ do: { fill: "#locked", value: "typed" } }],
      });
      expect(report.ok).toBe(false);
      expect(report.steps[0]?.actionError).toContain("<input> is disabled");
      expect(report.steps[0]?.state.locked).toBe("sealed");
      expect(report.steps[0]?.state.typed).toBe(0);
    });

    it("keeps the refusal off the error channel, out of errorIncludes' reach", async () => {
      const app = await loadApp(disabled);
      const report = await runScenario(app, freshRoot(), {
        steps: [
          {
            do: { fill: "#locked", value: "typed" },
            expect: { errorIncludes: ["is disabled"] },
          },
        ],
      });
      expect(report.ok).toBe(false);
      expect(report.steps[0]?.errors).toEqual([]);
      expect(report.steps[0]?.failures[0]).toContain("but got: none");
    });

    it("actionErrorIncludes claims it, and moves it off the failing channel", async () => {
      const app = await loadApp(disabled);
      const report = await runScenario(app, freshRoot(), {
        steps: [
          {
            do: { fill: "#locked", value: "typed" },
            // `noErrors` composes with it, as it does with `errorIncludes`.
            expect: { noErrors: true, actionErrorIncludes: ["<input> is disabled"] },
          },
        ],
      });
      expect(report.ok).toBe(true);
      expect(report.steps[0]?.actionError).toBeUndefined();
      expect(report.steps[0]?.expectedActionError).toContain("is disabled");
    });

    it("a step that asks to be refused and is not refused fails", async () => {
      const app = await loadApp(disabled);
      const report = await runScenario(app, freshRoot(), {
        steps: [
          { do: { fill: "#live", value: "x" }, expect: { actionErrorIncludes: ["disabled"] } },
        ],
      });
      expect(report.ok).toBe(false);
      expect(report.steps[0]?.failures[0]).toContain("but it ran");
    });
  });

  it("dispatches a manifest-registered custom effect (mocked deterministically)", async () => {
    const app = await loadApp(feature("27-custom-capability"));
    const report = await runScenario(app, freshRoot(), {
      steps: [
        { do: { clickText: "Track" }, expect: { noErrors: true, state: { sent: 1 } } },
        { do: { clickText: "Track" }, expect: { state: { sent: 2 } } },
      ],
      effects: { track: [{ outcome: "ok" }, { outcome: "ok" }] },
    });
    expect(report.ok).toBe(true);
  });

  it("surfaces an unavailable storage backend as a status (20-effect-storage)", async () => {
    const app = await loadApp(feature("20-effect-storage"));
    const report = await runScenario(app, freshRoot(), {
      steps: [
        {
          expect: {
            noErrors: true,
            state: { status: "storage unavailable", ready: true },
          },
        },
      ],
      effects: { loadText: [{ outcome: "err", value: "SecurityError" }] },
    });
    expect(report.ok).toBe(true);
  });

  it("runs a textarea's ui.input reducer so the note auto-saves (20-effect-storage)", async () => {
    const app = await loadApp(feature("20-effect-storage"));
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
          loadText: [{ outcome: "err", value: "SecurityError" }],
          saveText: [{ outcome: "ok" }],
        },
      },
      { settleMs: 400 },
    );
    expect(report.ok).toBe(true);
    expect(report.steps[1]?.emits.some((e) => e.effect === "saveText")).toBe(true);
  });

  it("recovers from a render panic via an error-boundary (32-panic-boundary)", async () => {
    const app = await loadApp(feature("32-panic-boundary"));
    const report = await runScenario(app, freshRoot(), {
      steps: [
        { do: { clickText: "reveal" }, expect: { noErrors: true, domIncludes: ["recovered:"] } },
      ],
    });
    expect(report.ok).toBe(true);
    expect(report.steps[0]?.domText).toContain("get called on None");
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
    expect(report.ok).toBe(true);
  });

  it("loads a quote on the success path (19-effect-http)", async () => {
    const app = await loadApp(feature("19-effect-http"));
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

  it("routes in memory mode: initial /, link nav, path params (18-routing)", async () => {
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
    expect(report.ok).toBe(true);
  });

  it("fires a route.enter(pattern) reducer on navigation (23-lifecycle-route-enter)", async () => {
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
    expect(report.ok).toBe(true);
  });

  it("gates a route.leave with confirm; No reverts, Yes commits (38-confirm-leave-guard)", async () => {
    const app = await loadApp(feature("38-confirm-leave-guard"));
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

  it("nested routes select the right child via route-outlet (40-nested-routes)", async () => {
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
            label: "§3.6.3: unmatched child falls back to the parent's default sub-route",
            do: { navigate: "/settings/unknown-child" },
            expect: {
              noErrors: true,
              domIncludes: ["Settings", "Settings home"],
              domExcludes: ["Account settings", "Billing settings", "404"],
            },
          },
          {
            label: "§3.10: a sub-route redirect lands the user on the redirect target",
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
    if (!report.ok) {
      const detail = report.steps
        .flatMap((s, i) => [...s.errors, ...s.failures].map((m) => `step ${i}: ${m}`))
        .join("\n");
      throw new Error(`nested-routes scenario failed:\n${detail}`);
    }
    expect(report.ok).toBe(true);
  });

  it("debounce-deferred effects ride the originating episode (20-effect-storage)", async () => {
    const app = await loadApp(feature("20-effect-storage"));
    const logger = createEpisodeLogger({ memoryMax: 20 });
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
          loadText: [{ outcome: "err", value: "SecurityError" }],
          saveText: [{ outcome: "ok" }],
        },
      },
      { settleMs: 400, episodeLogger: logger },
    );
    expect(report.ok).toBe(true);

    // Locate the ui.input episode (the `edit` reducer that emitted saveText).
    const eps = logger.list();
    const editEp = eps.find((ep) =>
      ep.steps.some((s) => s.kind === "reducer" && (s as { name: string }).name === "edit"),
    );
    expect(editEp).toBeDefined();
    const stepKinds = editEp!.steps.map((s) => s.kind);
    // Same episode owns the full causal chain — no split onto a fresh episode.
    expect(stepKinds).toContain("effect-start");
    expect(stepKinds).toContain("effect-end");
    const reducers = editEp!.steps
      .filter((s) => s.kind === "reducer")
      .map((s) => (s as { name: string }).name);
    expect(reducers).toContain("edit");
    expect(reducers).toContain("saved");
    expect(editEp!.status).toBe("completed");
    // Exactly one ui.input episode — no duplicate originating episode opened by a fallback path.
    expect(eps.filter((ep) => ep.trigger.kind === "ui.input")).toHaveLength(1);
    // And the saveText effect-end is NOT split onto its own auto-opened `effect.ok`-triggered episode.
    const saveOrphan = eps.find(
      (ep) =>
        ep.trigger.kind.startsWith("effect.") &&
        ep.steps.some((s) => s.kind === "reducer" && (s as { name: string }).name === "saved"),
    );
    expect(saveOrphan).toBeUndefined();
  });

  it("runs the expense-tracker acceptance scenario (fold + Int.parse)", async () => {
    const dir = join(appsDir, "06-expenses");
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

  it("runs the blog editor route end to end (route slot outside a route reducer)", async () => {
    const dir = join(appsDir, "03-blog");
    const app = await loadApp(join(dir, "app.kumiki"));
    const scenario = JSON.parse(readFileSync(join(dir, "scenario.json"), "utf8")) as Scenario;
    const report = await runScenario(app, freshRoot(), scenario);
    if (!report.ok) {
      const detail = report.steps
        .flatMap((s, i) => [...s.errors, ...s.failures].map((m) => `step ${i}: ${m}`))
        .join("\n");
      throw new Error(`blog scenario failed:\n${detail}`);
    }
    expect(report.ok).toBe(true);
  });

  it("fires every ui.click reducer on the same tile (11-multi-subscribe)", async () => {
    const app = await loadApp(appExample("11-multi-subscribe"));
    const report = await runScenario(app, freshRoot(), {
      steps: [
        { do: { clickText: "Save" }, expect: { noErrors: true, state: { version: 1, log: 1 } } },
        { do: { clickText: "Save" }, expect: { state: { version: 2, log: 2 } } },
      ],
    });
    expect(report.ok).toBe(true);
  });

  it("keeps running later reducers in the chain when an earlier one panics", async () => {
    const src = `
      slot first : Int = 0
      slot last  : Int = 0
      reducer runFirst on=ui.click(B) do= first := first + 1
      reducer boom     on=ui.click(B) do= last  := panic("nope")
      reducer runLast  on=ui.click(B) do= last  := last + 1
      tile B = button(text="go")
      tile App = column(B, text(first.show), text(last.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const tmp = join(TMP_ROOT, "panic-chain.kumiki");
    const fs = await import("node:fs");
    fs.mkdirSync(dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, src);
    const app = await loadApp(tmp);
    const report = await runScenario(app, freshRoot(), {
      steps: [{ do: { clickText: "go" } }],
    });
    const step0 = report.steps[0];
    expect(step0).toBeDefined();
    // `boom` panicked between `runFirst` and `runLast` and the panic was logged.
    expect(step0?.errors.some((e) => e.includes('panic in reducer "boom"'))).toBe(true);
    // Both neighbors still advanced their slots — the chain did not abort.
    expect(step0?.state.first).toBe(1);
    expect(step0?.state.last).toBe(1);
  });

  describe("focus / blur / key / hover DOM-event primitives", () => {
    async function compileInline(name: string, src: string): Promise<string> {
      const tmp = join(TMP_ROOT, `${name}.kumiki`);
      const fs = await import("node:fs");
      fs.mkdirSync(dirname(tmp), { recursive: true });
      fs.writeFileSync(tmp, src);
      return tmp;
    }

    const focusApp = `
      slot focusedField : Text = ""
      slot blurCount    : Int  = 0
      slot draft        : Text = ""
      reducer onFocus on=ui.focus(NameInput) do= focusedField := "name"
      reducer onBlur  on=ui.blur(NameInput)  do= blurCount := blurCount + 1
      tile NameInput = input(bind=draft, placeholder="x") {id: "name-input"}
      tile App = column(NameInput, text(focusedField), text(blurCount.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;

    it("dispatches a real focus event to the selector and fires the onFocus reducer", async () => {
      const path = await compileInline("focus-primitive", focusApp);
      const app = await loadApp(path);
      const report = await runScenario(app, freshRoot(), {
        steps: [
          {
            do: { focus: "#name-input" },
            expect: { noErrors: true, state: { focusedField: "name" } },
          },
        ],
      });
      expect(report.ok).toBe(true);
    });

    it("dispatches a real blur event to the selector and fires the onBlur reducer", async () => {
      const path = await compileInline("blur-primitive", focusApp);
      const app = await loadApp(path);
      const report = await runScenario(app, freshRoot(), {
        steps: [
          { do: { blur: "#name-input" }, expect: { noErrors: true, state: { blurCount: 1 } } },
          { do: { blur: "#name-input" }, expect: { state: { blurCount: 2 } } },
        ],
      });
      expect(report.ok).toBe(true);
    });

    it("reports a clear error when a selector matches nothing", async () => {
      const path = await compileInline("focus-missing", focusApp);
      const app = await loadApp(path);
      for (const action of [
        { focus: "#does-not-exist" },
        { key: "#does-not-exist", value: "Enter" },
        { hover: "#does-not-exist" },
      ]) {
        const report = await runScenario(app, freshRoot(), {
          steps: [{ do: action, expect: { noErrors: true } }],
        });
        expect(report.ok, JSON.stringify(action)).toBe(false);
        // On `actionError`, not `errors`: the app said nothing here — the step
        // could not run. See `scenario-strictness.test.ts` for why the two are
        // kept apart.
        expect(report.steps[0]?.actionError, JSON.stringify(action)).toContain(
          "no element matching selector",
        );
      }
    });

    const keyApp = `
      slot lastKey  : Text = ""
      slot lastCode : Text = "unset"
      slot hovers   : Int  = 0
      reducer onKey
          on=ui.key(Field)
          do= lastKey  := $el.key
              lastCode := $el.code
      reducer onHover on=ui.hover(Card)    do= hovers := hovers + 1
      tile Field = input(placeholder="x") {id: "field"}
      tile Card  = box(text("hover me")) {id: "card"}
      tile App   = column(Field, Card, text(lastKey), text(hovers.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;

    it("hands the pressed key to the reducer, and an empty code", async () => {
      const path = await compileInline("key-payload", keyApp);
      const app = await loadApp(path);
      const report = await runScenario(app, freshRoot(), {
        steps: [
          {
            do: { key: "#field", value: "Enter" },
            expect: { noErrors: true, state: { lastKey: "Enter", lastCode: "" } },
          },
        ],
      });
      expect(report.ok).toBe(true);
    });

    it("counts a mouseenter per hover", async () => {
      const path = await compileInline("hover-primitive", keyApp);
      const app = await loadApp(path);
      const report = await runScenario(app, freshRoot(), {
        steps: [
          { do: { hover: "#card" }, expect: { noErrors: true, state: { hovers: 1 } } },
          { do: { hover: "#card" }, expect: { state: { hovers: 2 } } },
        ],
      });
      expect(report.ok).toBe(true);
    });

    const nestedApp = `
      slot keyHits   : Int = 0
      slot hoverHits : Int = 0
      reducer onKey   on=ui.key(Decoy)   do= keyHits := keyHits + 1
      reducer onHover on=ui.hover(Decoy) do= hoverHits := hoverHits + 1
      tile Decoy = input(placeholder="decoy")
      tile Inner = input(placeholder="x") {id: "inner"}
      tile Outer = box(Inner) {id: "outer", onKeyDown: onKey, onMouseEnter: onHover}
      tile App   = column(Outer, text(keyHits.show), text(hoverHits.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;

    it("reaches a container's handler from a descendant for keydown, and not for mouseenter", async () => {
      const path = await compileInline("nested-handlers", nestedApp);
      const app = await loadApp(path);
      const report = await runScenario(app, freshRoot(), {
        steps: [
          {
            label: "the container's own element answers both",
            do: { key: "#outer", value: "a" },
            expect: { noErrors: true, state: { keyHits: 1 } },
          },
          { do: { hover: "#outer" }, expect: { state: { hoverHits: 1 } } },
          {
            label: "from the child, the key press arrives and the hover does not",
            do: { key: "#inner", value: "b" },
            expect: { state: { keyHits: 2 } },
          },
          { do: { hover: "#inner" }, expect: { state: { hoverHits: 1 } } },
        ],
      });
      expect(report.ok).toBe(true);
    });
  });
});
