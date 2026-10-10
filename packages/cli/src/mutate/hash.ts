import { createHash } from "node:crypto";
import { lex, type Pos } from "@kumikijs/compiler";
import { type DefEntry, directDeps, referenceSites, type Store } from "../store.ts";
import { defNamePos } from "./definition-text.ts";

function hashBody(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

export function viewHash(store: Store, qname: string): string {
  return computeHash(store, qname, new Map());
}

export function computeHash(store: Store, qname: string, memo: Map<string, string>): string {
  const cached = memo.get(qname);
  if (cached !== undefined) return cached;
  const entry = store.byQName.get(qname);
  if (!entry) {
    const h = hashBody(qname);
    memo.set(qname, h);
    return h;
  }
  const cycle = cycles(store).get(qname);
  if (cycle !== undefined) {
    hashCycle(store, cycle, memo);
    return memo.get(qname)!;
  }
  const canonical = canonicalForm(store, entry, (target, layer) =>
    hashLabel(store, target, layer, memo),
  );
  // Ordered by hash, not by name, so that a rename of a dep cannot reorder them.
  const depPart = directDeps(store, qname)
    .map((d) => computeHash(store, d, memo))
    .sort()
    .join(":");
  const h = hashBody(`${canonical}|${depPart}`);
  memo.set(qname, h);
  return h;
}

function hashLabel(store: Store, target: string, layer: string, memo: Map<string, string>): string {
  return `@${layer}:${computeHash(store, target, memo)}`;
}

function hashCycle(store: Store, members: readonly string[], memo: Map<string, string>): void {
  const inCycle = new Set(members);
  const read = (within: (target: string, layer: string) => string): Map<string, string> =>
    new Map(
      members.map((m) => [
        m,
        canonicalForm(store, store.byQName.get(m)!, (target, layer) =>
          inCycle.has(target) ? within(target, layer) : hashLabel(store, target, layer, memo),
        ),
      ]),
    );
  const first = read((_target, layer) => `@cycle:${layer}`);
  const second = read((target, layer) => `@cycle:${layer}:${hashBody(first.get(target)!)}`);
  const unit = hashBody(JSON.stringify([...second.values()].sort()));
  for (const m of members) {
    const depPart = [
      unit,
      ...directDeps(store, m)
        .filter((d) => !inCycle.has(d))
        .map((d) => computeHash(store, d, memo)),
    ]
      .sort()
      .join(":");
    memo.set(m, hashBody(`${second.get(m)}|${depPart}`));
  }
}

const cyclesByStore = new WeakMap<Store, Map<string, readonly string[]>>();

/** Strongly connected components of the dependency graph, keyed by each member. */
function cycles(store: Store): Map<string, readonly string[]> {
  const known = cyclesByStore.get(store);
  if (known !== undefined) return known;
  const out = new Map<string, readonly string[]>();
  const order = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const visit = (q: string): void => {
    const at = order.size;
    order.set(q, at);
    low.set(q, at);
    stack.push(q);
    onStack.add(q);
    for (const d of directDeps(store, q)) {
      if (!order.has(d)) {
        visit(d);
        low.set(q, Math.min(low.get(q)!, low.get(d)!));
      } else if (onStack.has(d)) {
        low.set(q, Math.min(low.get(q)!, order.get(d)!));
      }
    }
    if (low.get(q) !== at) return;
    const members: string[] = [];
    let m: string;
    do {
      m = stack.pop()!;
      onStack.delete(m);
      members.push(m);
    } while (m !== q);
    if (members.length > 1) for (const member of members) out.set(member, members);
  };
  for (const e of store.defs) {
    const q = `${e.layer}.${e.name}`;
    if (!order.has(q)) visit(q);
  }
  cyclesByStore.set(store, out);
  return out;
}

function canonicalForm(
  store: Store,
  entry: DefEntry,
  label: (target: string, layer: string) => string,
): string {
  const qname = `${entry.layer}.${entry.name}`;
  const key = (p: Pos): string => `${p.line}:${p.col}`;
  const labels = new Map<string, string>();
  const own = defNamePos(store, entry, entry.name);
  if (own !== undefined) labels.set(key(own), "@self");
  for (const r of referenceSites(store, qname)) {
    if (!r.pos) continue;
    const target = `${r.layer}.${r.name}`;
    labels.set(key(r.pos), target === qname ? "@self" : label(target, r.layer));
  }
  // Lexed on its own, so a token's line is counted from the definition's first.
  const offset = entry.range.startLine - 1;
  const text = store.lines.slice(offset, entry.range.endLine).join("\n");
  const out: unknown[] = [];
  for (const t of lex(text)) {
    if (t.kind === "eof") continue;
    const at = labels.get(key({ line: t.pos.line + offset, col: t.pos.col }));
    out.push(at ?? [t.kind, t.kind === "num" ? t.raw : t.value]);
  }
  return JSON.stringify(out);
}
