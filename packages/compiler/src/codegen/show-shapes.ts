import type { ShowShape } from "../ast.ts";

type Part = Exclude<ShowShape, 0>;

/** A part's slots: a tuple's tag and key kind are strings, the rest are shapes. */
type Slot = ShowShape | string;

/** The shapes an app shows values with, each declared once in `decls` and named at every site. */
export type ShowShapes = {
  readonly decls: string[];
  nameOf(shape: Part): string;
};

export function showShapes(): ShowShapes {
  const decls: string[] = [];
  const declared = new Map<string, string>();
  let next = 0;
  return {
    decls,
    nameOf: (shape) => {
      const cyclic = cyclicParts(shape);
      // Written with local names first: the same type writes the same text, whatever its names.
      const local = declarations(
        shape,
        cyclic,
        cyclic.map((_, i) => `$${i}`),
        () => "$",
      );
      const known = declared.get(local.text);
      if (known !== undefined) return known;
      const own = declarations(
        shape,
        cyclic,
        cyclic.map(() => `_show${next++}`),
        () => `_show${next++}`,
      );
      decls.push(own.text);
      declared.set(local.text, own.root);
      return own.root;
    },
  };
}

/** The parts a walk from `shape` reaches again while inside them, in the order it reaches them. */
function cyclicParts(shape: Part): Part[] {
  const cyclic = new Set<Part>();
  const onPath = new Set<Part>();
  const done = new Set<Part>();
  const walk = (s: Slot): void => {
    if (typeof s !== "object") return;
    if (onPath.has(s)) cyclic.add(s);
    if (onPath.has(s) || done.has(s)) return;
    onPath.add(s);
    for (const slot of Object.values<Slot>(s)) walk(slot);
    onPath.delete(s);
    done.add(s);
  };
  walk(shape);
  return [...cyclic];
}

// A part on a cycle is declared empty and filled in after, so a reference back to it names the
// declaration.
function declarations(
  shape: Part,
  cyclic: readonly Part[],
  names: readonly string[],
  rootName: () => string,
): { text: string; root: string } {
  const named = new Map(cyclic.map((s, i) => [s, names[i]]));
  const literal = (s: Slot, own = false): string => {
    if (typeof s !== "object") return JSON.stringify(s);
    const name = named.get(s);
    if (name !== undefined && !own) return name;
    if (Array.isArray(s)) return `[${s.map((slot: Slot) => literal(slot)).join(",")}]`;
    const fields = Object.entries(s).map(([k, slot]) => `${JSON.stringify(k)}:${literal(slot)}`);
    return `{${fields.join(",")}}`;
  };
  const lines = cyclic.map((s, i) => `const ${names[i]} = ${Array.isArray(s) ? "[]" : "{}"};`);
  lines.push(...cyclic.map((s, i) => `Object.assign(${names[i]}, ${literal(s, true)});`));
  const root = named.get(shape);
  if (root !== undefined) return { text: lines.join(" "), root };
  const name = rootName();
  lines.push(`const ${name} = ${literal(shape)};`);
  return { text: lines.join(" "), root: name };
}
