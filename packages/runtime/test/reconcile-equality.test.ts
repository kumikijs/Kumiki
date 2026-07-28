// The reconcile prop-equality kernel, pinned at the edges.
//
// `tileFieldsEqual` / `tileValueEqual` decide the single question the whole
// reconcile pass hangs on: "can this mounted tile be reused?". A false positive
// keeps a stale element on screen (silent DOM corruption); a false negative
// rebuilds a subtree that did not change, throwing away focus / caret /
// `<select>` open state and the benchmark win the keyed diff exists for.
//
// `reconcile.test.ts` covers the everyday shapes through a real app. This file
// covers the kernel's edges — absent vs. explicit `undefined`, cross-type
// falsy pairs, arrays, nested bags, function values, the skipped top-level
// fields, and non-plain objects — so the decisions are frozen rather than
// implied.
//
// The predicate is module-local by design. Rather than widen the public
// surface, every case runs through the real code path: `mountCore` with spy
// renderers and an EMPTY patcher registry. With no patcher registered, the
// walker's two same-kind outcomes are exactly the predicate's two answers —
// equal means the element survives untouched, unequal means the subtree is
// rebuilt — so DOM identity across `_rerender()` reads the verdict directly.

import type {
  AppShape,
  RuntimeDiagnostic,
  TileCtx,
  TileNode,
  TileRenderers,
} from "@kumikijs/runtime";
import { mountCore } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Builds a `TileNode` from a raw bag.
 *
 * Every case below is deliberately a shape Kumiki codegen would never emit —
 * an explicitly-`undefined` optional, a `NaN`, a `Date` — and `TileNode` is a
 * closed union that cannot spell them. Those are precisely the inputs whose
 * handling this file exists to pin, so the conversion is funnelled through
 * this one helper instead of being scattered as casts at each call site.
 */
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

/**
 * Spy renderer standing in for every kind under test. It renders children
 * through `ctx.render` exactly like the built-ins do — a renderer that builds
 * children itself leaves them out of the node→element map, and the walker then
 * rebuilds the parent for `child-unmapped` reasons that have nothing to do with
 * the predicate we are reading.
 */
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
  // Every kind the cases use. `mountCore` renders only what is registered here,
  // so this map is the full tile vocabulary of this file.
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

  // Every diagnostic this harness can provoke is a reconcile fallback: no
  // `hostTileKinds` are declared, so the stale-closure scan never runs. A new
  // kind arriving here means the walker started reporting something these
  // cases do not account for — look at it rather than filter it away.
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

/**
 * Asserts the walker's verdict on two same-kind root tiles, and cross-checks it
 * against the diagnostic channel: a same-kind rebuild with no patcher registered
 * always reports `no-patcher`, a reuse never does. If those two signals ever
 * disagree the harness is lying, not the kernel.
 */
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
      // Codegen omits optional fields rather than emitting `x: undefined`, but a
      // host tree (or a `?.` that resolved to nothing) can produce either form
      // for the same authored tile. Rebuilding on that difference would blow
      // away a focused `<input>` for a change the user cannot see.
      expectSymmetric(
        tile({ kind: "input", value: "a" }),
        tile({ kind: "input", value: "a", placeholder: undefined }),
        "reuse",
      );
    });

    it("treats a missing prop and an explicit undefined prop as the same tile", () => {
      // Same decision one level down, where `props` spreads make the two forms
      // trivially interchangeable (`{...base, extra}` with `extra` undefined).
      expectSymmetric(leaf({ a: 1 }), leaf({ a: 1, b: undefined }), "reuse");
    });

    it("treats an absent props bag and an undefined props bag as the same tile", () => {
      // A tile with no styling renders identically whether the compiler emitted
      // no `props` at all or an empty-valued one.
      expectSymmetric(
        tile({ kind: "text", text: "same" }),
        tile({ kind: "text", text: "same", props: undefined }),
        "reuse",
      );
    });
  });

  describe("cross-type and falsy values", () => {
    it("rebuilds for null vs. empty string", () => {
      // `null` and `""` reach the DOM differently — an absent attribute vs. an
      // empty one — so reusing across them would leave the old attribute set.
      expectSymmetric(leaf({ v: null }), leaf({ v: "" }), "rebuild");
    });

    it("rebuilds for null vs. undefined", () => {
      // "explicitly cleared" and "never set" are the same pixels for most
      // renderers, but not all (`alt=""` vs. no `alt`), so the kernel does not
      // collapse them — unlike absent-vs-undefined above, which are the same
      // *value*, not two different ones.
      expectSymmetric(leaf({ v: null }), leaf({ v: undefined }), "rebuild");
    });

    it("rebuilds for 0 vs. false", () => {
      // A `disabled`/`count` style prop flipping between the two renders
      // differently; `==` would call them equal, the kernel uses `===`.
      expectSymmetric(leaf({ v: 0 }), leaf({ v: false }), "rebuild");
    });

    it("rebuilds for empty string vs. 0", () => {
      // The other `==` trap: an empty text field and a zero-valued numeric one
      // are different rendered output.
      expectSymmetric(leaf({ v: "" }), leaf({ v: 0 }), "rebuild");
    });

    it("rebuilds for NaN vs. NaN", () => {
      // Decision, not an accident: the kernel compares with `===`, so `NaN`
      // never equals itself and a tile carrying one rebuilds every render.
      // `NaN` in a prop means a computation already failed (a parse, a divide
      // by zero); rebuilding is the safe side of that, and the churn is a
      // visible symptom rather than a silently frozen tile. `Object.is` would
      // reuse instead — deliberately not chosen.
      expectSameKind(leaf({ v: Number.NaN }), leaf({ v: Number.NaN }), "rebuild");
    });
  });

  describe("arrays", () => {
    it("reuses when every element matches", () => {
      // The common case: a `list` tile handed the same items twice because an
      // unrelated slot changed. Nothing about this tile changed, so it must not
      // churn.
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
      // The shape every `for` over records produces: an array of item bags. The
      // element comparison has to descend into them, not stop at "both are
      // objects".
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
      // An empty array and an empty bag both have no keys to compare; without
      // the array-shape check they would collapse into each other.
      expectSymmetric(leaf({ v: [] }), leaf({ v: {} }), "rebuild");
    });
  });

  describe("nested plain objects", () => {
    it("rebuilds on a deep property difference", () => {
      // `props.el` / a nested config bag: a change buried two levels down still
      // reaches the DOM.
      expectSymmetric(
        leaf({ cfg: { size: { w: 1, h: 2 } } }),
        leaf({ cfg: { size: { w: 1, h: 3 } } }),
        "rebuild",
      );
    });

    it("rebuilds when one side carries an extra defined key", () => {
      // Conditional spread (`{...base, ...(flag && {badge: 1})}`): the key
      // appears on one side only and must not be skipped by iterating just the
      // other side's keys.
      expectSymmetric(leaf({ cfg: { a: 1 } }), leaf({ cfg: { a: 1, b: 2 } }), "rebuild");
    });

    it("reuses a deeply nested identical bag", () => {
      // Structurally-equal-but-not-identical bags are what a re-render produces
      // for unchanged data; treating them as different would defeat reuse for
      // every tile with a nested prop.
      expectSameKind(
        leaf({ cfg: { size: { w: 1, h: 2 }, tags: ["x"] } }),
        leaf({ cfg: { size: { w: 1, h: 2 }, tags: ["x"] } }),
        "reuse",
      );
    });
  });

  describe("function-valued fields", () => {
    it("reuses across two different closures", () => {
      // Codegen mints a fresh `onClick` on every render. Comparing closure
      // identity would rebuild every interactive tile on every render — the
      // whole point of the diff, lost. Safe because built-in renderers dispatch
      // through per-element handler slots rather than the create-time closure.
      expectSameKind(
        leaf({ onClick: () => undefined }),
        leaf({ onClick: () => undefined }),
        "reuse",
      );
    });

    it("rebuilds when a handler appears or disappears", () => {
      // A tile that gains or loses its handler really is a different tile — a
      // `when`-gated `onClick` going away has to detach the behaviour.
      expectSymmetric(leaf({ onClick: () => undefined }), leaf({}), "rebuild");
    });

    it("rebuilds when a handler is replaced by a non-function", () => {
      // The always-equal shortcut applies only when BOTH sides are functions;
      // a handler swapped for data is a real change.
      expectSymmetric(leaf({ onClick: () => undefined }), leaf({ onClick: "noop" }), "rebuild");
    });
  });

  describe("fields the predicate does not inspect", () => {
    it("ignores children — the walker reconciles them separately", () => {
      // A column whose own props are unchanged but whose child text changed must
      // keep its own element (and therefore its scroll position) while only the
      // changed child is rebuilt. If `children` fed the predicate, every
      // ancestor of any change would rebuild, which is the whole-tree replace
      // the keyed diff exists to retire.
      const column = (childText: string): TileNode =>
        tile({
          kind: "column",
          props: { gap: 2 },
          children: [tile({ kind: "text", text: childText })],
        });
      const d = decide(column("a"), column("b"));

      expect(d.verdict).toBe("reuse");
      // Exactly one tile rebuilt, and it is the child — the parent never even
      // reached the no-patcher branch.
      expect(d.fallbacks).toEqual([
        expect.objectContaining({ reason: "no-patcher", tileKind: "text" }),
      ]);
      expect(d.after.firstElementChild).not.toBe(d.childrenBefore[0]);
    });

    it("ignores key — identity is the child-list matcher's job", () => {
      // `key` says "which instance is this" for sibling matching. By the time a
      // node pair reaches the predicate the matcher has already decided they are
      // the same instance, so a differing key must not force a data rebuild.
      expectSameKind(
        tile({ kind: "text", text: "same", key: "a" }),
        tile({ kind: "text", text: "same", key: "b" }),
        "reuse",
      );
    });

    it("short-circuits on a kind change before the predicate runs", () => {
      // A different kind means a different thing occupies the slot; there is no
      // identity to preserve, so the walker rebuilds without consulting the
      // predicate — and deliberately reports nothing (spec §10.3.12).
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
      // A `Date` keeps its value outside its own enumerable keys, so key-wise
      // comparison sees two empty bags and would call a rescheduled appointment
      // equal to the old one — leaving the stale timestamp on screen.
      expectSymmetric(leaf({ at: new Date(1) }), leaf({ at: new Date(2) }), "rebuild");
    });

    it("reuses when the very same instance is passed twice", () => {
      // Identity short-circuit still applies: an unchanged reference is
      // unchanged data, so a tile holding one must not churn every render.
      const at = new Date(1);
      expectSameKind(leaf({ at }), leaf({ at }), "reuse");
    });

    it("reaches an exotic value buried inside a plain bag", () => {
      // The guard sits on the recursive step, not only on the top-level prop —
      // a timestamp nested in a config bag is the realistic way one arrives.
      expectSymmetric(
        leaf({ cfg: { label: "due", at: new Date(1) } }),
        leaf({ cfg: { label: "due", at: new Date(2) } }),
        "rebuild",
      );
    });

    it("rebuilds for two different Map instances", () => {
      // Same failure mode as `Date`, and the one a host renderer is most likely
      // to hit when it hands its tile a lookup table.
      expectSymmetric(
        leaf({ index: new Map([["a", 1]]) }),
        leaf({ index: new Map([["b", 2]]) }),
        "rebuild",
      );
    });

    it("rebuilds for a class instance vs. a plain bag with the same keys", () => {
      // Two values that compare equal key-wise but behave differently (methods
      // live on the prototype) are not interchangeable in a renderer.
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
      // `Object.create(null)` is still a plain data bag — all of its state IS
      // its own keys — so the guard must not sweep it up with the exotics.
      const bag = (v: number): Record<string, unknown> =>
        Object.assign(Object.create(null) as Record<string, unknown>, { v });
      expectSameKind(leaf({ cfg: bag(1) }), leaf({ cfg: bag(1) }), "reuse");
      expectSymmetric(leaf({ cfg: bag(1) }), leaf({ cfg: bag(2) }), "rebuild");
    });
  });

  describe("shapes the kernel does not support", () => {
    it("contains a cyclic prop as a recorded panic rather than taking the app down", () => {
      // The comparison recurses without a visited set, so two structurally
      // cyclic but distinct bags recurse until the stack runs out. That is a
      // deliberate non-goal — a cycle cannot come out of codegen, and a visited
      // set would cost every render to defend against it — but "unsupported"
      // still has to mean *contained*: the throw lands in the reconcile bailout,
      // which rebuilds the tree wholesale and records the failure, rather than
      // escaping into the host. This pins the containment, not the recursion.
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
