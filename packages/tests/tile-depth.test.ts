// The deepest tile tree the inlining limit admits is one the engine loads and
// the runtime mounts; one level past it is refused before any module exists
// (language.md §1.2.3, E0237).
//
// Code generation inlines every call to a user tile, so a chain of tiles each
// calling the next nests the emitted module once per link. Whether the module
// for the deepest admitted chain loads is runtime truth, so this goes through
// the real pipeline: the runtime inlined, the module imported — which parses
// all of it, as `node --check` does — and mounted, down to the leaf.

import { compile } from "@kumikijs/compiler";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

/** The bound recorded in language.md §1.2.3. */
const LIMIT = 256;

const LEAF = 'text(test-id="leaf", "leaf")';

type Chain = {
  readonly what: string;
  /** How many links reach the limit exactly. */
  readonly links: number;
  /** Link `i` of the chain, calling link `i + 1` unless it is the last. */
  readonly link: (i: number, last: boolean) => string;
  /** How many elements the leaf renders under: one for each link that renders one. */
  readonly elements: number;
};

const CHAINS: readonly Chain[] = [
  {
    // Two levels a link: the column, and the call in it.
    what: "a column around a call",
    links: LIMIT / 2,
    link: (i, last) => `tile T${i} = column(${last ? LEAF : `T${i + 1}`})`,
    elements: LIMIT / 2,
  },
  {
    // One level a link, and the most code generation emits for one: a call
    // that passes an argument lowers to a function of its own, and its key to
    // a wrapper around that. No link renders an element of its own.
    what: "a keyed call passing an argument",
    links: LIMIT,
    link: (i, last) =>
      `tile T${i}${i === 0 ? "" : " in=Int"} = ${last ? LEAF : `T${i + 1}(${i}) {key: "k"}`}`,
    elements: 0,
  },
];

const source = ({ link }: Chain, n: number): string =>
  `${Array.from({ length: n }, (_, i) => link(i, i === n - 1)).join("\n")}
app M caps=[] routes={"/" -> T0, "/404" -> T0} init=[]
`;

describe("a chain of tiles at the inlining limit", () => {
  let dispose: (() => void) | undefined;
  let root: HTMLElement | undefined;
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    root?.remove();
    root = undefined;
  });

  for (const chain of CHAINS) {
    it(`loads and mounts the longest chain of ${chain.what} the limit admits`, async () => {
      const app = await loadSource(source(chain, chain.links));
      root = document.createElement("div");
      document.body.appendChild(root);
      ({ dispose } = mount(app, root, { router: "memory" }));

      const leaf = root.querySelector('[data-kumiki-test="leaf"]');
      expect(leaf?.textContent).toBe("leaf");
      let elements = 0;
      for (let el = leaf?.parentElement; el && el !== root; el = el.parentElement) elements += 1;
      expect(elements).toBe(chain.elements);
    });

    it(`refuses the chain of ${chain.what} one link longer`, () => {
      const result = compile(source(chain, chain.links + 1), {
        runtimeSpecifier: "@kumikijs/runtime",
        capabilities: [],
      });
      expect(result.kind).toBe("fail");
      if (result.kind !== "fail") return;
      expect(result.errors.map((e) => e.code)).toEqual(["E0237"]);
    });
  }
});
