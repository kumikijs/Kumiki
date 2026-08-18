// The `toast` built-in effect (#71): shipped only when an app can emit it
// (declares the notification.show capability or emits `toast`).

import { type BuiltinInstaller, overridableInvoke } from "./core.ts";

/**
 * How long a toast of each kind stays when the emitter does not say
 * (lifecycle.md §7.7). `error` stays until it is dismissed, which is what a
 * duration of 0 means everywhere here.
 */
const DEFAULT_MS: Record<string, number> = {
  info: 3000,
  success: 3000,
  warn: 5000,
  error: 0,
};
const FALLBACK_MS = 3000;

/**
 * `duration` is `Option(Duration)`, and a `Duration` is milliseconds at runtime
 * (codegen lowers `Duration.s(3)` to `3000`). `Some(0)` is the spec's "manual
 * close", so zero is obeyed rather than treated as unset; a negative or
 * non-finite number is not a duration at all and falls back to the kind's
 * default.
 */
function durationMs(raw: unknown, kind: string | undefined): number {
  const some = raw as { _tag?: string; _0?: unknown } | undefined;
  const asked = some?._tag === "Some" ? some._0 : undefined;
  if (typeof asked === "number" && Number.isFinite(asked) && asked >= 0) return asked;
  return DEFAULT_MS[kind ?? ""] ?? FALLBACK_MS;
}

export const installToast: BuiltinInstaller = (app) => {
  app.effects.toast = {
    name: "toast",
    cap: "notification.show",
    invoke: overridableInvoke("notification.show", async (input) => {
      const t = input as { kind?: string; text?: string; duration?: unknown };
      const banner = document.createElement("div");
      banner.style.cssText =
        "position:fixed;bottom:24px;right:24px;padding:8px 16px;background:#1a1a1a;color:#fff;border-radius:8px;z-index:9999;";
      // The kind is carried, not interpreted: what a "success" toast looks
      // like is a design decision, the same call `variant` makes on a button.
      // `data-level` is the attribute the toast *tile* already writes.
      banner.dataset.kumikiToast = "";
      if (t.kind) banner.dataset.level = t.kind;
      // lifecycle.md §7.8 lists an announced toast as a runtime guarantee.
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
