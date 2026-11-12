import { describe, expect, it } from "vitest";
import { click, find, mountSource, served, typeInto } from "./helpers/dom.ts";
import { withApp } from "./helpers/source.ts";

const SLOTS = [
  'slot log : Text = ""',
  'slot q : Text = ""',
  'slot xs : List(Text) = ["p", "q"]',
  "slot one : Bool = true",
  "type Mode = Lit | Dark",
  "slot mode : Mode = Lit",
];

function program(defs: string[], root: string): string {
  return withApp([...SLOTS, ...defs, `tile App = column(${root}, text("log=" + log))`].join("\n"));
}

async function clickAll(src: string, texts: string[]): Promise<unknown> {
  const { app, root } = await mountSource(src);
  for (const t of texts) click(root, t);
  return app.live?.log;
}

describe("a call-site prop leaves the id the tile wrote", () => {
  it.each([
    [
      "a button-rooted tile",
      [
        'tile Plain = button(text="Plain", id="three")',
        'tile Ghost = button(text="Ghost", id="three")',
        'reducer hitPlain on=ui.click(Plain#three) do= log := log + "plain;"',
        'reducer hitGhost on=ui.click(Ghost#three) do= log := log + "ghost;"',
      ],
      'Plain, Ghost {variant: "ghost"}',
      ["Plain", "Ghost"],
      "plain;ghost;",
    ],
    [
      "every node a for-bodied tile renders",
      [
        "tile Many = for s in xs button(text=s) {id: s}",
        'reducer hitQ on=ui.click(Many#q) do= log := log + "q;"',
      ],
      'Many {variant: "ghost"}',
      ["p", "q"],
      "q;",
    ],
    [
      "the branch an if-rooted tile renders",
      [
        'tile Maybe = if one then button(text="m", id="m") else text("none")',
        'reducer hitM on=ui.click(Maybe#m) do= log := log + "m;"',
      ],
      'Maybe {variant: "ghost"}',
      ["m"],
      "m;",
    ],
    [
      "the body a when-rooted tile renders",
      [
        'tile Gate = when(one, button(text="g", id="g"))',
        'reducer hitG on=ui.click(Gate#g) do= log := log + "g;"',
      ],
      'Gate {variant: "ghost"}',
      ["g"],
      "g;",
    ],
    [
      "the arm a match-rooted tile renders",
      [
        'tile Arm = match mode with | Lit -> button(text="lit", id="lit") | Dark -> text("dark")',
        'reducer hitLit on=ui.click(Arm#lit) do= log := log + "lit;"',
      ],
      'Arm {variant: "ghost"}',
      ["lit"],
      "lit;",
    ],
    [
      "a tile that calls another with a prop of its own",
      [
        'tile Inner = button(text="deep", id="deep")',
        'tile Outer = Inner {variant: "ghost"}',
        'reducer hitOuter on=ui.click(Outer#deep) do= log := log + "outer;"',
        'reducer hitInner on=ui.click(Inner#deep) do= log := log + "inner;"',
      ],
      'Outer {class: "wide"}',
      ["deep"],
      "outer;inner;",
    ],
  ])("on %s", async (_shape, defs, root, clicks, log) => {
    expect(await clickAll(program(defs, root), clicks)).toBe(log);
  });
});

describe("a call-site id replaces the tile's own", () => {
  // `todoId` rides along so the reducer that fires shows the id was the only field replaced.
  const defs = [
    'tile Ghost = button(text="Ghost", id="three") {todoId: 7}',
    'reducer hitThree on=ui.click(Ghost#three) do= log := log + "three;"',
    'reducer hitX on=ui.click(Ghost#x) do= log := log + "x" + $el.todoId.show + ";"',
  ];

  it.each([
    ["a prop", 'Ghost {id: "x"}'],
    ["a named argument", 'Ghost(id="x")'],
  ])("written as %s", async (_form, call) => {
    expect(await clickAll(program(defs, call), ["Ghost"])).toBe("x7;");
  });
});

describe("a call-site id replaces the id a control carries on its node", () => {
  // `input`, `textarea` and `editable` lift `id=` onto the node itself, beside `props.id`.
  async function ids(tile: string, call: string): Promise<[string[], string[]]> {
    const { app, root } = await mountSource(program([`tile Field = ${tile}`], call));
    const page = await served(app);
    const idsIn = (r: ParentNode) =>
      ["#name", "#other"].filter((selector) => r.querySelector(selector) !== null);
    return [idsIn(root), idsIn(page)];
  }

  it.each([
    ["input", 'input(id="name", bind=q)'],
    ["textarea", 'textarea(id="name", bind=q)'],
    ["editable", 'editable(id="name", bind=q)'],
  ])("on a tile rooted at %s, on the client and the served page", async (_kind, tile) => {
    expect(await ids(tile, 'Field {id: "other"}')).toEqual([["#other"], ["#other"]]);
    expect(await ids(tile, 'Field(id="other")')).toEqual([["#other"], ["#other"]]);
    expect(await ids(tile, 'Field {variant: "a"}')).toEqual([["#name"], ["#name"]]);
  });

  it("dispatches Field#other from the element that carries it", async () => {
    const src = program(
      [
        'tile Field = input(id="name", bind=q)',
        'reducer typed on=ui.input(Field#other) do= log := log + "typed;"',
      ],
      'Field {id: "other"}',
    );
    const { app, root } = await mountSource(src);
    typeInto(find<HTMLInputElement>(root, "#other"), "hi");
    expect(app.live?.log).toBe("typed;");
  });
});

describe("the rest of $el survives a call-site prop", () => {
  const defs = [
    'tile Del = button(text="Del") {todoId: 7}',
    'reducer hit on=ui.click(Del) do= log := log + $el.todoId.show + ";"',
  ];

  it.each([
    ["does not write is the tile's", 'Del {variant: "ghost"}', "7;"],
    ["writes is the call site's", "Del {todoId: 9}", "9;"],
  ])("a field the call site %s", async (_case, call, log) => {
    expect(await clickAll(program(defs, call), ["Del"])).toBe(log);
  });
});

describe("each aria-* the call site writes is merged on its own", () => {
  async function attrs(call: string): Promise<Array<[string, string | null, string | null]>> {
    const { app, root } = await mountSource(
      program(['tile Del = button(text="Del", aria-label="Delete")'], call),
    );
    const client = find(root, "button");
    const server = find(await served(app), "button");
    return ["aria-label", "aria-describedby"].map((a) => [
      a,
      client.getAttribute(a),
      server.getAttribute(a),
    ]);
  }

  it("keeps the tile's aria-label beside a call-site aria-describedby", async () => {
    expect(await attrs('Del {aria-describedby: "hint"}')).toEqual([
      ["aria-label", "Delete", "Delete"],
      ["aria-describedby", "hint", "hint"],
    ]);
  });

  it("takes the call site's aria-label over the tile's", async () => {
    expect(await attrs('Del {aria-label: "Remove"}')).toEqual([
      ["aria-label", "Remove", "Remove"],
      ["aria-describedby", null, null],
    ]);
  });
});

describe("a call-site class replaces the tile's whole", () => {
  // `class` is one prop, so a call site's value replaces the tile's rather than adding to it.
  it("on the client and the served page", async () => {
    const { app, root } = await mountSource(
      program(['tile Card = box(text("c")) {class: "own"}'], 'Card {class: "wide"}'),
    );
    const classesOf = (r: ParentNode) => {
      const box = r.querySelector(".wide, .own");
      return box ? ["own", "wide"].filter((c) => box.classList.contains(c)) : [];
    };
    expect([classesOf(root), classesOf(await served(app))]).toEqual([["wide"], ["wide"]]);
  });
});

describe("what a builtin renders from its own arguments stays the tile's", () => {
  it("a button's text, while the call site's reaches $el", async () => {
    const src = program(
      [
        'tile Ghost = button(text="Ghost")',
        'reducer hit on=ui.click(Ghost) do= log := log + $el.text + ";"',
      ],
      'Ghost(text="Other")',
    );
    expect(await clickAll(src, ["Ghost"])).toBe("Other;");
  });

  it("an input's placeholder, on the client and the served page", async () => {
    const { app, root } = await mountSource(
      program(['tile Field = input(bind=q, placeholder="own")'], 'Field(placeholder="call")'),
    );
    const placeholderIn = (r: ParentNode) => find(r, "input").getAttribute("placeholder");
    expect([placeholderIn(root), placeholderIn(await served(app))]).toEqual(["own", "own"]);
  });
});
