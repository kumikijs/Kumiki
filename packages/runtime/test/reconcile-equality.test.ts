import type {
  AppShape,
  RuntimeDiagnostic,
  TileCtx,
  TileNode,
  TileRenderers,
} from "@kumikijs/runtime";
import { mountCore } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function tile(raw: Record<string, unknown>): TileNode {
  return raw as unknown as TileNode;
}

/** A leaf tile carrying `props` — the everyday "data props" carrier. */
function leaf(props: Record<string, unknown>): TileNode {
  return tile({ kind: "text", text: "same", props });
}

/** A bare app whose root tile is produced by `root` on every render pass. */
function appOf(root: () => TileNode): AppShape {
  return { slots: {}, caps: [], effects: {}, init: [], reducers: [], root };
}

function probeRenderers(): TileRenderers {
  const render = (node: TileNode, ctx: TileCtx): HTMLElement => {
    const el = document.createElement("div");
    el.dataset.kind = node.kind;
    const children = (node as { children?: TileNode[] }).children;
    if (Array.isArray(children)) {
      for (const child of children) el.appendChild(ctx.render(child));
    }
    return el;
  };
  return { text: render, heading: render, input: render, column: render };
}

type Decision = {
  /** Did the mounted element survive the re-render? */
  verdict: "reuse" | "rebuild";
  /** `reconcile-fallback` reasons the walker reported for this pass. */
  reasons: string[];
  /** The same fallbacks with their evidence, for naming WHICH tile rebuilt. */
  fallbacks: RuntimeDiagnostic[];
  /** The root element before and after, for child-level assertions. */
  before: HTMLElement;
  after: HTMLElement;
  /**
   * The root's child elements as they stood BEFORE the re-render. Taken as a
   * snapshot because a reused root keeps the same element instance, so reading
   * its children after the fact would only ever show the new ones.
   */
  childrenBefore: Element[];
};

let host: HTMLElement;

/** Mounts `oldNode`, re-renders as `newNode`, and reports what the walker did. */
function decide(oldNode: TileNode, newNode: TileNode): Decision {
  let current = oldNode;
  const seen: RuntimeDiagnostic[] = [];
  const app = appOf(() => current);
  const { dispose } = mountCore(app, host, {
    tiles: probeRenderers(),
    // Empty on purpose: without a patcher, "props differ" can only mean a full
    // subtree rebuild, which is what makes DOM identity a faithful readout.
    tilePatchers: {},
    onDiagnostic: (d) => seen.push(d),
  });
  const before = host.firstElementChild as HTMLElement;
  const childrenBefore = [...before.children];
  // Never `?.` here: a missing seam would silently report every case as a
  // reuse (nothing re-rendered, so nothing changed) and turn this whole file
  // green regardless of what the kernel does.
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
  const fallbacks = seen.filter((d) => d.kind === "reconcile-fallback");
  return {
    verdict: before === after ? "reuse" : "rebuild",
    reasons: fallbacks.map((d) => d.reason),
    fallbacks,
    before,
    after,
    childrenBefore,
  };
}

function expectSameKind(a: TileNode, b: TileNode, verdict: "reuse" | "rebuild"): void {
  const d = decide(a, b);
  expect(d.verdict).toBe(verdict);
  expect(d.reasons.includes("no-patcher")).toBe(verdict === "rebuild");
}

/** Both directions: equality must not depend on which side is the old render. */
function expectSymmetric(a: TileNode, b: TileNode, verdict: "reuse" | "rebuild"): void {
  expectSameKind(a, b, verdict);
  expectSameKind(b, a, verdict);
}

describe("runtime: reconcile prop-equality kernel", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });
  afterEach(() => {
    document.body.removeChild(host);
  });

  describe("absent vs. explicit undefined", () => {
    it("treats a missing top-level field and an explicit undefined as the same tile", () => {
      expectSymmetric(
        tile({ kind: "input", value: "a" }),
        tile({ kind: "input", value: "a", placeholder: undefined }),
        "reuse",
      );
    });

    it("treats a missing prop and an explicit undefined prop as the same tile", () => {
      expectSymmetric(leaf({ a: 1 }), leaf({ a: 1, b: undefined }), "reuse");
    });

    it("treats an absent props bag and an undefined props bag as the same tile", () => {
      expectSymmetric(
        tile({ kind: "text", text: "same" }),
        tile({ kind: "text", text: "same", props: undefined }),
        "reuse",
      );
    });
  });

  describe("cross-type and falsy values", () => {
    it("rebuilds for null vs. empty string", () => {
      expectSymmetric(leaf({ v: null }), leaf({ v: "" }), "rebuild");
    });

    it("rebuilds for null vs. undefined", () => {
      expectSymmetric(leaf({ v: null }), leaf({ v: undefined }), "rebuild");
    });

    it("rebuilds for 0 vs. false", () => {
      expectSymmetric(leaf({ v: 0 }), leaf({ v: false }), "rebuild");
    });

    it("rebuilds for empty string vs. 0", () => {
      expectSymmetric(leaf({ v: "" }), leaf({ v: 0 }), "rebuild");
    });

    it("rebuilds for NaN vs. NaN", () => {
      expectSameKind(leaf({ v: Number.NaN }), leaf({ v: Number.NaN }), "rebuild");
    });
  });

  describe("arrays", () => {
    it("reuses when every element matches", () => {
      expectSameKind(leaf({ items: ["a", "b", "c"] }), leaf({ items: ["a", "b", "c"] }), "reuse");
    });

    it("rebuilds when a single element differs", () => {
      // One renamed item still means the rendered list is different.
      expectSymmetric(
        leaf({ items: ["a", "b", "c"] }),
        leaf({ items: ["a", "z", "c"] }),
        "rebuild",
      );
    });

    it("rebuilds when the lengths differ", () => {
      // Append / remove: the shorter side must not compare equal by prefix.
      expectSymmetric(leaf({ items: ["a", "b"] }), leaf({ items: ["a", "b", "c"] }), "rebuild");
    });

    it("recurses into nested arrays", () => {
      // A table's rows-of-cells: the difference can be arbitrarily deep and
      // still has to be found.
      expectSameKind(
        leaf({ rows: [["a", "b"], ["c"]] }),
        leaf({ rows: [["a", "b"], ["c"]] }),
        "reuse",
      );
      expectSymmetric(
        leaf({ rows: [["a", "b"], ["c"]] }),
        leaf({ rows: [["a", "x"], ["c"]] }),
        "rebuild",
      );
    });

    it("recurses into objects held as array elements", () => {
      expectSameKind(
        leaf({ rows: [{ w: 1 }, { w: 2 }] }),
        leaf({ rows: [{ w: 1 }, { w: 2 }] }),
        "reuse",
      );
      expectSymmetric(
        leaf({ rows: [{ w: 1 }, { w: 2 }] }),
        leaf({ rows: [{ w: 1 }, { w: 3 }] }),
        "rebuild",
      );
    });

    it("rebuilds for an array vs. a plain object", () => {
      expectSymmetric(leaf({ v: [] }), leaf({ v: {} }), "rebuild");
    });
  });

  describe("nested plain objects", () => {
    it("rebuilds on a deep property difference", () => {
      expectSymmetric(
        leaf({ cfg: { size: { w: 1, h: 2 } } }),
        leaf({ cfg: { size: { w: 1, h: 3 } } }),
        "rebuild",
      );
    });

    it("rebuilds when one side carries an extra defined key", () => {
      expectSymmetric(leaf({ cfg: { a: 1 } }), leaf({ cfg: { a: 1, b: 2 } }), "rebuild");
    });

    it("reuses a deeply nested identical bag", () => {
      expectSameKind(
        leaf({ cfg: { size: { w: 1, h: 2 }, tags: ["x"] } }),
        leaf({ cfg: { size: { w: 1, h: 2 }, tags: ["x"] } }),
        "reuse",
      );
    });
  });

  describe("function-valued fields", () => {
    it("reuses when the handler is the same reference", () => {
      const onClick = () => undefined;
      expectSameKind(leaf({ onClick }), leaf({ onClick }), "reuse");
    });

    it("does not reuse across two different closures", () => {
      expectSameKind(
        leaf({ onClick: () => undefined }),
        leaf({ onClick: () => undefined }),
        "rebuild",
      );
    });

    it("rebuilds when a handler appears or disappears", () => {
      expectSymmetric(leaf({ onClick: () => undefined }), leaf({}), "rebuild");
    });

    it("rebuilds when a handler is replaced by a non-function", () => {
      expectSymmetric(leaf({ onClick: () => undefined }), leaf({ onClick: "noop" }), "rebuild");
    });
  });

  describe("fields the predicate does not inspect", () => {
    it("ignores children — the walker reconciles them separately", () => {
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

    it("ignores key — identity is the child-list matcher's job", () => {
      expectSameKind(
        tile({ kind: "text", text: "same", key: "a" }),
        tile({ kind: "text", text: "same", key: "b" }),
        "reuse",
      );
    });

    it("short-circuits on a kind change before the predicate runs", () => {
      const d = decide(
        tile({ kind: "text", text: "same" }),
        tile({ kind: "heading", text: "same" }),
      );

      expect(d.verdict).toBe("rebuild");
      expect(d.reasons).toEqual([]);
    });
  });

  describe("non-plain objects", () => {
    it("rebuilds for two different Date instances", () => {
      expectSymmetric(leaf({ at: new Date(1) }), leaf({ at: new Date(2) }), "rebuild");
    });

    it("reuses when the very same instance is passed twice", () => {
      const at = new Date(1);
      expectSameKind(leaf({ at }), leaf({ at }), "reuse");
    });

    it("reaches an exotic value buried inside a plain bag", () => {
      expectSymmetric(
        leaf({ cfg: { label: "due", at: new Date(1) } }),
        leaf({ cfg: { label: "due", at: new Date(2) } }),
        "rebuild",
      );
    });

    it("rebuilds for two different Map instances", () => {
      expectSymmetric(
        leaf({ index: new Map([["a", 1]]) }),
        leaf({ index: new Map([["b", 2]]) }),
        "rebuild",
      );
    });

    it("rebuilds for a class instance vs. a plain bag with the same keys", () => {
      class Point {
        constructor(
          readonly x: number,
          readonly y: number,
        ) {}
        get label(): string {
          return `${this.x},${this.y}`;
        }
      }
      expectSymmetric(leaf({ at: new Point(1, 2) }), leaf({ at: { x: 1, y: 2 } }), "rebuild");
    });

    it("reuses null-prototype bags with the same contents", () => {
      const bag = (v: number): Record<string, unknown> =>
        Object.assign(Object.create(null) as Record<string, unknown>, { v });
      expectSameKind(leaf({ cfg: bag(1) }), leaf({ cfg: bag(1) }), "reuse");
      expectSymmetric(leaf({ cfg: bag(1) }), leaf({ cfg: bag(2) }), "rebuild");
    });
  });

  describe("shapes the kernel does not support", () => {
    it("contains a cyclic prop as a recorded panic rather than taking the app down", () => {
      const cyclic = (): Record<string, unknown> => {
        const bag: Record<string, unknown> = {};
        bag.self = bag;
        return bag;
      };
      const errors: unknown[][] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => errors.push(args);
      let d: ReturnType<typeof decide>;
      try {
        d = decide(leaf({ cfg: cyclic() }), leaf({ cfg: cyclic() }));
      } finally {
        console.error = original;
      }

      // The bailout is not a fallback decision — it reports a panic, and the
      // tree is rebuilt from scratch rather than diffed.
      expect(d.verdict).toBe("rebuild");
      expect(d.reasons).toEqual([]);
      expect(errors.map((args) => String(args[0]))).toContainEqual(
        expect.stringContaining("error in reconcile"),
      );
      // Still rendering: the app survived the unsupported input.
      expect(d.after.dataset.kind).toBe("text");
    });
  });
});
