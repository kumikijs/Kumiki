import type { BindReader, TilePatchers, TileRenderers } from "./core.ts";
import {
  currentTheme,
  ensureAnimationStyles,
  failedRefinement,
  getRenderingApp,
  getRenderingView,
  judgeShownField,
} from "./core.ts";

function resolveFieldError(field: string): string {
  const app = getRenderingApp();
  if (!app || !field) return "";
  const meta = app.slots?.[field];
  if (!meta) return "";
  const shown = judgeShownField(app, field, getRenderingView());
  if (shown.valid) return "";
  const overrides = currentTheme()?.errors as Record<string, string> | undefined;
  // Text that does not read as the bound base at all is judged before any refinement.
  if (shown.unread) {
    const key = UNREAD_KEY[shown.unread];
    return overrides?.[key] ?? defaultFieldError(key, []);
  }
  const value = shown.value;
  const failed = failedRefinement(value, meta);
  const pred = failed.kind ?? "";
  const args = failed.args ?? [];
  return overrides?.[pred] ?? defaultFieldError(pred, args);
}

const UNREAD_KEY: Readonly<Record<BindReader["as"], string>> = {
  Int: "int",
  Float: "float",
  Time: "time",
};

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
    case "int":
      return "Must be a whole number";
    case "float":
      return "Must be a number";
    case "time":
      return "Must be a date";
    default:
      return "Invalid value";
  }
}

export const statusTiles: TileRenderers = {
  spinner(node) {
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
    div.setAttribute("aria-busy", "true");
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
    div.setAttribute("role", "status");
    div.setAttribute("aria-live", "polite");
    if (node.level) div.dataset.level = node.level;
    div.style.padding = "8px 12px";
    div.style.borderRadius = "6px";
    div.textContent = node.text ?? "";
    return div;
  },
  error(node) {
    const span = document.createElement("span");
    span.dataset.kumikiTile = "error";
    span.setAttribute("role", "alert");
    span.setAttribute("aria-live", "assertive");
    span.dataset.field = node.field;
    span.style.color = "#c00";
    span.textContent = resolveFieldError(node.field);
    return span;
  },
};

export const statusPatchers: TilePatchers = {
  spinner(el, _oldNode, newNode) {
    const span = el as HTMLSpanElement;
    const size = newNode.props?.size;
    const tokens: Record<string, string> = {
      sm: "0.75rem",
      md: "1rem",
      lg: "1.5rem",
      xl: "2rem",
    };
    if (typeof size === "string" && tokens[size]) span.style.fontSize = tokens[size];
    else span.style.fontSize = "";
  },
  skeleton(el, _oldNode, newNode) {
    const div = el as HTMLDivElement;
    const h = newNode.props?.h;
    if (typeof h === "number") div.style.height = `${h}px`;
    else div.style.height = "";
  },
  progress(el, _oldNode, newNode) {
    const p = el as HTMLProgressElement;
    if (typeof newNode.value === "number") {
      if (p.value !== newNode.value) p.value = newNode.value;
    } else if (p.hasAttribute("value")) {
      p.removeAttribute("value");
    }
    if (typeof newNode.max === "number") {
      if (p.max !== newNode.max) p.max = newNode.max;
    }
  },
  toast(el, _oldNode, newNode) {
    const div = el as HTMLDivElement;
    if (newNode.level != null) {
      if (div.dataset.level !== newNode.level) div.dataset.level = newNode.level;
    } else if (div.dataset.level !== undefined) {
      delete div.dataset.level;
    }
    const nextText = newNode.text ?? "";
    if (div.textContent !== nextText) div.textContent = nextText;
  },
  error(el, _oldNode, newNode) {
    const span = el as HTMLSpanElement;
    if (span.dataset.field !== newNode.field) span.dataset.field = newNode.field;
    const nextText = resolveFieldError(newNode.field);
    if (span.textContent !== nextText) span.textContent = nextText;
  },
};
