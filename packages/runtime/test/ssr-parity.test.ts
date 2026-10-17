import type { TileNode } from "@kumikijs/runtime";
import {
  collectionTiles,
  inputTiles,
  layoutTiles,
  mediaTiles,
  overlayTiles,
  statusTiles,
  textTiles,
} from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { clientElement, serverElement, shapeOf } from "./helpers/ssr-elements.ts";

const CONTAINER_PROPS = {
  gap: "sm",
  align: "center",
  justify: "between",
  pad: "lg",
  max_w: 720,
  w: "full",
  wrap: true,
  shadow: "sm",
  bg: "surface",
  radius: "md",
  style: { "letter-spacing": "0.02em" },
};

const TEXT_PROPS = {
  color: "primary",
  size: "xxl",
  weight: "bold",
  strike: true,
  style: { "text-transform": "uppercase" },
};

/** The common props every kind accepts, on one node. */
const COMMON_PROPS = {
  class: "a b",
  test_id: "t",
  aria: { label: "Labelled" },
};

/** A child to hang under a container, so a container's subtree is not empty. */
const CHILD: TileNode = { kind: "text", text: "child" };

type ParityCase = [label: string, node: TileNode];

type KindRow = {
  cases: [ParityCase, ...ParityCase[]];
  /** Why the text the two paths hold is not compared. */
  noText?: string;
};

const TABLE: Record<TileNode["kind"], KindRow> = {
  page: {
    cases: [
      ["page", { kind: "page", children: [CHILD], props: CONTAINER_PROPS }],
      ["page (common props)", { kind: "page", children: [], props: COMMON_PROPS }],
    ],
  },
  column: { cases: [["column", { kind: "column", children: [CHILD], props: CONTAINER_PROPS }]] },
  row: { cases: [["row", { kind: "row", children: [CHILD], props: CONTAINER_PROPS }]] },
  card: {
    cases: [
      ["card", { kind: "card", children: [CHILD], props: CONTAINER_PROPS }],
      ["card (no pad)", { kind: "card", children: [] }],
    ],
  },
  box: { cases: [["box", { kind: "box", children: [CHILD], props: CONTAINER_PROPS }]] },
  stack: { cases: [["stack", { kind: "stack", children: [CHILD], props: CONTAINER_PROPS }]] },
  scroll: { cases: [["scroll", { kind: "scroll", children: [CHILD], props: CONTAINER_PROPS }]] },
  panel: { cases: [["panel", { kind: "panel", children: [CHILD], props: CONTAINER_PROPS }]] },
  fieldset: {
    cases: [
      ["fieldset", { kind: "fieldset", children: [CHILD], props: CONTAINER_PROPS }],
      ["fieldset (legend)", { kind: "fieldset", children: [CHILD], props: { legend: "Billing" } }],
      ["fieldset (empty legend)", { kind: "fieldset", children: [CHILD], props: { legend: "" } }],
    ],
  },
  region: { cases: [["region", { kind: "region", children: [CHILD], props: CONTAINER_PROPS }]] },
  grid: {
    cases: [
      ["grid", { kind: "grid", children: [CHILD], props: { ...CONTAINER_PROPS, cols: 4 } }],
      ["grid (default cols)", { kind: "grid", children: [] }],
      ["grid (rows)", { kind: "grid", children: [], props: { cols: "1fr auto", rows: 2 } }],
    ],
  },
  overlay: {
    cases: [
      ["overlay", { kind: "overlay", children: [CHILD], props: CONTAINER_PROPS }],
      [
        "overlay (layers)",
        {
          kind: "overlay",
          children: [CHILD, { kind: "text", text: "over" }, { kind: "text", text: "more" }],
          props: { align: "top-right" },
        },
      ],
      [
        "overlay (default align)",
        { kind: "overlay", children: [CHILD, { kind: "text", text: "over" }] },
      ],
      [
        "overlay (bottom-left)",
        {
          kind: "overlay",
          children: [CHILD, { kind: "text", text: "over" }],
          props: { align: "bottom-left" },
        },
      ],
      [
        "overlay (hole where a child would be)",
        {
          kind: "overlay",
          children: [CHILD, null as unknown as TileNode, { kind: "text", text: "over" }],
        },
      ],
    ],
  },
  "route-outlet": {
    cases: [["route-outlet", { kind: "route-outlet", children: [CHILD], props: CONTAINER_PROPS }]],
  },
  heading: { cases: [["heading", { kind: "heading", text: "Title", props: TEXT_PROPS }]] },
  text: { cases: [["text", { kind: "text", text: "body", props: TEXT_PROPS }]] },
  label: { cases: [["label", { kind: "label", text: "Email", props: { for: "email" } }]] },
  link: {
    cases: [
      ["link", { kind: "link", text: "Home", to: "/", props: TEXT_PROPS }],
      [
        "link (external)",
        { kind: "link", text: "Docs", to: "https://x", props: { external: true } },
      ],
    ],
  },
  markdown: {
    cases: [
      ["markdown", { kind: "markdown", text: "one\ntwo\n\nthree", props: TEXT_PROPS }],
      ["markdown (empty)", { kind: "markdown", text: "" }],
    ],
  },
  code: {
    cases: [
      ["code", { kind: "code", text: "const a = 1", lang: "ts", props: CONTAINER_PROPS }],
      ["code (no lang)", { kind: "code", text: "plain" }],
    ],
  },
  icon: {
    cases: [["icon", { kind: "icon", name: "star", props: { ...TEXT_PROPS, size: "lg" } }]],
    noText:
      "the client writes `[name]` while the icon is unresolved and an <svg> once it is; the " +
      "server serves the empty placeholder either way, so the two agree on the " +
      "element and not on what is in it",
  },
  form: { cases: [["form", { kind: "form", children: [CHILD], props: CONTAINER_PROPS }]] },
  button: {
    cases: [
      ["button", { kind: "button", text: "Send", type: "submit" }],
      ["button (id in props)", { kind: "button", text: "Send", props: { id: "send" } }],
      // FALSY: `if (node.type)` on the client against a raw field on the server.
      ["button (empty type)", { kind: "button", text: "", type: "" }],
      [
        "button (loading)",
        { kind: "button", text: "Save", props: { loading: true, variant: "primary" } },
      ],
    ],
  },
  input: {
    cases: [
      ["input", { kind: "input", value: "v", placeholder: "p", id: "i", required: true }],
      ["input (id in props)", { kind: "input", value: "", props: { id: "from-props" } }],
      [
        "input (control state)",
        { kind: "input", value: "", props: { disabled: true, auto_complete: "email" } },
      ],
      [
        "input (every field empty)",
        {
          kind: "input",
          value: "",
          placeholder: "",
          id: "",
          accept: "",
          bind: "",
          props: { id: "" },
        },
      ],
      [
        "input (bind through .get)",
        { kind: "input", value: "v", bind: "draft", bindPath: [{ get: true }, "title"] },
      ],
    ],
  },
  textarea: {
    cases: [
      [
        "textarea",
        { kind: "textarea", value: "hello", rows: 4, placeholder: "p", id: "t", bind: "draft" },
      ],
      [
        "textarea (empty fields)",
        { kind: "textarea", value: "", rows: 0, placeholder: "", bind: "" },
      ],
    ],
    noText:
      "a textarea's value is its text on the server and its `.value` property on the client — " +
      "the same asymmetry `PROPERTY_ON_THE_CLIENT` covers for an <input>, one node down",
  },
  check: {
    cases: [
      ["check", { kind: "check", checked: true }],
      ["check (id, control state)", { kind: "check", checked: false, props: { id: "c" } }],
      ["check (bind)", { kind: "check", checked: true, bind: "agreed" }],
      ["check (label)", { kind: "check", checked: true, props: { label: "I agree" } }],
      ["check (empty label)", { kind: "check", checked: false, props: { label: "" } }],
    ],
  },
  switch: {
    cases: [
      ["switch", { kind: "switch", checked: true }],
      ["switch (id)", { kind: "switch", checked: false, props: { id: "s" } }],
      ["switch (bind)", { kind: "switch", checked: false, bind: "lit" }],
    ],
  },
  radio: {
    cases: [
      [
        "radio",
        { kind: "radio", group: "plan", value: "pro", selected: true, props: { label: "Pro" } },
      ],
      ["radio (no label)", { kind: "radio", group: "plan", value: "free" }],
      [
        "radio (bind)",
        { kind: "radio", group: "plan", value: "pro", selected: true, bind: "plan" },
      ],
      [
        "radio (bind through .get)",
        {
          kind: "radio",
          group: "plan",
          value: "pro",
          bind: "form",
          bindPath: [{ get: true }, "plan"],
        },
      ],
    ],
  },
  select: {
    cases: [
      [
        "select",
        {
          kind: "select",
          value: "b",
          options: [
            { label: "A", value: "a" },
            { label: "B", value: "b" },
          ],
          bind: "choice",
          props: { id: "sel" },
        },
      ],
      [
        "select (placeholder, nothing chosen)",
        {
          kind: "select",
          placeholder: "Pick one",
          options: [{ label: "A", value: "a" }],
        },
      ],
    ],
  },
  slider: {
    cases: [
      ["slider", { kind: "slider", value: 5, min: 0, max: 10, step: 2, bind: "vol" }],
      ["slider (bare)", { kind: "slider" }],
      // FALSY: `min: 0` IS a bound and stays; `bind: ""` is not one and goes.
      ["slider (zero bounds, no bind)", { kind: "slider", value: 0, min: 0, step: 0, bind: "" }],
    ],
  },
  editable: {
    cases: [
      ["editable", { kind: "editable", text: "note", bind: "draft", props: { id: "e" } }],
      ["editable (readonly)", { kind: "editable", text: "note", props: { readonly: true } }],
      ["editable (no bind)", { kind: "editable", text: "", bind: "" }],
    ],
  },
  image: {
    cases: [
      [
        "image",
        { kind: "image", src: "/a.png", props: { alt: "A cat", id: "pic", width: 40, height: 20 } },
      ],
      ["image (no alt)", { kind: "image", src: "/a.png" }],
      ["image (lazy)", { kind: "image", src: "/a.png", props: { loading: "lazy" } }],
    ],
  },
  video: {
    cases: [
      ["video", { kind: "video", src: "/a.mp4", controls: true, props: { id: "v" } }],
      ["video (autoplay)", { kind: "video", autoplay: true }],
      ["video (empty src)", { kind: "video", src: "" }],
    ],
  },
  divider: {
    cases: [
      ["divider", { kind: "divider", props: CONTAINER_PROPS }],
      ["divider (vertical)", { kind: "divider", props: { orientation: "vertical" } }],
    ],
  },
  spinner: {
    cases: [
      ["spinner", { kind: "spinner" }],
      ["spinner (sized)", { kind: "spinner", props: { size: "lg" } }],
    ],
  },
  skeleton: {
    cases: [
      ["skeleton", { kind: "skeleton" }],
      ["skeleton (h)", { kind: "skeleton", props: { h: 120 } }],
    ],
  },
  progress: { cases: [["progress", { kind: "progress", value: 3, max: 10 }]] },
  toast: {
    cases: [
      ["toast", { kind: "toast", text: "Saved", level: "info" }],
      ["toast (no level)", { kind: "toast", text: "Saved" }],
      ["toast (empty level)", { kind: "toast", text: "", level: "" }],
    ],
  },
  error: {
    cases: [["error", { kind: "error", field: "email" }]],
  },
  tooltip: {
    cases: [
      [
        "tooltip",
        { kind: "tooltip", text: "Why", placement: "top", children: [CHILD], props: TEXT_PROPS },
      ],
      ["tooltip (no placement)", { kind: "tooltip", text: "Why", children: [] }],
      [
        "tooltip (empty text and placement)",
        { kind: "tooltip", text: "", placement: "", children: [] },
      ],
    ],
  },
  list: {
    cases: [
      ["list", { kind: "list", children: [{ kind: "list-item", children: [CHILD] }] }],
      ["list (ordered)", { kind: "list", ordered: true, children: [], props: CONTAINER_PROPS }],
    ],
  },
  "list-item": { cases: [["list-item", { kind: "list-item", children: [CHILD] }]] },
  table: {
    cases: [
      [
        "table",
        {
          kind: "table",
          children: [
            {
              kind: "table-head",
              children: [{ kind: "table-row", children: [{ kind: "table-cell", children: [] }] }],
            },
          ],
          props: CONTAINER_PROPS,
        },
      ],
    ],
  },
  "table-head": { cases: [["table-head", { kind: "table-head", children: [] }]] },
  "table-body": { cases: [["table-body", { kind: "table-body", children: [] }]] },
  "table-row": { cases: [["table-row", { kind: "table-row", children: [] }]] },
  "table-cell": {
    cases: [
      ["table-cell", { kind: "table-cell", children: [CHILD], colspan: 2, rowspan: 3 }],
      ["table-cell (no span)", { kind: "table-cell", children: [] }],
      // FALSY: a zero span is no span — `colspan="0"` means "to the end of the
      // section", which is not what a tile that said nothing asked for.
      ["table-cell (zero spans)", { kind: "table-cell", children: [], colspan: 0, rowspan: 0 }],
    ],
  },
  modal: {
    cases: [
      [
        "modal (open)",
        { kind: "modal", open: true, title: "Confirm", children: [CHILD], props: CONTAINER_PROPS },
      ],
      ["modal (closed)", { kind: "modal", open: false, children: [CHILD] }],
      ["modal (no open field)", { kind: "modal", children: [] }],
    ],
  },
  drawer: {
    cases: [
      ["drawer (open)", { kind: "drawer", open: true, title: "Menu", children: [CHILD] }],
      ["drawer (right)", { kind: "drawer", side: "right", children: [] }],
      ["drawer (closed)", { kind: "drawer", open: false, children: [CHILD] }],
    ],
  },
  popover: {
    cases: [
      ["popover (open)", { kind: "popover", open: true, children: [CHILD] }],
      ["popover (closed)", { kind: "popover", open: false, children: [CHILD] }],
    ],
  },
  details: {
    cases: [
      [
        "details (open)",
        { kind: "details", summary: "More", open: true, children: [CHILD], props: { id: "d" } },
      ],
      ["details (closed)", { kind: "details", summary: "More", children: [CHILD] }],
    ],
  },
};

const EVERY_TILE_KIND = Object.keys({
  ...layoutTiles,
  ...textTiles,
  ...inputTiles,
  ...collectionTiles,
  ...overlayTiles,
  ...mediaTiles,
  ...statusTiles,
}).sort();

describe("the server pass renders what the client renders", () => {
  it("compares every kind the runtime renders", () => {
    expect(EVERY_TILE_KIND).toEqual(Object.keys(TABLE).sort());
  });

  for (const [kind, row] of Object.entries(TABLE)) {
    const opts = { deep: true, text: row.noText === undefined };
    describe(kind, () => {
      for (const [label, node] of row.cases) {
        it(`agrees on ${label}`, () => {
          const client = clientElement(node);
          const server = serverElement(node);
          expect(shapeOf(server, opts)).toEqual(shapeOf(client, opts));
        });
      }
    });
  }
});
