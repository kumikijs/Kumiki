// The `icon` tile (#71): its own shipping unit, so an app that renders one
// does not download the six other text tiles.

import type { TilePatcher, TileRenderer } from "../../core.ts";
import { applyTextProps, currentTheme, getRenderingApp } from "../../core.ts";

const ICON_SIZE_TOKENS: Record<string, string> = {
  sm: "16px",
  md: "24px",
  lg: "32px",
  xl: "48px",
};

/** Normalize an `icon` `size` prop to a CSS length. Default tracks font size. */
function resolveIconSize(raw: unknown): string {
  if (typeof raw === "number") return `${raw}px`;
  if (typeof raw === "string") {
    const token = ICON_SIZE_TOKENS[raw];
    if (token) return token;
    return raw;
  }
  return "1em";
}

/**
 * Theme override (`theme.icons[name]`) wins over the compile-baked built-ins.
 * Render-time lookup: both sources come from the app whose render pass is
 * running (multi-mount registry in core).
 */
function resolveIconPath(name: string): string | null {
  const themeIcons = currentTheme()?.icons;
  if (themeIcons && typeof themeIcons === "object") {
    const t = (themeIcons as Record<string, unknown>)[name];
    if (typeof t === "string" && t.length > 0) return t;
  }
  const builtin = getRenderingApp()?.icons?.[name];
  if (typeof builtin === "string" && builtin.length > 0) return builtin;
  return null;
}

export const iconTile: TileRenderer<"icon"> = (node) => {
  const span = document.createElement("span");
  span.dataset.kumikiTile = "icon";
  span.dataset.kumikiIconName = node.name;
  // `color` is resolved against theme.colors; the inner SVG inherits it via
  // `fill="currentColor"`. `size` sizes the SVG box instead of the text, and
  // naming the kind is what says so — the exclusion lives in one table both
  // render paths read, rather than in a copy here.
  const sizeRaw = node.props?.size;
  applyTextProps(span, node.props, "icon");

  const d = resolveIconPath(node.name);
  if (!d) {
    // Unresolved name — preserve the historical placeholder so the failure is
    // visible without crashing the render (smoke-friendly).
    span.textContent = `[${node.name}]`;
    return span;
  }

  const size = resolveIconSize(sizeRaw);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  svg.appendChild(path);
  span.appendChild(svg);
  return span;
};

export const iconPatcher: TilePatcher<"icon"> = (el, oldNode, newNode) => {
  // Icons: if the name changes the SVG path itself must be swapped, but the
  // wrapper span is preserved so a size/color prop change alone doesn't
  // rebuild the SVG. This preserves whatever ambient styles the parent
  // painted onto the span.
  const span = el as HTMLSpanElement;
  const sizeRaw = newNode.props?.size;
  applyTextProps(span, newNode.props, "icon");
  if (oldNode.name !== newNode.name) {
    span.dataset.kumikiIconName = newNode.name;
    const d = resolveIconPath(newNode.name);
    const existing = span.querySelector("svg");
    if (existing) span.removeChild(existing);
    const priorPlaceholder = span.childNodes.length === 0 ? null : span.firstChild;
    if (!d) {
      span.textContent = `[${newNode.name}]`;
      return;
    }
    // Clear any placeholder text-node left from a prior "unresolved" render.
    if (priorPlaceholder && priorPlaceholder.nodeType === 3) span.removeChild(priorPlaceholder);
    const size = resolveIconSize(sizeRaw);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
    span.appendChild(svg);
    return;
  }
  // Same name — only size may have changed.
  const svg = span.querySelector("svg");
  if (svg) {
    const size = resolveIconSize(sizeRaw);
    if (svg.getAttribute("width") !== size) svg.setAttribute("width", size);
    if (svg.getAttribute("height") !== size) svg.setAttribute("height", size);
  }
};
