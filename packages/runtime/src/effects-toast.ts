// The `toast` built-in effect (#71): shipped only when an app can emit it
// (declares the notification.show capability or emits `toast`).

import { type BuiltinInstaller, overridableInvoke } from "./core.ts";

/** How long a toast stays when the emitter does not say (stdlib.md §2.6.2). */
const DEFAULT_MS = 3000;

/**
 * `duration` is `Option(Duration)`, and a `Duration` is milliseconds at runtime
 * (codegen lowers `Duration.s(3)` to `3000`). Anything else — a missing field,
 * `None`, a negative or non-finite number — means the default rather than a
 * toast that never leaves.
 */
function durationMs(raw: unknown): number {
  const some = raw as { _tag?: string; _0?: unknown } | undefined;
  const ms = some?._tag === "Some" ? some._0 : undefined;
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_MS;
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
      // The kind is carried, not interpreted: what a "success" toast looks like
      // is a design decision, the same call `variant` makes on a button.
      banner.dataset.kumikiToast = "";
      if (t.kind) banner.dataset.kumikiToastKind = t.kind;
      // lifecycle.md §7.8 lists an announced toast as a runtime guarantee.
      banner.setAttribute("role", "status");
      banner.setAttribute("aria-live", "polite");
      banner.textContent = t.text ?? "";
      document.body.appendChild(banner);
      setTimeout(() => banner.remove(), durationMs(t.duration));
      return { kind: "ok", value: null };
    }),
  };
};
