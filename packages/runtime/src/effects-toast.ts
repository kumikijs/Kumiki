import { type BuiltinEffects, type BuiltinInstaller, overridableInvoke } from "./core.ts";

const DEFAULT_MS: Record<string, number> = {
  info: 3000,
  success: 3000,
  warn: 5000,
  error: 0,
};
const FALLBACK_MS = 3000;

function durationMs(raw: unknown, kind: string | undefined): number {
  const some = raw as { _tag?: string; _0?: unknown } | undefined;
  const asked = some?._tag === "Some" ? some._0 : undefined;
  if (typeof asked === "number" && Number.isFinite(asked) && asked >= 0) return asked;
  return DEFAULT_MS[kind ?? ""] ?? FALLBACK_MS;
}

// The stack is what is fixed to the corner, and its flow places the banners, so two never land on
// one spot and one that leaves frees its place. Only the banners take the pointer: the gaps
// between them belong to the page underneath.
const STACK_STYLE =
  "position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none;";
const BANNER_STYLE =
  "display:flex;align-items:center;gap:8px;padding:8px 8px 8px 16px;background:#1a1a1a;color:#fff;border-radius:8px;pointer-events:auto;";
const DISMISS_STYLE =
  "display:flex;padding:4px;border:0;border-radius:4px;background:none;color:inherit;cursor:pointer;";

/** The document's one stack, opened by the first toast that needs it. Looked up rather than kept:
 * the page may have taken it away, as a test that empties `<body>` does. */
function stack(): HTMLElement {
  const open = document.querySelector<HTMLElement>("[data-kumiki-toast-stack]");
  if (open) return open;
  const el = document.createElement("div");
  el.dataset.kumikiToastStack = "";
  el.style.cssText = STACK_STYLE;
  document.body.appendChild(el);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svgElement(tag: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** Drawn rather than written, so the banner's text is the toast's alone. */
function cross(): SVGElement {
  const svg = svgElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 12 12",
    "aria-hidden": "true",
  });
  svg.appendChild(
    svgElement("path", {
      d: "M2 2l8 8M10 2l-8 8",
      stroke: "currentColor",
      "stroke-width": "1.5",
      "stroke-linecap": "round",
    }),
  );
  return svg;
}

type ToastInput = { kind?: string; text?: string; duration?: unknown };

function show(t: ToastInput): void {
  const banner = document.createElement("div");
  banner.style.cssText = BANNER_STYLE;
  banner.dataset.kumikiToast = "";
  if (t.kind) banner.dataset.level = t.kind;
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.dataset.kumikiToastDismiss = "";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.style.cssText = DISMISS_STYLE;
  dismiss.appendChild(cross());
  banner.append(t.text ?? "", dismiss);
  const home = stack();
  home.appendChild(banner);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const leave = (): void => {
    clearTimeout(timer);
    // Focus that would fall to <body> goes to the toast taking this one's place instead.
    const heir = banner.contains(document.activeElement)
      ? (banner.nextElementSibling ?? banner.previousElementSibling)
      : null;
    banner.remove();
    if (!home.firstElementChild) home.remove();
    heir?.querySelector<HTMLElement>("[data-kumiki-toast-dismiss]")?.focus();
  };
  dismiss.addEventListener("click", leave);
  // On the banner, not the document: Escape pressed anywhere else stays the page's, and the press
  // that dismissed a toast goes no further, so a dialog listening on the document stays open.
  banner.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    leave();
  });
  const ms = durationMs(t.duration, t.kind);
  if (ms > 0) timer = setTimeout(leave, ms);
}

export const installToast: BuiltinInstaller = (app) => {
  const effects: BuiltinEffects = app.effects;
  effects.toast = {
    name: "toast",
    cap: "notification.show",
    invoke: overridableInvoke("notification.show", async (input) => {
      show(input as ToastInput);
      return { kind: "ok", value: null };
    }),
  };
};
