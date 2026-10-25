import type { TileNode } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { serverElement, styleOf } from "./helpers/ssr-elements.ts";

describe("the server pass on its own", () => {
  it("carries the form state a live element cannot", () => {
    const input = serverElement({ kind: "input", value: "typed", type: "email" });
    expect(input.getAttribute("value")).toBe("typed");

    const check = serverElement({ kind: "check", checked: true });
    expect(check.querySelector("input")?.hasAttribute("checked")).toBe(true);
    const unchecked = serverElement({ kind: "check", checked: false });
    expect(unchecked.querySelector("input")?.hasAttribute("checked")).toBe(false);

    const radio = serverElement({ kind: "radio", group: "plan", value: "pro", selected: true });
    expect(radio.querySelector("input")?.hasAttribute("checked")).toBe(true);

    expect(serverElement({ kind: "textarea", value: "note" }).textContent).toBe("note");

    const slider = serverElement({ kind: "slider", value: 5, min: 0, max: 10, step: 2 });
    expect(slider.getAttribute("value")).toBe("5");
    expect(slider.getAttribute("max")).toBe("10");

    const progress = serverElement({ kind: "progress", value: 3, max: 10 });
    expect(progress.getAttribute("value")).toBe("3");
    expect(progress.getAttribute("max")).toBe("10");
  });

  // `selected` is a property on the client, so a served page carries it only as the attribute.
  const selectedLabels = (node: TileNode): (string | null)[] =>
    Array.from(serverElement(node).querySelectorAll("option"))
      .filter((o) => o.hasAttribute("selected"))
      .map((o) => o.textContent);
  const sizes = [
    { label: "Small", value: { _tag: "S" } },
    { label: "Medium", value: { _tag: "M" } },
  ];
  const statuses = [
    { label: "Any", value: { _tag: "None" } },
    { label: "A", value: { _tag: "Some", _0: { _tag: "A" } } },
    { label: "B", value: { _tag: "Some", _0: { _tag: "B" } } },
  ];

  it.each<[string, TileNode, string[]]>([
    [
      "a Text",
      {
        kind: "select",
        value: "b",
        options: [
          { label: "A", value: "a" },
          { label: "B", value: "b" },
        ],
      },
      ["B"],
    ],
    ["a nullary variant", { kind: "select", value: { _tag: "M" }, options: sizes }, ["Medium"]],
    [
      "a variant with a payload",
      { kind: "select", value: { _tag: "Some", _0: { _tag: "B" } }, options: statuses },
      ["B"],
    ],
    ["None", { kind: "select", value: { _tag: "None" }, options: statuses }, ["Any"]],
    [
      "a record",
      {
        kind: "select",
        value: { w: 2, h: 3 },
        options: [
          { label: "1x1", value: { w: 1, h: 1 } },
          { label: "2x3", value: { w: 2, h: 3 } },
        ],
      },
      ["2x3"],
    ],
    [
      "an option with no value beside one with a value",
      {
        kind: "select",
        value: "b",
        options: [
          { label: "A", value: undefined },
          { label: "B", value: "b" },
        ],
      },
      ["B"],
    ],
    [
      "no value, under a placeholder",
      { kind: "select", placeholder: "Pick a size", options: sizes },
      ["Pick a size"],
    ],
    [
      "a value, under a placeholder",
      { kind: "select", value: { _tag: "M" }, placeholder: "Pick a size", options: sizes },
      ["Medium"],
    ],
  ])("marks the option a select holds selected (%s)", (_, node, want) => {
    expect(selectedLabels(node)).toEqual(want);
  });

  // The key a select's option carries, so a variant or a record radio is not `[object Object]`.
  it.each<[string, unknown, string | null]>([
    ["a Text", "pro", '"pro"'],
    ["a nullary variant", { _tag: "M" }, "M"],
    ["a variant with a payload", { _tag: "Some", _0: { _tag: "B" } }, "Some|B"],
    ["a record", { h: 3, w: 2 }, '{"h":3,"w":2}'],
    ["no value", undefined, null],
  ])("serves a radio's value as its structural key (%s)", (_, value, want) => {
    const radio = serverElement({ kind: "radio", group: "g", value });
    expect(radio.querySelector("input")?.getAttribute("value") ?? null).toBe(want);
  });

  it("escapes what it puts in text and in an attribute", () => {
    const text = serverElement({ kind: "text", text: '<script>alert("x")</script> & more' });
    expect(text.querySelector("script")).toBeNull();
    expect(text.textContent).toBe('<script>alert("x")</script> & more');

    const img = serverElement({ kind: "image", src: "/a.png", props: { alt: '" onerror="boom' } });
    expect(img.getAttribute("alt")).toBe('" onerror="boom');
    expect(img.hasAttribute("onerror")).toBe(false);

    const md = serverElement({ kind: "markdown", text: "<script>alert(1)</script>" });
    expect(md.querySelector("script")).toBeNull();
    expect(md.textContent).toBe("<script>alert(1)</script>");
  });

  it("serves a closed overlay as the hidden host the client mounts", () => {
    const el = serverElement({
      kind: "modal",
      open: false,
      title: "Confirm",
      children: [{ kind: "text", text: "body" }],
    });
    expect(styleOf(el).display).toBe("none");
    expect(el.textContent).toContain("body");
  });

  it("resolves a responsive value to its base, which is all a server can know", () => {
    const node: TileNode = { kind: "row", children: [], props: { gap: { base: "sm", md: "xl" } } };
    expect(styleOf(serverElement(node)).gap).toBe("8px");
  });

  it("lets a card's own padding prop suppress the default even when it resolves to nothing", () => {
    const node: TileNode = { kind: "card", children: [], props: { pad: { md: "xl" } } };
    expect(styleOf(serverElement(node))["padding-top"]).toBeUndefined();
    expect(styleOf(serverElement({ kind: "card", children: [] }))["padding-top"]).toBe("16px");
  });
});
