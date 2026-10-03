// A handler written on a user-tile call site joins the handlers already on the
// nodes that tile renders, and every reducer matching the click runs once, in
// definition order (language.md §1.6.4 Invariant 3). The compiler tests pin
// the shape emitted; these click, because what the contract is about is which
// reducers run and in what order.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Action, type AppShape, mount, runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp, loadSource } from "./helpers/load.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Mounts `src` and clicks each button whose text is in `texts`, in turn. */
async function clickAll(src: string, texts: string[]): Promise<unknown> {
  const app = await loadSource(src);
  const root = document.createElement("div");
  document.body.appendChild(root);
  mount(app, root);
  for (const t of texts) {
    const btn = [...root.querySelectorAll("button")].find((b) => b.textContent === t);
    if (!btn) throw new Error(`no button "${t}" rendered: ${root.textContent}`);
    btn.click();
  }
  return app.live?.log;
}

/**
 * The shape the contract is about: `Row` lifts `rowClick` onto the button
 * `Btn` renders, and the call site writes `btnOwn` on it. `Other` is a button
 * outside `Row`.
 */
function program(reducers: string, btn = 'button(text="x")'): string {
  return [
    'slot log : Text = ""',
    'slot xs : List(Text) = ["p", "q"]',
    "slot one : Bool = true",
    reducers,
    `tile Btn   = ${btn}`,
    "tile Row   = row(Btn {onClick: btnOwn})",
    'tile Other = button(text="other")',
    "tile App   = column(Row, Other, text(log))",
    'app A caps=[] routes={"/" -> App, "/404" -> App} init=[]',
    "",
  ].join("\n");
}

const ROW = 'reducer rowClick on=ui.click(Row)   do= log := log + "R"';
// Subscribes to a tile the button is not inside: only the call site puts
// `btnOwn` on it, so a click that runs it proves the call site's handler
// survived. A subscription that also matched would lift it there anyway.
const OWN = 'reducer btnOwn   on=ui.click(Other) do= log := log + "B"';

describe("a call-site handler joins the lifted one", () => {
  it("runs the enclosing tile's reducer and one only the call site names", async () => {
    // Replacing the lifted handler would log "B" alone; dropping the call
    // site's would log "R" alone — the lifted one cannot put a "B" there.
    const log = String(await clickAll(program(`${ROW}\n${OWN}`), ["x"]));
    expect([...log].sort().join("")).toBe("BR");
  });

  it("runs the call site's reducer last when it is defined last", async () => {
    // Explicit-first — the rule this replaced — would log "BR".
    expect(await clickAll(program(`${ROW}\n${OWN}`), ["x"])).toBe("RB");
  });

  it("runs the call site's reducer first when it is defined first", async () => {
    // Lifted-first would log "RB".
    expect(await clickAll(program(`${OWN}\n${ROW}`), ["x"])).toBe("BR");
  });

  it("joins them on every node a for-bodied tile renders", async () => {
    // The body is a list, not one node. Each button it builds gets the joined
    // handler, and the tile renders at all: merging props into the array made
    // an object of its indices, which has no renderer.
    const src = program(`${ROW}\n${OWN}`, "for s in xs button(text=s)");
    expect(await clickAll(src, ["p", "q"])).toBe("RBRB");
  });

  it("joins them on whichever branch renders, a single node or a list", async () => {
    const btn = 'if one then button(text="x") else for s in xs button(text=s)';
    expect(await clickAll(program(`${ROW}\n${OWN}`, btn), ["x"])).toBe("RB");
    const listFirst = program(`${ROW}\n${OWN}`, btn).replace(
      "slot one : Bool = true",
      "slot one : Bool = false",
    );
    expect(await clickAll(listFirst, ["q"])).toBe("RB");
  });
});

// What is left of a call site's props once its handlers go down to the body is
// data, merged onto what the body rendered. A body that is a `for` rendered a
// list, and merging into the list itself made an object of its indices with
// no `kind`: the tile did not render at all, with props or without them.
describe("a tile whose body is a for", () => {
  async function render(call: string): Promise<HTMLElement> {
    const app = await loadSource(
      [
        'slot xs : List(Text) = ["p", "q"]',
        "tile Items = for s in xs text(s)",
        `tile App   = column(${call}, text("end"))`,
        'app A caps=[] routes={"/" -> App, "/404" -> App} init=[]',
        "",
      ].join("\n"),
    );
    const root = document.createElement("div");
    document.body.appendChild(root);
    mount(app, root);
    return root;
  }

  it("renders every item when the call site passes nothing", async () => {
    expect((await render("Items")).textContent).toBe("pqend");
  });

  it("puts a call site's data prop on every item", async () => {
    const root = await render('Items {class: "chip"}');
    expect(root.textContent).toBe("pqend");
    expect([...root.querySelectorAll(".chip")].map((e) => e.textContent)).toEqual(["p", "q"]);
  });
});

/**
 * Runs `file` as a todo list with one todo, then takes `action` on its row and
 * answers which reducers that one action ran.
 */
async function reducersRunBy(file: string, action: Action): Promise<string[]> {
  const app: AppShape = await loadApp(file);
  const ran: string[] = [];
  app.reducers = app.reducers.map((r) => ({
    ...r,
    apply: (slots, payload) => {
      ran.push(r.name);
      return r.apply(slots, payload);
    },
  }));
  const root = document.createElement("div");
  document.body.appendChild(root);
  const report = await runScenario(app, root, {
    effects: { loadTodos: [{ outcome: "ok", value: { _tag: "None" } }] },
    steps: [
      { do: { fill: "input[type='text']", value: "buy milk" } },
      { do: { submit: "form" }, expect: { domIncludes: ["buy milk"] } },
      { do: action, expect: { noErrors: true } },
    ],
  });
  expect(report.ok).toBe(true);
  return ran.slice(ran.lastIndexOf("addTodo") + 1);
}

// The todo list's `toggle` used to subscribe to the whole row. Once a call
// site's handler joined the lifted ones instead of replacing them, that put
// `toggle` on every button in the row: deleting a todo toggled it first, and
// archiving one flipped `done`. `toggle` subscribes to the checkbox alone now.
const TODO_LISTS = [
  join(here, "..", "examples", "apps", "02-todomvc", "app.kumiki"),
  ...["01-add-priority", "02-strict-validation", "03-add-archived", "04-dark-theme"].map((s) =>
    join(here, "..", "benchmarks", "size-comparison", "scenarios", s, "kumiki-modified.kumiki"),
  ),
];

describe("the todo list's row buttons run their own reducer and nothing else", () => {
  for (const file of TODO_LISTS) {
    const name = file.split(/[\\/]/).slice(-2).join("/");

    // The row's buttons are the first ones in the page whose text holds "x"
    // and "a"; a click that landed elsewhere would not run `remove` at all.
    it(`${name}: the delete button runs remove alone`, async () => {
      expect(await reducersRunBy(file, { clickText: "x" })).toEqual(["remove"]);
    });

    if (name.startsWith("03-add-archived")) {
      it(`${name}: the archive button runs archive alone`, async () => {
        expect(await reducersRunBy(file, { clickText: "a" })).toEqual(["archive"]);
      });
    }

    it(`${name}: the checkbox still runs toggle`, async () => {
      expect(await reducersRunBy(file, { click: "input[type='checkbox']" })).toEqual(["toggle"]);
    });
  }
});
