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

export const installToast: BuiltinInstaller = (app) => {
  const effects: BuiltinEffects = app.effects;
  effects.toast = {
    name: "toast",
    cap: "notification.show",
    invoke: overridableInvoke("notification.show", async (input) => {
      const t = input as { kind?: string; text?: string; duration?: unknown };
      const banner = document.createElement("div");
      banner.style.cssText =
        "position:fixed;bottom:24px;right:24px;padding:8px 16px;background:#1a1a1a;color:#fff;border-radius:8px;z-index:9999;";
      banner.dataset.kumikiToast = "";
      if (t.kind) banner.dataset.level = t.kind;
      banner.setAttribute("role", "status");
      banner.setAttribute("aria-live", "polite");
      banner.textContent = t.text ?? "";
      document.body.appendChild(banner);
      const ms = durationMs(t.duration, t.kind);
      if (ms > 0) setTimeout(() => banner.remove(), ms);
      return { kind: "ok", value: null };
    }),
  };
};
