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
    const radioInput = radio.querySelector("input");
    expect(radioInput?.getAttribute("value")).toBe("pro");
    expect(radioInput?.hasAttribute("checked")).toBe(true);

    const select = serverElement({
      kind: "select",
      value: "b",
      options: [
        { label: "A", value: "a" },
        { label: "B", value: "b" },
      ],
    });
    const chosen = Array.from(select.querySelectorAll("option")).filter((o) =>
      o.hasAttribute("selected"),
    );
    expect(chosen.map((o) => o.textContent)).toEqual(["B"]);

    expect(serverElement({ kind: "textarea", value: "note" }).textContent).toBe("note");

    const slider = serverElement({ kind: "slider", value: 5, min: 0, max: 10, step: 2 });
    expect(slider.getAttribute("value")).toBe("5");
    expect(slider.getAttribute("max")).toBe("10");

    const progress = serverElement({ kind: "progress", value: 3, max: 10 });
    expect(progress.getAttribute("value")).toBe("3");
    expect(progress.getAttribute("max")).toBe("10");
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
