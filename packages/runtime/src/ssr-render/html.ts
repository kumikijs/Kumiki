import {
  attrValue,
  type BindSegment,
  bindLabel,
  commonAttrDecls,
  type TileNode,
  type TileProps,
} from "../core.ts";
import { styleAttr } from "./style.ts";

const VOID_TAGS = new Set(["br", "hr", "img", "input"]);

export function stringAttr(v: unknown): string | undefined {
  const value = attrValue(v);
  return value === undefined ? undefined : String(value);
}

export function controlAttrs(
  props: TileProps | undefined,
  takesReadonly = false,
): Record<string, string | boolean | undefined> {
  return {
    disabled: props?.disabled === true ? true : undefined,
    // Only where the element has the state to be in: a `<select>` and a checkbox have no `readOnly`, and the mount path skips them by asking the element.
    // Serialising it anyway would put an attribute on the served page that hydration then takes away.
    readonly: takesReadonly && props?.readonly === true ? true : undefined,
    autocomplete: stringAttr(props?.auto_complete),
  };
}

export function tileIdOf(node: TileNode): string | undefined {
  const raw = (node as { id?: unknown }).id ?? (node as { props?: { id?: unknown } }).props?.id;
  const value = attrValue(raw);
  return value === undefined ? undefined : String(value);
}

export function bindAttr(node: { bind?: string; bindPath?: BindSegment[] }): string | undefined {
  if (!node.bind) return undefined;
  return node.bindPath ? bindLabel(node.bind, node.bindPath) : node.bind;
}

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function serializeAttrs(
  attrs: Record<string, string | number | boolean | undefined>,
): string {
  let out = "";
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false || v === null) continue;
    if (v === true) {
      out += ` ${k}`;
      continue;
    }
    out += ` ${k}="${escapeAttr(String(v))}"`;
  }
  return out;
}

export function el(
  node: TileNode,
  tag: string,
  attrs: Record<string, string | number | boolean | undefined>,
  children: string,
): string {
  const attrStr = serializeAttrs({ style: styleAttr(node), ...attrs, ...commonAttrs(node) });
  if (VOID_TAGS.has(tag)) return `<${tag}${attrStr}>`;
  return `<${tag}${attrStr}>${children}</${tag}>`;
}

/** The common props of a node, in the shape `serializeAttrs` takes. */
function commonAttrs(node: TileNode): Record<string, string> {
  return Object.fromEntries(commonAttrDecls((node as { props?: TileProps }).props));
}
