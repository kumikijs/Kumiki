import type { RuntimeDiagnostic, TileCtx, TileNode, TileRenderers } from "@kumikijs/runtime";
import { mountCore } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appOf } from "./helpers/app.ts";
import { captureConsole } from "./helpers/console.ts";
import { freshRoot } from "./helpers/dom.ts";

function tile(raw: Record<string, unknown>): TileNode {
  return raw as unknown as TileNode;
}

/** A leaf tile carrying `props`, the everyday data-prop carrier. */
function leaf(props: Record<string, unknown>): TileNode {
  return tile({ kind: "text", text: "same", props });
}

function probeRenderers(): TileRenderers {
  const render = (node: TileNode, ctx: TileCtx): HTMLElement => {
    const el = document.createElement("div");
    el.dataset.kind = node.kind;
    for (const child of (node as { children?: TileNode[] }).children ?? []) {
      el.appendChild(ctx.render(child));
    }
    return el;
  };
  return { text: render, heading: render, input: render, column: render };
}

type Decision = {
  verdict: "reuse" | "rebuild";
  /** The `reconcile-fallback` diagnostics the walker reported for the pass. */
  fallbacks: RuntimeDiagnostic[];
  reasons: string[];
  after: HTMLElement;
  /** Taken before the re-render: a reused root's children would only show the new ones. */
  childrenBefore: Element[];
};

let host: HTMLElement;

beforeEach(() => {
  host = freshRoot();
});
afterEach(() => {
  vi.restoreAllMocks();
  host.remove();
});

/** Mounts `oldNode`, re-renders as `newNode`, and reports what the walker did. */
function decide(oldNode: TileNode, newNode: TileNode): Decision {
  let current = oldNode;
  const seen: RuntimeDiagnostic[] = [];
  const app = appOf(() => current);
  const { dispose } = mountCore(app, host, {
    tiles: probeRenderers(),
    // Without a patcher, "props differ" can only mean a rebuild, so DOM identity reads out the verdict.
    tilePatchers: {},
    onDiagnostic: (d) => seen.push(d),
  });
  const before = host.firstElementChild as HTMLElement;
  const childrenBefore = [...before.children];
  // A missing seam would re-render nothing and report every case as a reuse.
  const rerender = app._rerender;
  if (!rerender) throw new Error("mount did not attach `_rerender` — the harness cannot re-render");

  current = newNode;
  rerender();
  const after = host.firstElementChild as HTMLElement;
  dispose();

  const unexpected = seen.filter((d) => d.kind !== "reconcile-fallback");
  if (unexpected.length > 0) {
    throw new Error(`unexpected diagnostic kind(s): ${unexpected.map((d) => d.kind).join(", ")}`);
  }
  return {
    verdict: before === after ? "reuse" : "rebuild",
    fallbacks: seen,
    reasons: seen.map((d) => (d.kind === "reconcile-fallback" ? d.reason : d.kind)),
    after,
    childrenBefore,
  };
}

function expectVerdict(a: TileNode, b: TileNode, verdict: "reuse" | "rebuild"): void {
  const d = decide(a, b);
  expect(d.verdict).toBe(verdict);
  expect(d.reasons.includes("no-patcher")).toBe(verdict === "rebuild");
}

const handler = () => undefined;
const date = new Date(1);
const nullBag = (v: number): Record<string, unknown> =>
  Object.assign(Object.create(null) as Record<string, unknown>, { v });

class Point {
  constructor(
    readonly x: number,
    readonly y: number,
  ) {}
  get label(): string {
    return `${this.x},${this.y}`;
  }
}

describe("the reconcile prop-equality kernel", () => {
  // Every pair is checked in both directions: equality must not depend on which side is old.
  it.each<[string, TileNode, TileNode, "reuse" | "rebuild"]>([
    [
      "a missing top-level field equals an explicit undefined",
      tile({ kind: "input", value: "a" }),
      tile({ kind: "input", value: "a", placeholder: undefined }),
      "reuse",
    ],
    [
      "a missing prop equals an explicit undefined prop",
      leaf({ a: 1 }),
      leaf({ a: 1, b: undefined }),
      "reuse",
    ],
    [
      "an absent props bag equals an undefined one",
      tile({ kind: "text", text: "same" }),
      tile({ kind: "text", text: "same", props: undefined }),
      "reuse",
    ],
    ["null differs from the empty string", leaf({ v: null }), leaf({ v: "" }), "rebuild"],
    ["null differs from undefined", leaf({ v: null }), leaf({ v: undefined }), "rebuild"],
    ["0 differs from false", leaf({ v: 0 }), leaf({ v: false }), "rebuild"],
    ["the empty string differs from 0", leaf({ v: "" }), leaf({ v: 0 }), "rebuild"],
    [
      "arrays with every element equal match",
      leaf({ items: ["a", "b", "c"] }),
      leaf({ items: ["a", "b", "c"] }),
      "reuse",
    ],
    [
      "arrays differing in one element differ",
      leaf({ items: ["a", "b", "c"] }),
      leaf({ items: ["a", "z", "c"] }),
      "rebuild",
    ],
    [
      "arrays of different length differ",
      leaf({ items: ["a", "b"] }),
      leaf({ items: ["a", "b", "c"] }),
      "rebuild",
    ],
    [
      "equal nested arrays match",
      leaf({ rows: [["a", "b"], ["c"]] }),
      leaf({ rows: [["a", "b"], ["c"]] }),
      "reuse",
    ],
    [
      "nested arrays differing deep down differ",
      leaf({ rows: [["a", "b"], ["c"]] }),
      leaf({ rows: [["a", "x"], ["c"]] }),
      "rebuild",
    ],
    [
      "equal objects inside arrays match",
      leaf({ rows: [{ w: 1 }, { w: 2 }] }),
      leaf({ rows: [{ w: 1 }, { w: 2 }] }),
      "reuse",
    ],
    [
      "objects inside arrays differing differ",
      leaf({ rows: [{ w: 1 }, { w: 2 }] }),
      leaf({ rows: [{ w: 1 }, { w: 3 }] }),
      "rebuild",
    ],
    ["an array differs from a plain object", leaf({ v: [] }), leaf({ v: {} }), "rebuild"],
    [
      "a deep property difference in a bag differs",
      leaf({ cfg: { size: { w: 1, h: 2 } } }),
      leaf({ cfg: { size: { w: 1, h: 3 } } }),
      "rebuild",
    ],
    [
      "an extra defined key differs",
      leaf({ cfg: { a: 1 } }),
      leaf({ cfg: { a: 1, b: 2 } }),
      "rebuild",
    ],
    [
      "deeply nested identical bags match",
      leaf({ cfg: { size: { w: 1, h: 2 }, tags: ["x"] } }),
      leaf({ cfg: { size: { w: 1, h: 2 }, tags: ["x"] } }),
      "reuse",
    ],
    [
      "the same handler reference matches",
      leaf({ onClick: handler }),
      leaf({ onClick: handler }),
      "reuse",
    ],
    ["a handler that appears differs", leaf({ onClick: () => undefined }), leaf({}), "rebuild"],
    [
      "a handler replaced by a non-function differs",
      leaf({ onClick: () => undefined }),
      leaf({ onClick: "noop" }),
      "rebuild",
    ],
    [
      "key is not compared: identity is the child-list matcher's job",
      tile({ kind: "text", text: "same", key: "a" }),
      tile({ kind: "text", text: "same", key: "b" }),
      "reuse",
    ],
    [
      "two different Date instances differ",
      leaf({ at: new Date(1) }),
      leaf({ at: new Date(2) }),
      "rebuild",
    ],
    ["the very same instance matches", leaf({ at: date }), leaf({ at: date }), "reuse"],
    [
      "an exotic value buried inside a plain bag is reached",
      leaf({ cfg: { label: "due", at: new Date(1) } }),
      leaf({ cfg: { label: "due", at: new Date(2) } }),
      "rebuild",
    ],
    [
      "two different Map instances differ",
      leaf({ index: new Map([["a", 1]]) }),
      leaf({ index: new Map([["b", 2]]) }),
      "rebuild",
    ],
    [
      "a class instance differs from a plain bag with its keys",
      leaf({ at: new Point(1, 2) }),
      leaf({ at: { x: 1, y: 2 } }),
      "rebuild",
    ],
    [
      "null-prototype bags with the same contents match",
      leaf({ cfg: nullBag(1) }),
      leaf({ cfg: nullBag(1) }),
      "reuse",
    ],
    [
      "null-prototype bags with different contents differ",
      leaf({ cfg: nullBag(1) }),
      leaf({ cfg: nullBag(2) }),
      "rebuild",
    ],
  ])("%s", (_label, a, b, verdict) => {
    expectVerdict(a, b, verdict);
    expectVerdict(b, a, verdict);
  });

  it.each<[string, TileNode, TileNode]>([
    ["NaN against NaN", leaf({ v: Number.NaN }), leaf({ v: Number.NaN })],
    [
      "two different closures",
      leaf({ onClick: () => undefined }),
      leaf({ onClick: () => undefined }),
    ],
  ])("rebuilds for %s, which never compare equal", (_label, a, b) => {
    expectVerdict(a, b, "rebuild");
  });

  it("ignores children, which the walker reconciles separately", () => {
    const column = (childText: string): TileNode =>
      tile({
        kind: "column",
        props: { gap: 2 },
        children: [tile({ kind: "text", text: childText })],
      });
    const d = decide(column("a"), column("b"));

    expect(d.verdict).toBe("reuse");
    expect(d.fallbacks).toEqual([
      expect.objectContaining({ reason: "no-patcher", tileKind: "text" }),
    ]);
    expect(d.after.firstElementChild).not.toBe(d.childrenBefore[0]);
  });

  it("short-circuits on a kind change before comparing fields", () => {
    const d = decide(tile({ kind: "text", text: "same" }), tile({ kind: "heading", text: "same" }));

    expect(d.verdict).toBe("rebuild");
    expect(d.reasons).toEqual([]);
  });

  it("contains a cyclic prop as a recorded panic rather than taking the app down", () => {
    const errors = captureConsole();
    const cyclic = (): Record<string, unknown> => {
      const bag: Record<string, unknown> = {};
      bag.self = bag;
      return bag;
    };
    const d = decide(leaf({ cfg: cyclic() }), leaf({ cfg: cyclic() }));

    // A panic, not a fallback decision: the tree is rebuilt from scratch rather than diffed.
    expect(d.verdict).toBe("rebuild");
    expect(d.reasons).toEqual([]);
    expect(errors).toContainEqual(expect.stringContaining("error in reconcile"));
    expect(d.after.dataset.kind).toBe("text");
  });
});
