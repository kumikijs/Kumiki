import type { TileNode, TileProps } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { defined } from "./helpers/defined.ts";
import { freshRoot } from "./helpers/dom.ts";

type Handler = "onKeyDown" | "onMouseEnter" | "onFocus" | "onBlur";

const input = (props: TileProps): TileNode => ({
  kind: "input",
  type: "text",
  placeholder: "",
  props,
});
const box = (props: TileProps): TileNode => ({ kind: "box", children: [], props });

describe("a ui handler receives the tile's el payload", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = freshRoot();
  });
  afterEach(() => {
    root.remove();
  });

  it.each<[Handler, (props: TileProps) => TileNode, string, Event, Record<string, unknown>]>([
    [
      "onKeyDown",
      input,
      "input",
      new KeyboardEvent("keydown", { key: "Enter", code: "Enter" }),
      { kind: "Field", key: "Enter", code: "Enter" },
    ],
    [
      "onMouseEnter",
      box,
      '[data-kumiki-tile="box"]',
      new MouseEvent("mouseenter"),
      { kind: "Field" },
    ],
    ["onFocus", input, "input", new FocusEvent("focus"), { kind: "Field" }],
    ["onBlur", input, "input", new FocusEvent("blur"), { kind: "Field" }],
  ])("%s", (handler, tile, selector, event, payload) => {
    const seen: Record<string, unknown>[] = [];
    const props: TileProps = {
      el: { kind: "Field" },
      [handler]: (el: Record<string, unknown>) => seen.push(el),
    };
    mount(bareApp({ root: () => tile(props) }), root);
    defined(root.querySelector(selector), selector).dispatchEvent(event);
    expect(seen).toEqual([payload]);
  });
});
