import { applyTransition } from "./motion.ts";
import { stateStyleSheet } from "./style-root.ts";
import {
  currentTheme,
  mapAlign,
  mapColor,
  mapJustify,
  mapRadius,
  mapShadow,
  mapSize,
  mapToken,
} from "./theme.ts";
import type { ThemeValue, TileProps } from "./types.ts";

export type StyleDecl = [property: string, value: string];

export type ResponsivePick = (raw: unknown) => string | number | undefined;

const asScalar = (v: unknown): string | number | undefined =>
  (typeof v === "string" && v !== "") || typeof v === "number" ? v : undefined;

/** The value a server can know: the base, or the literal if it is not a map. */
export const pickBaseValue: ResponsivePick = (raw) => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return asScalar(raw);
  return asScalar((raw as Record<string, unknown>).base);
};

/** The breakpoints a theme that declares none of its own gets. */
const DEFAULT_BREAKPOINTS: Record<string, ThemeValue> = {
  sm: "640px",
  md: "768px",
  lg: "1024px",
  xl: "1280px",
};

function breakpointWidth(w: ThemeValue): [string, number] | undefined {
  if (typeof w === "object") return undefined;
  const m = /^(\d+(?:\.\d+)?|\.\d+)(px|rem|em)?$/.exec(String(w).trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] ? [`${m[1]}${m[2]}`, m[2] === "px" ? n : n * 16] : [`${n}px`, n];
}

export const pickForViewport: ResponsivePick = (raw) => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return asScalar(raw);
  const m = raw as Record<string, unknown>;
  const declared = currentTheme()?.breakpoints;
  const bps = {
    ...DEFAULT_BREAKPOINTS,
    ...(declared && typeof declared === "object" ? declared : {}),
  };
  const widest: [string, string, number][] = [];
  for (const [k, w] of Object.entries(bps)) {
    const width = breakpointWidth(w);
    if (width) widest.push([k, ...width]);
  }
  widest.sort((a, b) => b[2] - a[2]);
  for (const [bp, w] of widest) {
    if (m[bp] !== undefined && window.matchMedia(`(min-width: ${w})`).matches) {
      return asScalar(m[bp]);
    }
  }
  return asScalar(m.base);
};

export function gridTracks(
  props: TileProps | undefined,
  pick: ResponsivePick,
): { cols: string; rows: string | undefined } {
  return { cols: track(pick(props?.cols)) ?? "repeat(3, 1fr)", rows: track(pick(props?.rows)) };
}

function track(v: string | number | undefined): string | undefined {
  return typeof v === "number" ? `repeat(${v}, 1fr)` : v;
}

function styleBlockDecls(raw: unknown): StyleDecl[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: StyleDecl[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    out.push([key, typeof value === "number" ? `${value}px` : String(value)]);
  }
  return out;
}

export function propStyleDecls(
  props: TileProps | undefined,
  pick: ResponsivePick,
  kind?: string,
): StyleDecl[] {
  if (!props) return [];
  const owned = kind === undefined ? undefined : KIND_OWNED_PROPS[kind];
  if (owned) {
    const rest: TileProps = { ...props };
    for (const name of owned) delete (rest as Record<string, unknown>)[name];
    props = rest;
  }
  const out: StyleDecl[] = [];
  const gap = pick(props.gap);
  if (gap !== undefined) out.push(["gap", mapToken(String(gap))]);
  const gapX = pick(props.gap_x);
  if (gapX !== undefined) out.push(["column-gap", mapToken(String(gapX))]);
  const gapY = pick(props.gap_y);
  if (gapY !== undefined) out.push(["row-gap", mapToken(String(gapY))]);
  const align = pick(props.align);
  if (align !== undefined) out.push(["align-items", mapAlign(String(align))]);
  const justify = pick(props.justify);
  if (justify !== undefined) out.push(["justify-content", mapJustify(String(justify))]);
  const pad = pick(props.pad);
  if (pad !== undefined) out.push(["padding", mapToken(String(pad))]);
  const padX = pick(props.pad_x);
  if (padX !== undefined) {
    out.push(["padding-left", mapToken(String(padX))], ["padding-right", mapToken(String(padX))]);
  }
  const padY = pick(props.pad_y);
  if (padY !== undefined) {
    out.push(["padding-top", mapToken(String(padY))], ["padding-bottom", mapToken(String(padY))]);
  }
  for (const [prop, css] of SIZING_PROPS) {
    const v = pick(props[prop]);
    if (v !== undefined) out.push([css, mapLength(v)]);
  }
  // `aspect` is a ratio, not a length: `1` means 1/1, and `1px` means nothing.
  const aspect = pick(props.aspect);
  if (aspect !== undefined) out.push(["aspect-ratio", String(aspect)]);
  if (typeof props.wrap === "boolean") out.push(["flex-wrap", props.wrap ? "wrap" : "nowrap"]);
  const bg = token(props.bg);
  if (bg !== undefined) out.push(["background", mapColor(bg)]);
  const radius = token(props.radius);
  if (radius !== undefined) out.push(["border-radius", mapRadius(radius)]);
  const shadow = token(props.shadow);
  if (shadow !== undefined) out.push(["box-shadow", mapShadow(shadow)]);
  if (props.strike) out.push(["text-decoration", "line-through"]);
  const color = token(props.color);
  if (color !== undefined) out.push(["color", mapColor(color)]);
  const size = token(props.size);
  if (size !== undefined) out.push(["font-size", mapSize(size)]);
  if (props.weight === "bold") out.push(["font-weight", "700"]);
  out.push(...styleBlockDecls(props.style));
  return out;
}

const KIND_OWNED_PROPS: Record<string, readonly string[] | undefined> = {
  spinner: ["size"],
  icon: ["size"],
  skeleton: ["h"],
};

/** A token name a tile wrote, or `undefined` when it wrote none. */
export const token = (v: unknown): string | undefined =>
  typeof v === "string" && v !== "" ? v : undefined;

const SIZING_PROPS: ReadonlyArray<readonly [prop: string, css: string]> = [
  ["w", "width"],
  ["h", "height"],
  ["min_w", "min-width"],
  ["min_h", "min-height"],
  ["max_w", "max-width"],
  ["max_h", "max-height"],
];

function mapLength(v: string | number): string {
  if (typeof v === "number") return `${v}px`;
  return v === "full" ? "100%" : v;
}

export function setDecls(el: HTMLElement, decls: StyleDecl[]): void {
  for (const [k, v] of decls) el.style.setProperty(k, v);
}

export function patchPropStyle(
  el: HTMLElement,
  before: TileProps | undefined,
  after: TileProps | undefined,
  kind?: string,
): void {
  const was = propStyleDecls(before, pickForViewport, kind);
  const now = propStyleDecls(after, pickForViewport, kind);
  for (const [prop] of was) {
    if (!now.some(([p]) => p === prop)) el.style.removeProperty(prop);
  }
  setDecls(el, now);
}

/** An attribute a tile's props ask for. */
export type AttrDecl = [name: string, value: string];

export function commonAttrDecls(props?: TileProps): AttrDecl[] {
  if (!props) return [];
  const out: AttrDecl[] = [];
  if (typeof props.class === "string" && props.class.trim() !== "")
    out.push(["class", props.class]);

  if (attrValue(props.id) !== undefined) out.push(["id", String(props.id)]);
  if (attrValue(props.test_id) !== undefined) out.push(["data-kumiki-test", String(props.test_id)]);
  if (attrValue(props.role) !== undefined) out.push(["role", String(props.role)]);
  // A map, or nothing: a `Text` here would spread into `aria-0` / `aria-1`,
  // one attribute per character.
  const aria = props.aria;
  if (aria !== null && typeof aria === "object" && !Array.isArray(aria)) {
    for (const [key, value] of Object.entries(aria as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      if (!/^[a-zA-Z][\w-]*$/.test(key)) continue;
      out.push([key.startsWith("aria-") ? key : `aria-${key}`, String(value)]);
    }
  }
  return out;
}

/** A prop that becomes an attribute, or `undefined` when the tile did not say. */
export function attrValue(v: unknown): string | number | undefined {
  if (typeof v === "number") return v;
  return typeof v === "string" && v !== "" ? v : undefined;
}

/** The class tokens a decl list asks for, in order. */
function classTokensOf(decls: AttrDecl[]): string[] {
  const decl = decls.find(([name]) => name === "class");
  return decl ? decl[1].split(/\s+/).filter((t) => t !== "") : [];
}

export function applyCommonProps(el: HTMLElement, props?: TileProps): void {
  patchCommonProps(el, undefined, props);
}

export function patchCommonProps(
  el: HTMLElement,
  before: TileProps | undefined,
  after: TileProps | undefined,
): void {
  const was = commonAttrDecls(before);
  const now = commonAttrDecls(after);
  const wasClasses = classTokensOf(was);
  const nowClasses = classTokensOf(now);
  for (const token of wasClasses) {
    if (!nowClasses.includes(token)) el.classList.remove(token);
  }
  for (const token of nowClasses) el.classList.add(token);
  for (const [name] of was) {
    if (name !== "class" && !now.some(([n]) => n === name)) el.removeAttribute(name);
  }
  for (const [name, value] of now) {
    if (name !== "class") el.setAttribute(name, value);
  }
}

export function applyContainerProps(el: HTMLElement, props?: TileProps, kind?: string): void {
  if (!props) return;
  setDecls(el, propStyleDecls(props, pickForViewport, kind));
  applyStateStyles(el, props);
  applyTransition(el, props);
}

let stateStyleSeq = 0;

const STATE_STYLE_SIG = new WeakMap<HTMLElement, string>();

const STATE_SELECTORS = {
  hover: ":hover",
  focus: ":focus",
  active: ":active",
  disabled: ":disabled",
  selected: "[data-kumiki-selected]",
} as const;

function applyStateStyles(el: HTMLElement, props: TileProps): void {
  const states = Object.keys(STATE_SELECTORS) as (keyof typeof STATE_SELECTORS)[];
  const sig = JSON.stringify(states.map((state) => props[state]));
  if (STATE_STYLE_SIG.get(el) === sig) return;
  if (STATE_STYLE_SIG.has(el)) delete el.dataset.kumikiState;
  STATE_STYLE_SIG.set(el, sig);
  for (const state of states) {
    const sub = props[state];
    if (!sub || typeof sub !== "object" || Array.isArray(sub)) continue;
    const id = `s${++stateStyleSeq}`;
    el.dataset.kumikiState = el.dataset.kumikiState ? `${el.dataset.kumikiState} ${id}` : id;
    const decls = stateStyleDecls(sub as Record<string, unknown>);
    const rule = `[data-kumiki-state~="${id}"]${STATE_SELECTORS[state]} { ${decls} }\n`;
    stateStyleSheet().appendChild(document.createTextNode(rule));
  }
}

function stateStyleDecls(sub: Record<string, unknown>): string {
  const decls: string[] = [];
  if (typeof sub.bg === "string") decls.push(`background: ${mapColor(sub.bg as string)}`);
  if (typeof sub.color === "string") decls.push(`color: ${mapColor(sub.color as string)}`);
  if (typeof sub.shadow === "string") decls.push(`box-shadow: ${sub.shadow}`);
  return decls.join("; ");
}

export function applyTextProps(el: HTMLElement, props?: TileProps, kind?: string): void {
  if (!props) return;
  setDecls(el, propStyleDecls(props, pickForViewport, kind));
  applyStateStyles(el, props);
}
