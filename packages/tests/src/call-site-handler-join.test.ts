import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "@kumikijs/examples";
import { type Action, type AppShape, runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { click, freshRoot, mountApp } from "./helpers/dom.ts";
import { loadApp, loadSource } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";
import { withApp } from "./helpers/source.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** Mounts `src` and clicks each button whose text is in `texts`, in turn. */
async function clickAll(src: string, texts: string[]): Promise<unknown> {
  const app = await loadSource(src);
  const { root } = mountApp(app);
  for (const t of texts) click(root, t);
  return app.live?.log;
}

/**
 * The shape the contract is about: `Row` lifts `rowClick` onto the button `Btn` renders, and the call site writes `btnOwn` on it. `Other` is a button outside `Row`.
 */
function program(reducers: string, btn = 'button(text="x")'): string {
  return withApp(
    [
      'slot log : Text = ""',
      'slot xs : List(Text) = ["p", "q"]',
      "slot one : Bool = true",
      reducers,
      `tile Btn   = ${btn}`,
      "tile Row   = row(Btn {onClick: btnOwn})",
      'tile Other = button(text="other")',
      "tile App   = column(Row, Other, text(log))",
    ].join("\n"),
  );
}

const ROW = 'reducer rowClick on=ui.click(Row)   do= log := log + "R"';
const OWN = 'reducer btnOwn   on=ui.click(Other) do= log := log + "B"';

describe("a call-site handler joins the lifted one", () => {
  it.each([
    ["last when it is defined last", `${ROW}\n${OWN}`, "RB"],
    ["first when it is defined first", `${OWN}\n${ROW}`, "BR"],
  ])("runs the enclosing tile's reducer and the call site's, the call site's %s", async (_order, reducers, log) => {
    expect(await clickAll(program(reducers), ["x"])).toBe(log);
  });

  it("joins them on every node a for-bodied tile renders", async () => {
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

describe("a tile whose body is a for", () => {
  async function render(call: string): Promise<HTMLElement> {
    const app = await loadSource(
      withApp(
        [
          'slot xs : List(Text) = ["p", "q"]',
          "tile Items = for s in xs text(s)",
          `tile App   = column(${call}, text("end"))`,
        ].join("\n"),
      ),
    );
    return mountApp(app).root;
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
 * Runs `file` as a todo list with one todo, then takes `action` on its row and answers which reducers that one action ran.
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
  const report = await runScenario(app, freshRoot(), {
    effects: { loadTodos: [{ outcome: "ok", value: { _tag: "None" } }] },
    steps: [
      { do: { fill: "input[type='text']", value: "buy milk" } },
      { do: { submit: "form" }, expect: { domIncludes: ["buy milk"] } },
      { do: action, expect: { noErrors: true } },
    ],
  });
  expect(report.ok, failureDetail(report)).toBe(true);
  return ran.slice(ran.lastIndexOf("addTodo") + 1);
}

const TODO_LISTS = [
  app("02-todomvc"),
  ...["01-add-priority", "02-strict-validation", "03-add-archived", "04-dark-theme"].map((s) =>
    join(
      here,
      "..",
      "..",
      "benchmarks",
      "size-comparison",
      "scenarios",
      s,
      "kumiki-modified.kumiki",
    ),
  ),
];

describe("the todo list's row buttons run their own reducer and nothing else", () => {
  const cases = TODO_LISTS.map((file) => ({ file, name: file.split(/[\\/]/).slice(-2).join("/") }));

  it.each(cases)("$name: the delete button runs remove alone", async ({ file }) => {
    expect(await reducersRunBy(file, { clickText: "x" })).toEqual(["remove"]);
  });

  it.each(
    cases.filter((c) => c.name.startsWith("03-add-archived")),
  )("$name: the archive button runs archive alone", async ({ file }) => {
    expect(await reducersRunBy(file, { clickText: "a" })).toEqual(["archive"]);
  });

  it.each(cases)("$name: the checkbox still runs toggle", async ({ file }) => {
    expect(await reducersRunBy(file, { click: "input[type='checkbox']" })).toEqual(["toggle"]);
  });
});
