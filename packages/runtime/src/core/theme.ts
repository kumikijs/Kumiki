import { getRenderingApp } from "./rendering.ts";
import { appendStyleNode, findStyleNode, styleHostEl } from "./style-root.ts";
import type { AppShape, Theme, ThemeValue } from "./types.ts";

let lastAppliedThemeName: string | null = null;

export function applyInitialTheme(app: AppShape): void {
  lastAppliedThemeName = null;
  applyThemeDefaults(app);
  lastAppliedThemeName = resolvedThemeName(app) ?? null;
}

export function resolvedThemeName(app: AppShape): string | undefined {
  const name = app.themeName ?? undefined;
  if (name && app.themes && !(name in app.themes) && typeof app.live?.[name] === "string") {
    return app.live[name] as string;
  }
  return name;
}

export function maybeReapplyTheme(app: AppShape): void {
  const name = resolvedThemeName(app);
  if (name === lastAppliedThemeName) return;
  lastAppliedThemeName = name ?? null;
  applyThemeDefaults(app);
}

/**
 * The CSS value `theme` holds at `path`: a string as written, a number as pixels when
 * `numbers` allows it, and `undefined` for anything else or nothing.
 */
function valueAt(theme: Theme | null, path: readonly string[], numbers = true): string | undefined {
  let node: ThemeValue | undefined = theme ?? undefined;
  for (const seg of path) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return undefined;
    node = (node as Record<string, ThemeValue>)[seg];
  }
  if (typeof node === "string") return node;
  return numbers && typeof node === "number" ? `${node}px` : undefined;
}

function applyThemeDefaults(app: AppShape): void {
  const selected = resolvedThemeName(app);
  if (selected && app.themes && !(selected in app.themes)) {
    console.warn(
      `Theme "${selected}" is not declared; rendering with the built-in defaults. ` +
        `Declared themes: ${Object.keys(app.themes).join(", ") || "(none)"}`,
    );
  }
  const theme = currentThemeOf(app);
  if (!theme) return;
  const text = (...path: string[]): string | undefined => valueAt(theme, path, false);
  const color = (name: string, fallback: string): string => text("colors", name) ?? fallback;
  const host = styleHostEl();
  const bg = text("colors", "bg");
  if (bg !== undefined) host.style.background = bg;
  const fg = text("colors", "fg");
  if (fg !== undefined) host.style.color = fg;
  const family = text("typography", "family");
  if (family !== undefined) host.style.fontFamily = family;
  const size = text("typography", "size", "md");
  if (size !== undefined) host.style.fontSize = size;
  const lineHeight = text("typography", "line-height");
  if (lineHeight !== undefined) host.style.lineHeight = lineHeight;
  findStyleNode("kumiki-theme-base")?.remove();
  const css = document.createElement("style");
  css.id = "kumiki-theme-base";
  css.appendChild(
    document.createTextNode(`
[data-kumiki-tile="card"] {
  background: ${color("surface", "#fff")};
  border: 1px solid ${color("border", "#e0e0e0")};
  box-shadow: ${text("shadow", "sm") ?? "0 1px 2px rgba(0,0,0,0.08)"};
}
[data-kumiki-tile="button"] {
  background: ${color("surface", "#fff")};
  color: ${color("fg", "#1a1a1a")};
  border: 1px solid ${color("border", "#ddd")};
  padding: 6px 12px;
  cursor: pointer;
  border-radius: ${text("radius", "md") ?? "8px"};
}
[data-kumiki-tile="button"]:hover { filter: brightness(0.97); }
[data-kumiki-tile="input"], [data-kumiki-tile="textarea"] {
  font: inherit;
  padding: 6px 10px;
  border: 1px solid ${color("border", "#ddd")};
  border-radius: ${text("radius", "sm") ?? "4px"};
  background: ${color("surface", "#fff")};
  color: ${color("fg", "#1a1a1a")};
}
[data-kumiki-tile="input"]:focus, [data-kumiki-tile="textarea"]:focus {
  outline: 2px solid ${color("primary", "#0070f3")};
  outline-offset: 1px;
}
[data-kumiki-tile="link"] {
  color: ${color("primary", "#0070f3")};
  text-decoration: none;
}
[data-kumiki-tile="link"]:hover { text-decoration: underline; }
[data-kumiki-tile="heading"] {
  font-size: ${text("typography", "size", "xl") ?? "28px"};
  font-weight: 700;
  margin: 0 0 8px;
}
[data-kumiki-tile="markdown"] p { margin: 0 0 12px; }
`),
  );
  appendStyleNode(css);
}

export function currentTheme(): Theme | null {
  const app = getRenderingApp();
  return app ? currentThemeOf(app) : null;
}

function currentThemeOf(app: AppShape): Theme | null {
  if (!app.themes) return null;
  const name = resolvedThemeName(app) || Object.keys(app.themes)[0];
  if (!name) return null;
  return app.themes[name] ?? null;
}

const SPACING: Record<string, string> = {
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "40px",
  xxl: "64px",
};

const FONT_SIZES: Record<string, string> = {
  sm: "14px",
  md: "16px",
  lg: "20px",
  xl: "28px",
  xxl: "40px",
};

const RADII: Record<string, string> = {
  none: "0",
  sm: "4px",
  md: "8px",
  lg: "16px",
  pill: "999px",
};

const SHADOWS: Record<string, string> = {
  none: "none",
  sm: "0 1px 2px rgba(0,0,0,0.1)",
  md: "0 4px 8px rgba(0,0,0,0.1)",
  lg: "0 8px 24px rgba(0,0,0,0.15)",
};

const COLORS: Record<string, string> = {
  muted: "#888",
  danger: "#c4222a",
  primary: "#0070f3",
  fg: "#1a1a1a",
  surface: "#f7f7f7",
};

const FLEX_ALIGN: Record<string, string> = {
  start: "flex-start",
  end: "flex-end",
  center: "center",
  stretch: "stretch",
};

const FLEX_JUSTIFY: Record<string, string> = {
  start: "flex-start",
  end: "flex-end",
  center: "center",
  between: "space-between",
  around: "space-around",
};

const own = (table: Record<string, string>, key: string): string | undefined =>
  Object.hasOwn(table, key) ? table[key] : undefined;

export function mapToken(t: string): string {
  return valueAt(currentTheme(), ["spacing", t]) ?? own(SPACING, t) ?? t;
}

export function mapSize(s: string): string {
  return valueAt(currentTheme(), ["typography", "size", s]) ?? own(FONT_SIZES, s) ?? s;
}

export function mapRadius(r: string): string {
  return valueAt(currentTheme(), ["radius", r]) ?? own(RADII, r) ?? r;
}

export function mapShadow(s: string): string {
  return valueAt(currentTheme(), ["shadow", s]) ?? own(SHADOWS, s) ?? s;
}

export function mapColor(c: string): string {
  return valueAt(currentTheme(), ["colors", c], false) ?? own(COLORS, c) ?? c;
}

export function mapAlign(a: string): string {
  return own(FLEX_ALIGN, a) ?? a;
}

export function mapJustify(a: string): string {
  return own(FLEX_JUSTIFY, a) ?? a;
}

export function tokenRef(group: string, path: string[]): string {
  const themed = valueAt(currentTheme(), [group, ...path]);
  if (themed !== undefined) return themed;
  const last = path[path.length - 1] ?? "";
  if (group === "colors") return mapColor(last);
  if (group === "spacing" || group === "radius") return mapToken(last);
  if (group === "typography" && path[0] === "size") return mapSize(last);
  return valueAt(currentTheme(), [group, last]) ?? last;
}
