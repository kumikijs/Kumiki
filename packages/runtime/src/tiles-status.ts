// Status / messaging tile renderers (#71): spinner, skeleton, progress, the
// inline toast tile, and the validation `error` tile.

import type { TileRenderers } from "./core.ts";
import { currentTheme, ensureAnimationStyles, getRenderingApp } from "./core.ts";

/**
 * Resolve the current validation message for a slot, for the `error` tile.
 * Returns "" (no error shown) when the slot's value passes its refinement, when
 * the slot has no refinement, or when no app is mounted. The message text comes
 * from `theme.errors[<pred>]` if overridden, else the spec §5.7.2 default.
 */
function resolveFieldError(field: string): string {
  // Render-time lookup: the error tile is being built for the app whose
  // render pass is running (multi-mount registry in core).
  const app = getRenderingApp();
  if (!app || !field) return "";
  const meta = app.slots?.[field];
  if (!meta?.refine) return "";
  const value = app.live?.[field] ?? meta.value;
  if (meta.refine(value)) return "";
  const pred = meta.refineKind ?? "";
  const args = meta.refineArgs ?? [];
  const theme = currentTheme();
  const overrides = theme?.errors as Record<string, string> | undefined;
  return overrides?.[pred] ?? defaultFieldError(pred, args);
}

/** Spec §5.7.2 default validation messages, keyed by refinement predicate. */
function defaultFieldError(pred: string, args: (number | string)[]): string {
  switch (pred) {
    case "email":
      return "Invalid email format";
    case "url":
      return "Invalid URL";
    case "uuid":
      return "Invalid identifier";
    case "nonempty":
      return "Required";
    case "len-eq":
      return `Must be exactly ${args[0]} characters`;
    case "len-lt":
      return `Must be less than ${args[0]} characters`;
    case "len-gt":
      return `Must be more than ${args[0]} characters`;
    case "between":
      return `Must be between ${args[0]} and ${args[1]}`;
    case "positive":
      return "Must be positive";
    case "negative":
      return "Must be negative";
    case "regex":
      return "Does not match pattern";
    case "one-of":
      return `Must be one of: ${args.join(", ")}`;
    default:
      return "Invalid value";
  }
}

export const statusTiles: TileRenderers = {
  spinner(node) {
    // The rotating ring + its keyframes live in the shared animation
    // stylesheet, so the spinner works in any style root (document or shadow)
    // and honors prefers-reduced-motion.
    ensureAnimationStyles();
    const span = document.createElement("span");
    span.dataset.kumikiTile = "spinner";
    span.setAttribute("role", "status");
    span.setAttribute("aria-label", "Loading");
    const size = node.props?.size;
    const tokens: Record<string, string> = {
      sm: "0.75rem",
      md: "1rem",
      lg: "1.5rem",
      xl: "2rem",
    };
    if (typeof size === "string" && tokens[size]) span.style.fontSize = tokens[size];
    return span;
  },
  skeleton(node) {
    const div = document.createElement("div");
    div.dataset.kumikiTile = "skeleton";
    div.style.background = "#eee";
    div.style.borderRadius = "8px";
    div.style.minHeight = "60px";
    const h = node.props?.h;
    if (typeof h === "number") div.style.height = `${h}px`;
    return div;
  },
  progress(node) {
    const p = document.createElement("progress");
    p.dataset.kumikiTile = "progress";
    if (typeof node.value === "number") p.value = node.value;
    if (typeof node.max === "number") p.max = node.max;
    return p;
  },
  toast(node) {
    const div = document.createElement("div");
    div.dataset.kumikiTile = "toast";
    if (node.level) div.dataset.level = node.level;
    div.style.padding = "8px 12px";
    div.style.borderRadius = "6px";
    div.textContent = node.text ?? "";
    return div;
  },
  error(node) {
    const span = document.createElement("span");
    span.dataset.kumikiTile = "error";
    span.dataset.field = node.field;
    span.style.color = "#c00";
    span.textContent = resolveFieldError(node.field);
    return span;
  },
};
