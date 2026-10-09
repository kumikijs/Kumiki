// `_attachProps` on its own, with no mount (language.md §1.7.3).
//
// It ships as source text in `RUNTIME_HELPERS`, inlined at the top of every
// compiled app, so it is evaluated here the same way. A mounted program says
// whether a reducer fired; these say which prop each field of the merged node
// came from.

import { describe, expect, it } from "vitest";
import { RUNTIME_HELPERS } from "../src/codegen/runtime-helpers.ts";

type Props = Record<string, unknown>;
type Node = { kind: string; text?: string; props?: Props };
type Tree = Node | null | undefined | Tree[];

const { _attachProps } = new Function(`${RUNTIME_HELPERS}\nreturn { _attachProps };`)() as {
  _attachProps: (node: Tree, props: Props | undefined) => Tree;
};

/** The button `tile Ghost = button(text="Ghost", id="three") {todoId: 7}` renders. */
const ghost = (): Node => ({
  kind: "button",
  text: "Ghost",
  props: {
    todoId: 7,
    text: "Ghost",
    id: "three",
    aria: { "aria-label": "Delete" },
    el: { todoId: 7, text: "Ghost", id: "three", aria: { "aria-label": "Delete" } },
  },
});

const propsOf = (tree: Tree): Props => (tree as Node).props ?? {};

describe("_attachProps", () => {
  it("keeps every field of the payload the call site does not write", () => {
    const merged = propsOf(_attachProps(ghost(), { variant: "ghost", el: { variant: "ghost" } }));
    expect(merged.el).toEqual({
      todoId: 7,
      text: "Ghost",
      id: "three",
      aria: { "aria-label": "Delete" },
      variant: "ghost",
    });
    expect(merged.id).toBe("three");
    expect(merged.variant).toBe("ghost");
  });

  it("takes the call site's value for a field it writes, at the top level and in the payload", () => {
    const merged = propsOf(_attachProps(ghost(), { id: "x", el: { id: "x" } }));
    expect(merged.id).toBe("x");
    expect(merged.el).toMatchObject({ id: "x", todoId: 7, text: "Ghost" });
  });

  it("merges the aria map one attribute at a time, in the props and in the payload", () => {
    const aria = { "aria-describedby": "hint" };
    const merged = propsOf(_attachProps(ghost(), { aria, el: { aria } }));
    const both = { "aria-label": "Delete", "aria-describedby": "hint" };
    expect(merged.aria).toEqual(both);
    expect((merged.el as Props).aria).toEqual(both);
  });

  it("replaces a record-valued data prop whole rather than merging its fields", () => {
    const node: Node = { kind: "button", props: { todo: { id: 1, done: false } } };
    expect(propsOf(_attachProps(node, { todo: { done: true } })).todo).toEqual({ done: true });
  });

  it("gives a payload to a node that had none", () => {
    const node: Node = { kind: "button", props: {} };
    expect(propsOf(_attachProps(node, { variant: "a", el: { variant: "a" } })).el).toEqual({
      variant: "a",
    });
  });

  it("merges onto every node of a list, each keeping its own id", () => {
    const item = (id: string): Node => ({ kind: "button", props: { id, el: { id } } });
    const merged = _attachProps([item("p"), item("q")], { variant: "a", el: { variant: "a" } });
    expect((merged as Node[]).map((n) => n.props?.el)).toEqual([
      { id: "p", variant: "a" },
      { id: "q", variant: "a" },
    ]);
  });

  it("leaves the node it was given untouched", () => {
    const node = ghost();
    _attachProps(node, { variant: "a", aria: { x: "1" }, el: { variant: "a", aria: { x: "1" } } });
    expect(node).toEqual(ghost());
  });

  it("returns the node itself when the call site writes nothing", () => {
    const node = ghost();
    expect(_attachProps(node, {})).toBe(node);
    expect(_attachProps(null, { variant: "a" })).toBe(null);
  });
});
