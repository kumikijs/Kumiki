// What a tile-test compares (testing.md §8.4), on hand-built nodes shaped the
// way codegen lowers them: content fields at the top level, every named
// argument folded into `props` beside the `{…}` block's styles and the
// handlers, plus `el` (the element attribute bag) and `_tile` (the user-tile
// marker). The compile-and-run cases are in
// `packages/tests/tile-test-content-fields.test.ts`.

import { _stdlib } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

const run = (expected: unknown, actual: unknown) =>
  _stdlib.runTileTest({ name: "t", expected, actual });

describe("a tile-test compares the named arguments in props", () => {
  it("fails a disabled expectation against an enabled button", () => {
    const r = run(
      { kind: "button", text: "Go", props: { text: "Go", disabled: true } },
      { kind: "button", text: "Go", props: { text: "Go" } },
    );
    expect(r.pass).toBe(false);
    expect(r.diffAt).toBe("button.disabled");
    expect(r.leaf).toEqual({ expected: true, actual: undefined });
  });

  it("fails a wrong alt", () => {
    const r = run(
      { kind: "image", src: "/a.png", props: { src: "/a.png", alt: "WRONG" } },
      { kind: "image", src: "/a.png", props: { src: "/a.png", alt: "avatar" } },
    );
    expect(r.pass).toBe(false);
    expect(r.diffAt).toBe("image.alt");
    expect(r.leaf).toEqual({ expected: "WRONG", actual: "avatar" });
  });

  it("compares each stated aria attribute on its own", () => {
    // Codegen merges every `aria-*` argument into one `aria` map. Stating one
    // attribute of a tile that renders two asserts that one.
    const rendered = {
      kind: "button",
      text: "x",
      props: { aria: { "aria-label": "Close", "aria-describedby": "hint" } },
    };
    const ok = run(
      { kind: "button", text: "x", props: { aria: { "aria-label": "Close" } } },
      rendered,
    );
    expect(ok.pass).toBe(true);
    const r = run(
      { kind: "button", text: "x", props: { aria: { "aria-label": "Shut" } } },
      rendered,
    );
    expect(r.diffAt).toBe("button.aria-label");
    expect(r.leaf).toEqual({ expected: "Shut", actual: "Close" });
    expect(r.expected).toBe('button("x", aria-label="Shut")');
    expect(r.actual).toBe('button("x", aria-label="Close")');
  });

  it("names an aria map key by the attribute it renders", () => {
    // `aria={label: …}` and `aria-label=…` write the same attribute.
    const r = run(
      { kind: "icon", name: "x", props: { aria: { label: "close" } } },
      { kind: "icon", name: "x", props: { aria: { "aria-label": "shut" } } },
    );
    expect(r.diffAt).toBe("icon.aria-label");
  });

  it("compares an argument lifted under another name once", () => {
    // `input(auto-focus=…)` lowers to a top-level `autoFocus` and folds into
    // props as `auto_focus`; the two are one argument.
    const r = run(
      { kind: "input", autoFocus: false, props: { auto_focus: false } },
      { kind: "input", autoFocus: true, props: { auto_focus: true } },
    );
    expect(r.diffAt).toBe("input.autoFocus");
    expect(r.expected).toBe("input(autoFocus=false)");
    expect(r.actual).toBe("input(autoFocus=true)");
  });

  it("reaches a differing argument past el, _tile, class, style and handlers", () => {
    // Every entry ahead of `disabled` differs too; none of them is content.
    const r = run(
      {
        kind: "button",
        text: "Go",
        props: {
          el: { a: 1 },
          _tile: "A",
          class: "x",
          style: { color: "red" },
          onClick: () => 1,
          disabled: true,
        },
      },
      {
        kind: "button",
        text: "Go",
        props: {
          el: { a: 2 },
          _tile: "B",
          class: "y",
          style: { color: "blue" },
          onClick: () => 2,
          disabled: false,
        },
      },
    );
    expect(r.diffAt).toBe("button.disabled");
  });

  it("compares a toggle's value argument once, as its checked state", () => {
    // `check(value=true)` lowers to `checked: true` with `value: true` folded
    // into props; a `check(bind=agreed)` carries the same state as `checked`
    // alone. The argument is the checked state, not a second field, so the
    // first difference is the one argument that does differ.
    const r = run(
      { kind: "check", checked: true, props: { value: true, disabled: true } },
      { kind: "check", checked: true, bind: "agreed", props: { disabled: false } },
    );
    expect(r.diffAt).toBe("check.disabled");
  });

  it("compares a value that lands in props unbound and at the top level bound", () => {
    // `slider(value=5)` keeps the value in props; `slider(bind=v)` lifts it.
    const ok = run(
      { kind: "slider", props: { value: 5 } },
      { kind: "slider", value: 5, bind: "v", props: {} },
    );
    expect(ok.pass).toBe(true);
    const r = run(
      { kind: "slider", props: { value: 5 } },
      { kind: "slider", value: 7, bind: "v", props: {} },
    );
    expect(r.diffAt).toBe("slider.value");
  });
});

describe("a tile-test leaves identity and wiring out", () => {
  it("does not compare key", () => {
    const r = run(
      { kind: "column", children: [{ kind: "text", text: "Ada", key: '{"id":1}', props: {} }] },
      { kind: "column", children: [{ kind: "text", text: "Ada", key: "1", props: {} }] },
    );
    expect(r.pass).toBe(true);
  });

  it("does not compare prefetch, prefetchArgs, bind, bindPath or parse", () => {
    const r = run(
      {
        kind: "input",
        value: "1",
        prefetch: "a",
        prefetchArgs: { a: 1 },
        bind: "a",
        bindPath: ["x"],
        parse: { as: "Int", read: () => 1 },
        props: {},
      },
      {
        kind: "input",
        value: "1",
        prefetch: "b",
        prefetchArgs: { b: 2 },
        bind: "b",
        bindPath: ["y"],
        parse: { as: "Float", read: () => 2 },
        props: {},
      },
    );
    expect(r.pass).toBe(true);
  });
});

describe("a builtin's default is compared", () => {
  it("fails check() against a ticked box at check.value", () => {
    // A toggle's checked state is its `value=` argument, and is named so.
    const r = run(
      { kind: "check", checked: false, props: {} },
      { kind: "check", checked: true, props: { value: true } },
    );
    expect(r.diffAt).toBe("check.value");
    expect(r.leaf).toEqual({ expected: false, actual: true });
    expect(r.expected).toBe("check(value=false)");
    expect(r.actual).toBe("check(value=true)");
  });

  it("fails select(value=…) with no options= at select.options", () => {
    const r = run(
      { kind: "select", value: "l", options: [], props: { value: "l" } },
      { kind: "select", value: "l", options: [{ label: "L", value: "l" }], props: {} },
    );
    expect(r.diffAt).toBe("select.options");
  });
});

describe("the expected / actual lines", () => {
  it("print only the fields the expected node states, on both sides", () => {
    // A bound input carries placeholder, bind, bindPath, parse and (in a
    // `for`) key; `input(value="Grace")` states none of them.
    const r = run(
      { kind: "input", value: "Grace", props: { value: "Grace" } },
      {
        kind: "input",
        value: "Ada",
        placeholder: "your name",
        bind: "name",
        bindPath: ["first"],
        parse: { as: "Int", read: () => 1 },
        key: "k",
        props: { placeholder: "your name" },
      },
    );
    expect(r.expected).toBe('input(value="Grace")');
    expect(r.actual).toBe('input(value="Ada")');
  });

  it("print a node's text and its children together", () => {
    const node = {
      kind: "button",
      text: "Add",
      props: {},
      children: [{ kind: "icon", name: "plus", props: {} }],
    };
    expect(run(node, node).expected).toBe('button("Add", icon(name="plus"))');
  });

  it("print a field the actual node lacks as missing, not as a value", () => {
    const r = run(
      { kind: "button", text: "Go", props: { disabled: true } },
      { kind: "button", text: "Go", props: {} },
    );
    expect(r.expected).toBe('button("Go", disabled=true)');
    expect(r.actual).toBe('button("Go")');
  });
});
