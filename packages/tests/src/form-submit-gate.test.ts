import { type AppShape, runScenario, type ScenarioStep } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { click, fill, find, freshRoot, mountApp } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";
import { withApp } from "./helpers/source.ts";

const SOURCE = withApp(`
slot contact : Text where email = "ada@example.com"
slot note    : Text = ""
slot sent    : Text = ""
slot sends   : Int  = 0

reducer send on=ui.submit(Signup) do= sent := contact
                                      sends := sends + 1
reducer fix  on=ui.click(FixBtn)  do= contact := "grace@example.com"

tile FixBtn = button(text="fix", type="button")
tile Signup = form(column(
    input(bind=contact, id="c"),
    error(field=contact),
    input(bind=note, id="n"),
    FixBtn,
    button(text="Send", type="submit")))

tile App = column(Signup, text("sent=" + sent))
`);

function submit(form: Element): void {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

const roots: HTMLElement[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) root.remove();
});

async function mounted(source = SOURCE): Promise<{ app: AppShape; root: HTMLElement }> {
  const app = await loadSource(source);
  const { root } = mountApp(app);
  roots.push(root);
  return { app, root };
}

function program(slots: string, tiles: string, route = "Signup"): string {
  return withApp(
    `${slots}
${tiles}`,
    route,
  );
}

describe("a form submits only while its bound fields are valid", () => {
  it("does not call the submit reducer while a field shows a refused value", async () => {
    const { app, root } = await mounted();
    fill(root, "#c", "ada@examplecom");
    expect(root.textContent).toContain("Invalid email format");
    submit(find(root, "form"));
    expect(app.live?.sends).toBe(0);
    expect(app.live?.sent).toBe("");
  });

  it("submits once the field is edited to a value the slot accepts", async () => {
    const { app, root } = await mounted();
    fill(root, "#c", "ada@examplecom");
    fill(root, "#c", "grace@example.com");
    submit(find(root, "form"));
    expect(app.live?.sends).toBe(1);
    expect(app.live?.sent).toBe("grace@example.com");
  });

  it("submits once a reducer rewrites the slot and the field follows", async () => {
    const { app, root } = await mounted();
    fill(root, "#c", "ada@examplecom");
    click(root, "fix");
    submit(find(root, "form"));
    expect(app.live?.sends).toBe(1);
    expect(app.live?.sent).toBe("grace@example.com");
  });

  it("submits a form whose fields are valid, unrefined ones included", async () => {
    const { app, root } = await mounted();
    fill(root, "#n", "hello");
    submit(find(root, "form"));
    expect(app.live?.sends).toBe(1);
  });

  it.each([
    ["beside an error tile", ", error(field=email)"],
    ["with no error tile to say why", ""],
  ])("does not submit a pristine field whose default fails its refinement, %s", async (_l, tile) => {
    const { app, root } = await mounted(
      program(
        `slot email : Text where email = ""
slot sends : Int = 0
reducer send on=ui.submit(Signup) do= sends := sends + 1`,
        `tile Signup = form(column(input(bind=email, id="e")${tile}))`,
      ),
    );
    submit(find(root, "form"));
    expect(app.live?.sends).toBe(0);
    fill(root, "#e", "ada@example.com");
    submit(find(root, "form"));
    expect(app.live?.sends).toBe(1);
  });

  it("does not submit while an Int field shows text that is no Int", async () => {
    const { app, root } = await mounted(
      program(
        `slot age   : Int = 30
slot sends : Int = 0
reducer send on=ui.submit(Signup) do= sends := sends + 1`,
        `tile Signup = form(column(input(bind=age, id="a", type="number"), error(field=age)))`,
      ),
    );
    fill(root, "#a", "1.5");
    expect(root.textContent).toContain("Must be a whole number");
    submit(find(root, "form"));
    expect(app.live?.sends).toBe(0);
    fill(root, "#a", "31");
    submit(find(root, "form"));
    expect(app.live?.sends).toBe(1);
  });

  it("judges a textarea and a select by their pristine defaults too", async () => {
    const { app, root } = await mounted(
      program(
        `slot note  : Text where nonempty = ""
slot size  : Text where nonempty = ""
slot sends : Int = 0
reducer send on=ui.submit(Signup) do= sends := sends + 1`,
        `tile Signup = form(column(
    textarea(bind=note) {id: "t"},
    select(bind=size, options=[{label: "S", value: "s"}], placeholder="Pick") {id: "s"}))`,
      ),
    );
    submit(find(root, "form"));
    expect(app.live?.sends).toBe(0);
    fill(root, "#t", "hello");
    submit(find(root, "form"));
    expect(app.live?.sends).toBe(0);
    const select = find<HTMLSelectElement>(root, "#s");
    const option = Array.from(select.options).find((o) => o.textContent === "S");
    if (!option) throw new Error("no option S");
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(app.live?.size).toBe("s");
    submit(find(root, "form"));
    expect(app.live?.sends).toBe(1);
  });

  it("does not submit while a path-bound field shows a refused value", async () => {
    const { app, root } = await mounted(
      program(
        `type Email = Text where email
slot user  : {name: Text, email: Email} = {name: "Ada", email: "ada@example.com"}
slot sent  : Text = ""
reducer send on=ui.submit(Signup) do= sent := user.email`,
        `tile Signup = form(column(input(bind=user.email, id="e"), error(field=user)))`,
      ),
    );
    fill(root, "#e", "ada@examplecom");
    expect(root.textContent).toContain("Invalid email format");
    submit(find(root, "form"));
    expect(app.live?.sent).toBe("");
    fill(root, "#e", "grace@example.com");
    submit(find(root, "form"));
    expect(app.live?.sent).toBe("grace@example.com");
  });
});

describe("only the controls inside a form hold it back", () => {
  it("submits while a control outside the form shows a refused value for the same slot", async () => {
    const { app, root } = await mounted(
      program(
        `slot contact : Text where email = "ada@example.com"
slot sent    : Text = ""
reducer send on=ui.submit(Signup) do= sent := contact`,
        `tile Signup = form(column(input(bind=contact, id="in"), error(field=contact)))
tile App = column(input(bind=contact, id="out"), Signup)`,
        "App",
      ),
    );
    fill(root, "#out", "ada@examplecom");
    expect(root.textContent).toContain("Invalid email format");
    submit(find(root, "form"));
    expect(app.live?.sent).toBe("ada@example.com");
  });

  it("holds back the form that shows the refused value and not another one", async () => {
    const { app, root } = await mounted(
      program(
        `slot contact : Text where email = "ada@example.com"
slot a       : Int = 0
slot b       : Int = 0
reducer sendA on=ui.submit(FormA) do= a := a + 1
reducer sendB on=ui.submit(FormB) do= b := b + 1`,
        `tile FormA = form(input(bind=contact, id="ca"))
tile FormB = form(input(bind=contact, id="cb"))
tile App = column(FormA, FormB)`,
        "App",
      ),
    );
    fill(root, "#ca", "ada@examplecom");
    const [formA, formB] = Array.from(root.querySelectorAll("form"));
    for (const form of [formA, formB]) if (form) submit(form);
    expect(app.live?.a).toBe(0);
    expect(app.live?.b).toBe(1);
  });
});

describe("a {submit} step the form holds back is refused", () => {
  async function run(source: string, steps: ScenarioStep[]) {
    const app = await loadSource(source);
    const root = freshRoot();
    roots.push(root);
    return runScenario(app, root, { steps });
  }

  it("fails the step, naming the field that held it back", async () => {
    const report = await run(SOURCE, [
      { do: { fill: "#c", value: "ada@examplecom" } },
      { do: { submit: "#c" }, expect: { state: { sends: 0 } } },
    ]);
    expect(report.ok).toBe(false);
    expect(report.steps[1]?.actionError).toContain(
      "submit #c: the form held the submit back — the field bound to contact fails its validation",
    );
    expect(report.steps[1]?.state.sends).toBe(0);
  });

  it("actionErrorIncludes claims it", async () => {
    const report = await run(SOURCE, [
      { do: { fill: "#c", value: "ada@examplecom" } },
      {
        do: { submit: "#c" },
        expect: {
          noErrors: true,
          actionErrorIncludes: ["the field bound to contact fails its validation"],
          state: { sends: 0 },
        },
      },
    ]);
    expect(report.ok, failureDetail(report)).toBe(true);
    expect(report.steps[1]?.actionError).toBeUndefined();
    expect(report.steps[1]?.expectedActionError).toContain("held the submit back");
  });

  it("names every field that holds it back", async () => {
    const report = await run(
      program(
        `slot email : Text where email = ""
slot code  : Text where nonempty = ""
slot sends : Int = 0
reducer send on=ui.submit(Signup) do= sends := sends + 1`,
        `tile Signup = form(column(input(bind=email, id="e"), input(bind=code, id="k")))`,
      ),
      [{ do: { submit: "#e" } }],
    );
    expect(report.steps[0]?.actionError).toContain(
      "the fields bound to email, code fail their validation",
    );
  });

  it("passes a submit that goes through", async () => {
    const report = await run(SOURCE, [
      { do: { submit: "#c" }, expect: { noErrors: true, state: { sends: 1 } } },
    ]);
    expect(report.ok, failureDetail(report)).toBe(true);
    expect(report.steps[0]?.actionError).toBeUndefined();
  });

  it("passes a submit to a form with no ui.submit reducer, which has nothing to hold back", async () => {
    const report = await run(
      program(
        `slot email : Text where email = ""`,
        `tile Signup = form(column(input(bind=email, id="e")))`,
      ),
      [{ do: { submit: "#e" }, expect: { noErrors: true } }],
    );
    expect(report.ok, failureDetail(report)).toBe(true);
    expect(report.steps[0]?.actionError).toBeUndefined();
  });

  it("asking for a refusal on a submit that goes through fails", async () => {
    const report = await run(SOURCE, [
      { do: { submit: "#c" }, expect: { actionErrorIncludes: ["held the submit back"] } },
    ]);
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.failures[0]).toContain("but it ran");
  });

  it("dispatches past the browser's constraint validation, which only the browser tier runs", async () => {
    const report = await run(
      program(
        `slot name  : Text = ""
slot mail  : Text = ""
slot sends : Int = 0
reducer send on=ui.submit(Signup) do= sends := sends + 1`,
        `tile Signup = form(column(input(bind=name, id="nm", required=true), input(bind=mail, id="m", type="email")))`,
      ),
      [
        { do: { fill: "#m", value: "ada" } },
        { do: { submit: "#nm" }, expect: { noErrors: true, state: { sends: 1 } } },
      ],
    );
    expect(report.ok, failureDetail(report)).toBe(true);
    expect(report.steps[1]?.actionError).toBeUndefined();
  });

  it("{key: Enter} in a field submits nothing at this tier", async () => {
    const report = await run(SOURCE, [
      { do: { key: "#c", value: "Enter" }, expect: { noErrors: true, state: { sends: 0 } } },
    ]);
    expect(report.ok, failureDetail(report)).toBe(true);
    expect(report.steps[0]?.actionError).toBeUndefined();
  });

  it("judges the form the step submitted, not another one", async () => {
    const report = await run(
      program(
        `slot contact : Text where email = "ada@example.com"
slot a       : Int = 0
slot b       : Int = 0
reducer sendA on=ui.submit(FormA) do= a := a + 1
reducer sendB on=ui.submit(FormB) do= b := b + 1`,
        `tile FormA = form(input(bind=contact, id="ca"))
tile FormB = form(input(bind=contact, id="cb"))
tile App = column(FormA, FormB)`,
        "App",
      ),
      [
        { do: { fill: "#ca", value: "ada@examplecom" } },
        {
          do: { submit: "#ca" },
          expect: { actionErrorIncludes: ["held the submit back"], state: { a: 0 } },
        },
        { do: { submit: "#cb" }, expect: { state: { b: 1 } } },
      ],
    );
    expect(report.ok, failureDetail(report)).toBe(true);
    expect(report.steps[2]?.actionError).toBeUndefined();
  });
});
