import type { AppShape, Episode, EpisodeLogger, TileNode } from "@kumikijs/runtime";
import { createEpisodeLogger } from "@kumikijs/runtime";
import { bareApp } from "./app.ts";
import { defined } from "./defined.ts";

export const childAt = (parent: Element, i: number): Element =>
  defined(parent.children[i], `child ${i} of <${parent.tagName.toLowerCase()}>`);

export const childList = (parent: Element): HTMLElement[] =>
  Array.from(parent.children) as HTMLElement[];

/** The positioned wrappers an `overlay` puts its non-base children in. */
export const overlayLayers = (overlay: Element): HTMLElement[] =>
  childList(overlay).filter((c) => c.dataset.kumikiTile === "overlay-layer");

/** A `kind` parent whose children are one keyed text row per id `order()` returns. */
export function keyedRowsApp(order: () => string[], kind: TileNode["kind"] = "column"): AppShape {
  return bareApp({
    root: () =>
      ({
        kind,
        summary: "disclosure",
        children: order().map((id) => ({ kind: "text", text: `row ${id}`, key: id })),
      }) as TileNode,
  });
}

/**
 * A heading showing the `count` slot over `rows` static text rows (and an optional bound
 * input); the `bump` reducer increments `count`.
 */
export function stripApp(rows: number, withInput = false): AppShape {
  const app = bareApp({
    slots: { count: { value: 0 } },
    reducers: [
      {
        name: "bump",
        selector: { tile: "Bump" },
        event: { kind: "ui", ev: "click" },
        apply: (s) => ({ slots: { count: (s.count as number) + 1 }, emits: [] }),
      },
    ],
    root: (): TileNode => {
      const children: TileNode[] = [{ kind: "heading", text: `Count: ${app.live?.count ?? 0}` }];
      for (let i = 0; i < rows; i++) children.push({ kind: "text", text: `row ${i}` });
      if (withInput) children.push({ kind: "input", bind: "note", value: "hello" });
      return { kind: "column", children };
    },
  });
  return app;
}

export function recordingLogger(): { logger: EpisodeLogger; committed: Episode[] } {
  const committed: Episode[] = [];
  let t = 1000;
  let seq = 0;
  const logger = createEpisodeLogger({
    now: () => ++t,
    idGen: () => `ep_${(seq++).toString().padStart(4, "0")}`,
    onEpisode: (ep) => committed.push(ep),
  });
  return { logger, committed };
}
