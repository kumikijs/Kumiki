// A form's `ui.submit` reducer runs only when every slot a control inside it
// binds passes its validation, judged on what the control shows (forms.md
// §5.2.2) — the judgement `error(field=…)` makes. The submit listener called
// the reducer unconditionally, so a field showing a refused value beside its
// message submitted anyway, and the reducer read the stale slot value the
// field was no longer showing.

import { type AppShape, mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

const SOURCE = `
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

app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

function fill(root: HTMLElement, id: string, value: string): void {
  const inp = root.querySelector<HTMLInputElement>(`#${id}`);
  if (!inp) throw new Error(`#${id} not found`);
  inp.value = value;
  inp.dispatchEvent(new Event("input", { bubbles: true }));
}

function submit(root: HTMLElement): void {
  const form = root.querySelector("form");
  if (!form) throw new Error("no form");
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

async function mounted(): Promise<{ app: AppShape; root: HTMLElement }> {
  const app = await loadSource(SOURCE);
  const root = document.createElement("div");
  document.body.appendChild(root);
  mount(app, root);
  return { app, root };
}

describe("a form submits only while its bound fields are valid", () => {
  it("does not call the submit reducer while a field shows a refused value", async () => {
    const { app, root } = await mounted();
    fill(root, "c", "ada@examplecom");
    expect(root.textContent).toContain("Invalid email format");
    submit(root);
    expect(app.live?.sends).toBe(0);
    expect(app.live?.sent).toBe("");
  });

  it("submits once the field is edited to a value the slot accepts", async () => {
    const { app, root } = await mounted();
    fill(root, "c", "ada@examplecom");
    fill(root, "c", "grace@example.com");
    submit(root);
    expect(app.live?.sends).toBe(1);
    expect(app.live?.sent).toBe("grace@example.com");
  });

  it("submits once a reducer rewrites the slot and the field follows", async () => {
    const { app, root } = await mounted();
    fill(root, "c", "ada@examplecom");
    Array.from(root.querySelectorAll("button"))
      .find((b) => b.textContent === "fix")
      ?.click();
    submit(root);
    expect(app.live?.sends).toBe(1);
    expect(app.live?.sent).toBe("grace@example.com");
  });

  it("submits a form whose fields are valid, unrefined ones included", async () => {
    const { app, root } = await mounted();
    fill(root, "n", "hello");
    submit(root);
    expect(app.live?.sends).toBe(1);
  });

  it("does not submit a pristine field whose default fails its refinement", async () => {
    const app = await loadSource(`
slot email : Text where email = ""
slot sends : Int = 0
reducer send on=ui.submit(Signup) do= sends := sends + 1
tile Signup = form(column(input(bind=email, id="e"), error(field=email)))
app A
    caps   = []
    routes = {"/" -> Signup, "/404" -> Signup}
    init   = []
`);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mount(app, root);
    submit(root);
    expect(app.live?.sends).toBe(0);
    fill(root, "e", "ada@example.com");
    submit(root);
    expect(app.live?.sends).toBe(1);
  });

  it("does not submit while an Int field shows text that is no Int", async () => {
    // The field says "Must be a whole number" (forms.md §5.1.2) while the slot
    // keeps its last number, which passes; the form judges what is shown.
    const app = await loadSource(`
slot age   : Int = 30
slot sends : Int = 0
reducer send on=ui.submit(Signup) do= sends := sends + 1
tile Signup = form(column(input(bind=age, id="a", type="number"), error(field=age)))
app A
    caps   = []
    routes = {"/" -> Signup, "/404" -> Signup}
    init   = []
`);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mount(app, root);
    fill(root, "a", "1.5");
    expect(root.textContent).toContain("Must be a whole number");
    submit(root);
    expect(app.live?.sends).toBe(0);
    fill(root, "a", "31");
    submit(root);
    expect(app.live?.sends).toBe(1);
  });
});
