import { readFileSync } from "node:fs";
import { testFile } from "@kumikijs/cli";
import { feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { find, mountSource, served, texts, tick, typeInto, withMounted } from "./helpers/dom.ts";
import { loadApp, loadSource, writeSource } from "./helpers/load.ts";
import { editedIn, withApp } from "./helpers/source.ts";

const EXAMPLE = feature("252-props-in-the-block");

function sourceOf(tile: string): string {
  return withApp(
    [
      'slot pick : Text = "a"',
      'slot draft : Text = ""',
      "slot flag : Bool = true",
      'slot at : Time = Time.parse("2026-01-01").get-or(now)',
      "slot n : Float = 3.0",
      'slot m : Map(Text, Int) = {"a": 1}',
      'slot tup : Tuple(Int, Text) = (1, "a")',
      `tile Probe = column(${tile})`,
    ].join("\n"),
    "Probe",
  );
}

type Path = "client" | "server";

async function rendered(tile: string, path: Path): Promise<HTMLElement> {
  const src = sourceOf(tile);
  const host =
    path === "client" ? (await mountSource(src)).root : await served(await loadSource(src));
  const root = host.firstElementChild as HTMLElement | null;
  if (!root) throw new Error(`${path}: nothing rendered for ${tile}`);
  return root;
}

const tile = (kind: string) => `[data-kumiki-tile="${kind}"]`;
const OPTIONS_AB = '[{label: "A", value: "a"}, {label: "B", value: "b"}]';

type Row = {
  name: string;
  arg: string;
  block: string;
  claim: (root: HTMLElement) => void;
  paths?: readonly Path[];
};

const BOTH_PATHS: readonly Path[] = ["client", "server"];

/** Each row on each path it renders on, its name led by `group`. */
const onEachPath = (rs: Row[], group = "") =>
  rs.flatMap((row) => (row.paths ?? BOTH_PATHS).map((path) => ({ ...row, group, path })));

const rows: Row[] = [
  {
    name: "modal open",
    arg: 'modal(text("m"), open=false)',
    block: 'modal(text("m")) {open: false}',
    claim: (root) => expect(find(root, tile("modal")).style.display).toBe("none"),
  },
  {
    name: "select options",
    arg: `select(bind=pick, options=${OPTIONS_AB})`,
    block: `select(bind=pick) {options: ${OPTIONS_AB}}`,
    claim: (root) => {
      const labels = Array.from(find<HTMLSelectElement>(root, "select").options, (o) => o.text);
      expect(labels).toEqual(["A", "B"]);
    },
  },
  {
    name: "list ordered",
    arg: 'list(text("a"), ordered=true)',
    block: 'list(text("a")) {ordered: true}',
    claim: (root) => expect(find(root, tile("list")).tagName).toBe("OL"),
  },
  {
    name: "drawer open",
    arg: 'drawer(text("m"), open=false)',
    block: 'drawer(text("m")) {open: false}',
    claim: (root) => expect(find(root, tile("drawer")).style.display).toBe("none"),
  },
  {
    name: "popover open",
    arg: 'popover(text("m"), open=false)',
    block: 'popover(text("m")) {open: false}',
    claim: (root) => expect(find(root, tile("popover")).style.display).toBe("none"),
  },
  {
    name: "details open",
    arg: 'details(text("d"), summary="S", open=true)',
    block: 'details(text("d"), summary="S") {open: true}',
    claim: (root) => expect(find<HTMLDetailsElement>(root, "details").open).toBe(true),
  },
  {
    name: "details summary",
    arg: 'details(text("d"), summary="S")',
    block: 'details(text("d")) {summary: "S"}',
    claim: (root) => expect(find(root, "summary").textContent).toBe("S"),
  },
  {
    name: "modal title",
    arg: 'modal(text("m"), title="T")',
    block: 'modal(text("m")) {title: "T"}',
    claim: (root) => expect(find(root, tile("modal")).getAttribute("aria-label")).toBe("T"),
  },
  {
    name: "drawer side",
    arg: 'drawer(text("m"), side="right")',
    block: 'drawer(text("m")) {side: "right"}',
    claim: (root) => expect(find(root, tile("drawer")).style.right).toMatch(/^0(px)?$/),
  },
  {
    name: "tooltip text and placement",
    arg: 'tooltip(text("m"), text="tip", placement="top")',
    block: 'tooltip(text("m")) {text: "tip", placement: "top"}',
    claim: (root) => {
      const tip = find(root, tile("tooltip"));
      expect(tip.getAttribute("title")).toBe("tip");
      expect(tip.dataset.placement).toBe("top");
    },
  },
  {
    name: "toast kind and text",
    arg: 'toast(kind="error", text="t")',
    block: 'toast() {kind: "error", text: "t"}',
    claim: (root) => {
      const toast = find(root, tile("toast"));
      expect(toast.dataset.level).toBe("error");
      expect(toast.textContent).toBe("t");
    },
  },
  {
    name: "button type",
    arg: 'button(text="Go", type="button")',
    block: 'button(text="Go") {type: "button"}',
    claim: (root) => expect(find(root, "button").getAttribute("type")).toBe("button"),
  },
  {
    name: "input placeholder, type and required",
    arg: 'input(placeholder="P", type="email", required=true)',
    block: 'input() {placeholder: "P", type: "email", required: true}',
    claim: (root) => {
      const input = find<HTMLInputElement>(root, "input");
      expect(input.placeholder).toBe("P");
      expect(input.type).toBe("email");
      expect(input.required).toBe(true);
    },
  },
  {
    name: "input value",
    arg: 'input(value="V")',
    block: 'input() {value: "V"}',
    claim: (root) => expect(find<HTMLInputElement>(root, "input").value).toBe("V"),
  },
  {
    name: "input auto-focus",
    arg: "input(auto-focus=true)",
    block: "input() {auto-focus: true}",
    // Focus is a client-side act; a served page carries no `autofocus`.
    paths: ["client"],
    claim: (root) => expect(find(root, "input").hasAttribute("autofocus")).toBe(true),
  },
  {
    name: "file input accept and multiple",
    arg: 'input(type="file", accept="image/*", multiple=true)',
    block: 'input(type="file") {accept: "image/*", multiple: true}',
    claim: (root) => {
      const input = find<HTMLInputElement>(root, "input");
      expect(input.accept).toBe("image/*");
      expect(input.multiple).toBe(true);
    },
  },
  {
    name: "a bound Time input's type",
    arg: 'input(bind=at, type="date")',
    block: 'input(bind=at) {type: "date"}',
    claim: (root) => {
      const input = find<HTMLInputElement>(root, "input");
      expect(input.type).toBe("date");
      expect(input.value).toBe("2026-01-01");
    },
  },
  {
    name: "textarea value, placeholder and rows",
    arg: 'textarea(value="V", placeholder="P", rows=5)',
    block: 'textarea() {value: "V", placeholder: "P", rows: 5}',
    claim: (root) => {
      const area = find<HTMLTextAreaElement>(root, "textarea");
      expect(area.value).toBe("V");
      expect(area.placeholder).toBe("P");
      expect(area.getAttribute("rows")).toBe("5");
    },
  },
  {
    name: "check value",
    arg: "check(value=true)",
    block: "check() {value: true}",
    claim: (root) => expect(find<HTMLInputElement>(root, "input").checked).toBe(true),
  },
  {
    name: "switch value",
    arg: "switch(value=true)",
    block: "switch() {value: true}",
    claim: (root) => expect(find<HTMLInputElement>(root, "input").checked).toBe(true),
  },
  {
    name: "select value",
    arg: `select(value="b", options=${OPTIONS_AB})`,
    block: `select(options=${OPTIONS_AB}) {value: "b"}`,
    claim: (root) => expect(find<HTMLSelectElement>(root, "select").selectedIndex).toBe(1),
  },
  {
    name: "select placeholder",
    arg: `select(bind=pick, placeholder="Pick", options=${OPTIONS_AB})`,
    block: `select(bind=pick, options=${OPTIONS_AB}) {placeholder: "Pick"}`,
    claim: (root) => {
      const select = find<HTMLSelectElement>(root, "select");
      expect(Array.from(select.options, (o) => o.text)).toEqual(["Pick", "A", "B"]);
    },
  },
  {
    name: "radio group and selected",
    arg: 'radio(group="g", value="a", selected=true)',
    block: 'radio(value="a") {group: "g", selected: true}',
    claim: (root) => {
      const radio = find<HTMLInputElement>(root, "input");
      expect(radio.name).toBe("g");
      expect(radio.checked).toBe(true);
    },
  },
  {
    name: "a bound radio's value",
    arg: 'radio(bind=pick, group="g", value="a")',
    block: 'radio(bind=pick, group="g") {value: "a"}',
    // Chosen because `pick` holds the value it writes.
    claim: (root) => expect(find<HTMLInputElement>(root, "input").checked).toBe(true),
  },
  {
    name: "slider min, max and step",
    arg: "slider(bind=n, min=2.0, max=9.0, step=0.5)",
    block: "slider(bind=n) {min: 2.0, max: 9.0, step: 0.5}",
    claim: (root) => {
      const range = find<HTMLInputElement>(root, "input");
      expect([range.min, range.max, range.step]).toEqual(["2", "9", "0.5"]);
    },
  },
  {
    name: "progress value and max",
    arg: "progress(value=5.0, max=10.0)",
    block: "progress() {value: 5.0, max: 10.0}",
    claim: (root) => {
      const bar = find(root, "progress");
      expect([bar.getAttribute("value"), bar.getAttribute("max")]).toEqual(["5", "10"]);
    },
  },
  {
    name: "error field",
    arg: "error(field=draft)",
    block: "error() {field: draft}",
    claim: (root) => expect(find(root, tile("error")).dataset.field).toBe("draft"),
  },
  ...(
    [
      ["input", "draft", "input"],
      ["textarea", "draft", "textarea"],
      ["editable", "draft", tile("editable")],
      ["check", "flag", "input"],
      ["switch", "flag", "input"],
      ["slider", "n", "input"],
      ["select", "pick", "select"],
    ] as const
  ).map(
    ([kind, slot, selector]): Row => ({
      name: `${kind} bind`,
      arg: `${kind}(bind=${slot})`,
      block: `${kind}() {bind: ${slot}}`,
      claim: (root) => expect(find(root, selector).dataset.kumikiBind).toBe(slot),
    }),
  ),
  {
    name: "radio bind",
    arg: 'radio(bind=pick, value="a")',
    block: 'radio(value="a") {bind: pick}',
    claim: (root) => {
      const radio = find<HTMLInputElement>(root, "input");
      expect(radio.dataset.kumikiBind).toBe("pick");
      expect(radio.checked).toBe(true);
    },
  },
  {
    name: "link to",
    arg: 'link("Home", to="/x")',
    block: 'link("Home") {to: "/x"}',
    claim: (root) => expect(find(root, "a").getAttribute("href")).toBe("/x"),
  },
  {
    name: "code lang",
    arg: 'code("x", lang="ts")',
    block: 'code("x") {lang: "ts"}',
    claim: (root) => expect(find(root, "code").dataset.lang).toBe("ts"),
  },
  {
    name: "video src, controls and autoplay",
    arg: 'video(src="/v.mp4", controls=true, autoplay=true)',
    block: 'video() {src: "/v.mp4", controls: true, autoplay: true}',
    claim: (root) => {
      const video = find<HTMLVideoElement>(root, "video");
      expect(video.getAttribute("src")).toBe("/v.mp4");
      expect(video.hasAttribute("controls")).toBe(true);
      expect(video.hasAttribute("autoplay")).toBe(true);
    },
  },
  {
    name: "table-cell colspan and rowspan",
    arg: 'table(table-body(table-row(table-cell(text("a"), colspan=2, rowspan=3))))',
    block: 'table(table-body(table-row(table-cell(text("a")) {colspan: 2, rowspan: 3})))',
    claim: (root) => {
      const cell = find(root, "td");
      expect([cell.getAttribute("colspan"), cell.getAttribute("rowspan")]).toEqual(["2", "3"]);
    },
  },
];

/** Each row written both ways, the block holding a different value from the argument it overrides. */
const both: Row[] = [
  {
    name: "modal open",
    arg: 'modal(text("m"), open=false)',
    block: 'modal(text("m"), open=true) {open: false}',
    claim: (root) => expect(find(root, tile("modal")).style.display).toBe("none"),
  },
  {
    name: "select options",
    arg: `select(bind=pick, options=${OPTIONS_AB})`,
    block: `select(bind=pick, options=[{label: "A", value: "a"}]) {options: ${OPTIONS_AB}}`,
    claim: (root) => expect(find<HTMLSelectElement>(root, "select").options.length).toBe(2),
  },
  {
    name: "list ordered",
    arg: 'list(text("a"), ordered=true)',
    block: 'list(text("a"), ordered=false) {ordered: true}',
    claim: (root) => expect(find(root, tile("list")).tagName).toBe("OL"),
  },
  {
    name: "input type",
    arg: 'input(type="email")',
    block: 'input(type="text") {type: "email"}',
    claim: (root) => expect(find<HTMLInputElement>(root, "input").type).toBe("email"),
  },
  {
    name: "input bind",
    arg: "input(bind=draft)",
    block: "input(bind=pick) {bind: draft}",
    claim: (root) => expect(find(root, "input").dataset.kumikiBind).toBe("draft"),
  },
];

const MAP = '{"a": 1}';
const TUPLE = '(1, "a")';
/** A Map or a Tuple a prop shows, which the block writes by its type as the argument does. */
const shown: Row[] = [
  {
    name: "tooltip text",
    arg: 'tooltip(text("m"), text=m)',
    block: 'tooltip(text("m")) {text: m}',
    claim: (root) => expect(find(root, tile("tooltip")).getAttribute("title")).toBe(MAP),
  },
  {
    name: "modal title",
    arg: 'modal(text("m"), title=tup)',
    block: 'modal(text("m")) {title: tup}',
    claim: (root) => expect(find(root, tile("modal")).getAttribute("aria-label")).toBe(TUPLE),
  },
  {
    name: "details summary",
    arg: 'details(text("d"), summary=m)',
    block: 'details(text("d")) {summary: m}',
    claim: (root) => expect(find(root, "summary").textContent).toBe(MAP),
  },
  {
    name: "input value",
    arg: "input(value=tup)",
    block: "input() {value: tup}",
    claim: (root) => expect(find<HTMLInputElement>(root, "input").value).toBe(TUPLE),
  },
  {
    name: "code lang",
    arg: 'code("x", lang=m)',
    block: 'code("x") {lang: m}',
    claim: (root) => expect(find(root, "code").dataset.lang).toBe(MAP),
  },
];

describe("a prop a builtin lifts reads either spelling", () => {
  it.each([
    ...onEachPath(rows),
    ...onEachPath(both, "both written, the block wins: "),
    ...onEachPath(shown, "a Map or Tuple it shows: "),
  ])("$group$name, $path", async ({ arg, block, claim, path }) => {
    const viaArg = await rendered(arg, path);
    const viaBlock = await rendered(block, path);
    claim(viaArg);
    claim(viaBlock);
    expect(viaBlock.outerHTML).toBe(viaArg.outerHTML);
  });

  it("writes the slot the block binds when both spellings bind one", async () => {
    const src = withApp(
      [
        'slot a : Text = ""',
        'slot b : Text = ""',
        'tile Probe = column(input(bind=a) {bind: b}, text("a=" + a), text("b=" + b))',
      ].join("\n"),
      "Probe",
    );
    const { root } = await mountSource(src);
    typeInto(find<HTMLInputElement>(root, "input"), "x");
    await tick(0);
    expect(texts(root)).toEqual(expect.arrayContaining(["a=", "b=x"]));
  });
});

describe("one program in each spelling", () => {
  const program = (props: { modal: string; select: string; list: string }) => `
slot pick : Text = "a"
tile P = column(
  modal(text("inside modal")${props.modal},
  select(bind=pick${props.select},
  list(text("one"), text("two")${props.list},
  text("end"))
app M
    caps   = []
    routes = {"/" -> P, "/404" -> P}
    init   = []
`;
  const OPTIONS = '[{label: "Apple", value: "a"}, {label: "Pear", value: "p"}]';
  const BLOCK = program({
    modal: ') {open: false, id: "m"}',
    select: `) {options: ${OPTIONS}, id: "s"}`,
    list: ') {ordered: true, id: "l"}',
  });
  const ARGUMENT = program({
    modal: ', open=false, id="m")',
    select: `, options=${OPTIONS}, id="s")`,
    list: ', ordered=true, id="l")',
  });

  it("renders the same closed modal, two options and <ol> in both", async () => {
    for (const src of [BLOCK, ARGUMENT]) {
      const { root } = await mountSource(src);
      expect({
        modalDisplay: find(root, "#m").style.display,
        options: Array.from(find<HTMLSelectElement>(root, "#s").options, (o) => o.text),
        listTag: find(root, "#l").tagName,
      }).toEqual({ modalDisplay: "none", options: ["Apple", "Pear"], listTag: "OL" });
    }
  });
});

describe("the 252-props-in-the-block example", () => {
  it("renders its note closed until the slot opens it, both fruits, and an <ol>", async () => {
    await withMounted(await loadApp(EXAMPLE), async (root) => {
      expect(find(root, "#note").style.display).toBe("none");
      expect(Array.from(find<HTMLSelectElement>(root, "#fruit").options, (o) => o.text)).toEqual([
        "Apple",
        "Pear",
      ]);
      expect(find(root, "#steps").tagName).toBe("OL");
      find(root, "#show").click();
      await tick(0);
      expect(find(root, "#note").style.display).toBe("flex");
      find(root, "#hide").click();
      await tick(0);
      expect(find(root, "#note").style.display).toBe("none");
    });
  });

  // Each test states its subject in the argument spelling while the tile writes the block, so a
  // pass means the snapshot compared the value the block lowered.
  const SOURCE = readFileSync(EXAMPLE, "utf8");

  it("passes its tile-tests as written", async () => {
    const results = await testFile(EXAMPLE);
    expect(results.map((r) => [r.name, r.pass])).toEqual([
      ["note-closed", true],
      ["note-open", true],
      ["fruit-options", true],
      ["steps-ordered", true],
    ]);
  });

  it.each([
    ["note-closed", "tile Note", "{open: showing", "{open: not showing"],
    ["note-open", "tile Note", "{open: showing", "{open: not showing"],
    ["fruit-options", "tile Fruit", '{label: "Pear", value: "p"}', '{label: "Plum", value: "p"}'],
    ["steps-ordered", "tile Steps", "{ordered: true", "{ordered: false"],
  ])("fails %s when %s's block says otherwise", async (test, at, from, to) => {
    const path = writeSource(`prop-spellings/${test}`, editedIn(SOURCE, [at], from, to).source);
    const result = (await testFile(path)).find((r) => r.name === test);
    expect(result?.pass).toBe(false);
  });
});
