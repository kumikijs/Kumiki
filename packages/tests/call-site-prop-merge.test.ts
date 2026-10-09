// A data prop written where a user tile is called is merged onto the nodes the
// tile renders one prop at a time (language.md §1.7.3): it replaces the prop of
// that name, and every prop the call site does not write stays as the tile
// wrote it — in the `$el` a reducer reads as in the rendered element. The
// `Tile#id` filter (§1.6.2) reads the id from `$el`, so most of these click and
// answer what ran; the ARIA rows read the attributes, on both render paths.

import { mount, renderToString } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.js";

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

/** Mounts `src`, clicks each button whose text is in `texts`, in turn, and returns the log. */
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

describe("a call-site prop leaves the id the tile wrote", () => {
  it("fires Ghost#three for a Ghost called with a variant", async () => {
    // The program the contract is about: `Plain` and `Ghost` render the same
    // button, and only `Ghost`'s call site writes a prop.
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
  // `todoId` rides along so the reducer that fires also says what `$el` held:
  // a call-site id replaces the id and nothing else.
  const defs = [
    'tile Ghost = button(text="Ghost", id="three") {todoId: 7}',
    'reducer hitThree on=ui.click(Ghost#three) do= log := log + "three;"',
    'reducer hitX on=ui.click(Ghost#x) do= log := log + "x" + $el.todoId.show + ";"',
  ];

  it("written as a prop", async () => {
    expect(await clickAll(program(defs, 'Ghost {id: "x"}'), ["Ghost"])).toBe("x7;");
  });

  it("written as a named argument", async () => {
    expect(await clickAll(program(defs, 'Ghost(id="x")'), ["Ghost"])).toBe("x7;");
  });
});

describe("the rest of $el survives a call-site prop", () => {
  const defs = [
    'tile Del = button(text="Del") {todoId: 7}',
    'reducer hit on=ui.click(Del) do= log := log + $el.todoId.show + ";"',
  ];

  it("a field the call site does not write is the tile's", async () => {
    expect(await clickAll(program(defs, 'Del {variant: "ghost"}'), ["Del"])).toBe("7;");
  });

  it("a field the call site writes is the call site's", async () => {
    expect(await clickAll(program(defs, "Del {todoId: 9}"), ["Del"])).toBe("9;");
  });
});

describe("each aria-* the call site writes is merged on its own", () => {
  const src = (call: string): string =>
    program(['tile Del = button(text="Del", aria-label="Delete")'], call);

  async function attrs(call: string): Promise<Array<[string, string | null, string | null]>> {
    const app = await loadSource(src(call));
    const root = document.createElement("div");
    document.body.appendChild(root);
    mount(app, root);
    const { html } = await renderToString(app);
    const served = document.createElement("div");
    served.innerHTML = html;
    const client = root.querySelector("button");
    const server = served.querySelector("button");
    if (!client || !server) throw new Error(`no button rendered for ${call}`);
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
