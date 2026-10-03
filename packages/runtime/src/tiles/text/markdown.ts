// The `markdown` tile (#71): its own shipping unit, so an app that renders one
// does not download the six other text tiles.

import type { TilePatcher, TileRenderer } from "../../core.ts";

export const markdownTile: TileRenderer<"markdown"> = (node) => {
  const div = document.createElement("div");
  div.dataset.kumikiTile = "markdown";
  // Minimal markdown: paragraphs split on blank lines, single line breaks preserved.
  const text = node.text ?? "";
  const paragraphs = text.split(/\n\s*\n/);
  for (const para of paragraphs) {
    const p = document.createElement("p");
    p.textContent = para.trim();
    p.style.whiteSpace = "pre-wrap";
    div.appendChild(p);
  }
  return div;
};

export const markdownPatcher: TilePatcher<"markdown"> = (el, _oldNode, newNode) => {
  const div = el as HTMLDivElement;
  // Markdown renders paragraph-per-blank-line; on any text change reflow
  // the paragraph list. This is a mount-only content tile so keeping the
  // outer wrapper preserves any scroll position of an enclosing container.
  const text = newNode.text ?? "";
  const paragraphs = text.split(/\n\s*\n/);
  const existing = div.querySelectorAll("p");
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i]?.trim() ?? "";
    const cur = existing[i];
    if (cur) {
      if (cur.textContent !== para) cur.textContent = para;
    } else {
      const p = document.createElement("p");
      p.textContent = para;
      p.style.whiteSpace = "pre-wrap";
      div.appendChild(p);
    }
  }
  // Drop trailing extras when the paragraph count shrunk.
  for (let i = existing.length - 1; i >= paragraphs.length; i--) {
    const p = existing[i];
    if (p) div.removeChild(p);
  }
};
