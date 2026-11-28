// Whether the module for the deepest chain the inlining limit admits loads is runtime truth, so
// this goes through the real pipeline: the module imported, which parses all of it, and mounted.

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "@kumikijs/compiler";
import { afterEach, describe, expect, it } from "vitest";
import { mountApp } from "./helpers/dom.ts";
import { loadSource, TMP_ROOT } from "./helpers/load.ts";
import { WINDOWS_LIKE_STACK_KB } from "./helpers/stack.ts";

const LEAF = 'text(test-id="leaf", "leaf")';

type Chain = {
  readonly what: string;
  /** The most links the limit admits. */
  readonly links: number;
  /** Link `i` of the chain, calling link `i + 1` unless it is the last. */
  readonly link: (i: number, last: boolean) => string;
  /** Definitions the links name besides each other. */
  readonly head?: string;
  /**
   * How many elements the leaf renders under: one for each link that renders one. Absent for the
   * chains of `for`s, which the runtime does not mount at this depth: a route renders nothing for a
   * tile whose root is a `for`, and each keyed `for` re-encodes the keys of the ones inside it.
   */
  readonly elements?: number;
};

// Each link is counted as E0237 counts it; the leaf's text is three levels, its call and its
// strings, under whatever the last link wraps it in.
const CHAINS: readonly Chain[] = [
  {
    // Two levels a link, the column and the call: 2 × 126, and 4 for the last column and its text.
    what: "a column around a call",
    links: 127,
    link: (i, last) => `tile T${i} = column(${last ? LEAF : `T${i + 1}`})`,
    elements: 127,
  },
  {
    // Three levels a link: the call, the function its argument is bound in, and its key's wrapper.
    what: "a keyed call passing an argument",
    links: 85,
    link: (i, last) =>
      `tile T${i}${i === 0 ? "" : " in=Int"} = ${last ? LEAF : `T${i + 1}(${i}) {key: "k"}`}`,
    elements: 0,
  },
  {
    // Four levels a link: the for, and a call it keys that passes an argument.
    what: "a call a for renders, passing an argument",
    links: 64,
    link: (i, last) =>
      `tile T${i}${i === 0 ? "" : " in=Int"} = ${last ? LEAF : `for x in [1] T${i + 1}(x)`}`,
  },
  {
    // Four levels a link: the boundary around the tile's body, and a keyed call in it passing an
    // argument. The last is its boundary and its text's three.
    what: "a keyed call passing an argument in a tile with an error-boundary",
    links: 64,
    link: (i, last) =>
      `tile T${i}${i === 0 ? "" : " in=Int"} error-boundary=F = ${last ? LEAF : `T${i + 1}(${i}) {key: "k"}`}`,
    head: 'tile F in=PanicInfo = text("fallback")\n',
    elements: 0,
  },
  {
    // Three levels a link: the for, the column it keys, and the call. Of these chains, this one
    // emits the most JavaScript for each level.
    what: "a column a for renders, around a call",
    links: 85,
    link: (i, last) => `tile T${i} = ${last ? LEAF : `for x in [1] column(T${i + 1})`}`,
  },
];

const source = ({ link, head = "" }: Chain, n: number): string =>
  `${head}${Array.from({ length: n }, (_, i) => link(i, i === n - 1)).join("\n")}
app M caps=[] routes={"/" -> T0, "/404" -> T0} init=[]
`;

const compiled = (src: string) =>
  compile(src, { runtimeSpecifier: "@kumikijs/runtime", capabilities: [] });

describe("a chain of tiles at the inlining limit", () => {
  let mounted: ReturnType<typeof mountApp> | undefined;
  afterEach(() => {
    mounted?.handle.dispose();
    mounted?.root.remove();
    mounted = undefined;
  });

  const MOUNTED = CHAINS.filter((c) => c.elements !== undefined);
  it.each(
    MOUNTED,
  )("loads and mounts the longest chain of $what the limit admits", async (chain) => {
    mounted = mountApp(await loadSource(source(chain, chain.links)), { router: "memory" });
    const { root } = mounted;

    const leaf = root.querySelector('[data-kumiki-test="leaf"]');
    expect(leaf?.textContent).toBe("leaf");
    let elements = 0;
    for (let el = leaf?.parentElement; el && el !== root; el = el.parentElement) elements += 1;
    expect(elements).toBe(chain.elements);
  });

  // With the same Node, V8 on win32 parsed chains like these 77% to 89% as deep as it does on
  // Linux: a `for` passing an argument ran out at about 119 links there against 154 here.
  it.each(
    CHAINS,
  )("parses the longest chain of $what the limit admits on a stack no larger than Windows'", (chain) => {
    const result = compiled(source(chain, chain.links));
    if (result.kind !== "ok") expect.fail(result.errors.map((e) => e.message).join("\n"));
    const file = join(mkdtempSync(join(TMP_ROOT, "tile-depth-")), "app.mjs");
    writeFileSync(file, result.js);
    const run = spawnSync(
      process.execPath,
      [`--stack-size=${WINDOWS_LIKE_STACK_KB}`, "--check", file],
      { encoding: "utf8" },
    );
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  it.each(CHAINS)("refuses the chain of $what one link longer", (chain) => {
    const result = compiled(source(chain, chain.links + 1));
    expect(result.kind).toBe("fail");
    if (result.kind !== "fail") return;
    expect(result.errors.map((e) => e.code)).toEqual(["E0237"]);
  });
});
