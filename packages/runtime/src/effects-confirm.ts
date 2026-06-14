// The `confirm` built-in effect (lifecycle §7.6): renders a modal dialog with
// Yes / No actions and dispatches the user-supplied reducer references. The
// runtime also resolves any pending `route.leave` guard the confirm was
// emitted from (routing §3.5.2): Yes commits the held transition, No reverts.

import { type AppShape, type BuiltinInstaller, overridableInvoke } from "./core.ts";

type ConfirmInput = {
  title?: string;
  message?: string;
  onYes?: string;
  onNo?: string;
};

type AppWithHooks = AppShape & {
  _dispatch?: (name: string, el: Record<string, unknown>) => void;
  _resolveLeave?: (outcome: "yes" | "no") => void;
};

export const installConfirm: BuiltinInstaller = (app) => {
  app.effects.confirm = {
    name: "confirm",
    cap: "notification.show",
    invoke: overridableInvoke("notification.show", async (input) => {
      const t = (input ?? {}) as ConfirmInput;
      await renderConfirmModal(app as AppWithHooks, t);
      return { kind: "ok", value: null };
    }),
  };
};

function renderConfirmModal(app: AppWithHooks, t: ConfirmInput): Promise<void> {
  return new Promise<void>((resolve) => {
    const overlay = document.createElement("div");
    overlay.dataset.kumikiConfirm = "1";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:10000;";

    const dialog = document.createElement("div");
    dialog.style.cssText =
      "background:#fff;color:#111;padding:16px;border-radius:8px;min-width:280px;max-width:480px;box-shadow:0 10px 30px rgba(0,0,0,.2);";

    if (t.title) {
      const h = document.createElement("h3");
      h.textContent = t.title;
      h.style.cssText = "margin:0 0 8px 0;font-size:16px;";
      dialog.appendChild(h);
    }
    if (t.message) {
      const p = document.createElement("p");
      p.textContent = t.message;
      p.style.cssText = "margin:0 0 12px 0;";
      dialog.appendChild(p);
    }

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";

    const noBtn = document.createElement("button");
    noBtn.type = "button";
    noBtn.textContent = "No";
    noBtn.dataset.kumikiConfirmAction = "no";

    const yesBtn = document.createElement("button");
    yesBtn.type = "button";
    yesBtn.textContent = "Yes";
    yesBtn.dataset.kumikiConfirmAction = "yes";

    actions.appendChild(noBtn);
    actions.appendChild(yesBtn);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") finish("no");
    };
    document.addEventListener("keydown", onKey);

    const finish = (outcome: "yes" | "no"): void => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      // Order matters: run the user-supplied callback first so any cleanup
      // (e.g. `dirty := false`) lands before route.enter sees the new route.
      const cb = outcome === "yes" ? t.onYes : t.onNo;
      if (cb) app._dispatch?.(cb, {});
      app._resolveLeave?.(outcome);
      resolve();
    };

    yesBtn.addEventListener("click", () => finish("yes"));
    noBtn.addEventListener("click", () => finish("no"));
    yesBtn.focus();
  });
}
