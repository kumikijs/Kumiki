import { renderToString } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { click, find, mountApp } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";

function program(defs: string[], root: string): string {
  return [
    'slot log : Text = ""',
    'slot xs : List(Text) = ["p", "q"]',
    "slot one : Bool = true",
    ...defs,
    `tile App = column(${root}, text("log=" + log))`,
    'app A caps=[] routes={"/" -> App, "/404" -> App} init=[]',
    "",
  ].join("\n");
}

async function clickAll(src: string, texts: string[]): Promise<unknown> {
  const app = await loadSource(src);
  const { root } = mountApp(app);
  for (const t of texts) click(root, t);
  return app.live?.log;
}

describe("a call-site prop leaves the id the tile wrote", () => {
  it("fires Ghost#three for a Ghost called with a variant", async () => {
    const src = program(
      [
        'tile Plain = button(text="Plain", id="three")',
        'tile Ghost = button(text="Ghost", id="three")',
        'reducer hitPlain on=ui.click(Plain#three) do= log := log + "plain;"',
        'reducer hitGhost on=ui.click(Ghost#three) do= log := log + "ghost;"',
      ],
      'Plain, Ghost {variant: "ghost"}',
    );
    expect(await clickAll(src, ["Plain", "Ghost"])).toBe("plain;ghost;");
  });

  it("keeps it on every node a for-bodied tile renders", async () => {
    const src = program(
      [
        "tile Many = for s in xs button(text=s) {id: s}",
        'reducer hitQ on=ui.click(Many#q) do= log := log + "q;"',
      ],
      'Many {variant: "ghost"}',
    );
    expect(await clickAll(src, ["p", "q"])).toBe("q;");
  });

  it("keeps it on the branch an if-rooted tile renders", async () => {
    const src = program(
      [
        'tile Maybe = if one then button(text="m", id="m") else text("none")',
        'reducer hitM on=ui.click(Maybe#m) do= log := log + "m;"',
      ],
      'Maybe {variant: "ghost"}',
    );
    expect(await clickAll(src, ["m"])).toBe("m;");
  });

  it("keeps it through a tile that calls another with a prop of its own", async () => {
    const src = program(
      [
        'tile Inner = button(text="deep", id="deep")',
        'tile Outer = Inner {variant: "ghost"}',
        'reducer hitOuter on=ui.click(Outer#deep) do= log := log + "outer;"',
        'reducer hitInner on=ui.click(Inner#deep) do= log := log + "inner;"',
      ],
      'Outer {class: "wide"}',
    );
    expect(await clickAll(src, ["deep"])).toBe("outer;inner;");
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
    const app = await loadSource(
      program(['tile Del = button(text="Del", aria-label="Delete")'], call),
    );
    const { root } = mountApp(app);
    const { html } = await renderToString(app);
    const served = document.createElement("div");
    served.innerHTML = html;
    const client = find(root, "button");
    const server = find(served, "button");
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
