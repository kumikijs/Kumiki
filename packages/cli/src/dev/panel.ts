// Dev panel — timeline + inspector + error overlay (spec §10.7). Vanilla TS,
// no external deps. Mounted into #kumiki-dev-panel by the dev client.
//
// Layout:
//   - fixed bottom-right card with two tabs ("timeline" / "inspector")
//   - full-screen modal overlay when the most recent episode ended in `panic`
//
// Public API: `installDevPanel({ logger, getApp })` returns:
//   - `push()`: called by the client's `onEpisode` to refresh the timeline and
//     possibly raise the panic overlay. The episode itself is read from the
//     logger, not the call site.
//   - `onRemount()`: called after an HMR re-mount to refresh the inspector
//     (it pulls the new AppShape via `getApp`).
//   - `showError(message, location?)`: surface a non-Episode error (e.g. an
//     HMR-time mount() throw) through the same overlay.
//
// XSS posture: every piece of data that originates outside this file
// (episode fields, slot values, tile names, panic messages, hand-off error
// strings) is inserted via `.textContent` or `document.createElement`. No
// `innerHTML` writes happen anywhere in this module — see the helper
// functions below.

import type { AppShape, EpisodeLogger, EpisodeStep } from "@kumikijs/runtime";

type Options = {
  logger: EpisodeLogger;
  getApp: () => AppShape;
};

const STYLE = `
  #kumiki-dev-panel * { box-sizing: border-box; }
  .kdp-root {
    position: fixed; right: 12px; bottom: 12px; width: 360px; max-height: 60vh;
    background: rgba(20,20,28,0.96); color: #e6e6ea; font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace;
    border-radius: 8px; box-shadow: 0 6px 24px rgba(0,0,0,0.4); display: flex; flex-direction: column;
    z-index: 2147483646; overflow: hidden;
  }
  .kdp-tabs { display: flex; border-bottom: 1px solid #2c2c38; }
  .kdp-tab { flex: 1; padding: 6px 10px; cursor: pointer; user-select: none; background: transparent; color: inherit; border: 0; }
  .kdp-tab.active { background: #2c2c38; }
  .kdp-body { overflow: auto; padding: 8px 10px; flex: 1; }
  .kdp-episode { border-bottom: 1px dashed #2c2c38; padding: 6px 0; }
  .kdp-episode-head { cursor: pointer; display: flex; gap: 6px; align-items: baseline; }
  .kdp-status { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: #444; }
  .kdp-status.completed { background: #2f6f3f; }
  .kdp-status.panic { background: #883333; }
  .kdp-status.cancelled { background: #555; }
  .kdp-status.ongoing { background: #4a6098; }
  .kdp-steps { margin: 4px 0 0 12px; list-style: none; padding: 0; }
  .kdp-step { padding: 1px 0; opacity: 0.9; }
  .kdp-step.panic { color: #ff8b8b; }
  .kdp-empty { opacity: 0.6; padding: 8px 0; }
  .kdp-json { white-space: pre-wrap; word-break: break-word; margin: 0; }
  .kdp-section { margin-bottom: 10px; }
  .kdp-section h4 { margin: 0 0 4px; font-size: 11px; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.5px; }
  .kdp-tile { padding-left: 8px; margin: 0; }
  .kdp-overlay {
    position: fixed; inset: 0; background: rgba(120,20,20,0.92); color: #fff; z-index: 2147483647;
    display: flex; align-items: center; justify-content: center; padding: 24px;
    font: 13px/1.5 ui-monospace, Menlo, Consolas, monospace;
  }
  .kdp-overlay-card { max-width: 720px; background: rgba(0,0,0,0.35); padding: 20px 24px; border-radius: 8px; }
  .kdp-overlay-title { font-size: 16px; margin: 0 0 8px; }
  .kdp-overlay-loc { opacity: 0.8; margin: 0 0 12px; }
  .kdp-overlay-hint { opacity: 0.7; margin-top: 12px; font-size: 11px; }
`;

export function installDevPanel(opts: Options): {
  push(): void;
  onRemount(): void;
  showError(message: string, location?: string): void;
} {
  const host = document.getElementById("kumiki-dev-panel");
  if (!host) throw new Error("kumiki dev: #kumiki-dev-panel container missing");

  const styleEl = document.createElement("style");
  styleEl.textContent = STYLE;
  host.appendChild(styleEl);

  const root = el("div", "kdp-root");
  const tabsBar = el("div", "kdp-tabs");
  const timelineTab = button("Timeline", "kdp-tab active");
  timelineTab.dataset.tab = "timeline";
  const inspectorTab = button("Inspector", "kdp-tab");
  inspectorTab.dataset.tab = "inspector";
  tabsBar.append(timelineTab, inspectorTab);
  const timelineBody = el("div", "kdp-body");
  timelineBody.dataset.pane = "timeline";
  const inspectorBody = el("div", "kdp-body");
  inspectorBody.dataset.pane = "inspector";
  inspectorBody.hidden = true;
  root.append(tabsBar, timelineBody, inspectorBody);
  host.appendChild(root);

  const tabs = [timelineTab, inspectorTab];
  for (const t of tabs) {
    t.addEventListener("click", () => {
      const name = t.dataset.tab;
      for (const x of tabs) x.classList.toggle("active", x === t);
      timelineBody.hidden = name !== "timeline";
      inspectorBody.hidden = name !== "inspector";
      if (name === "inspector") renderInspector();
    });
  }

  const expanded = new Set<string>();
  function renderTimeline(): void {
    const episodes = opts.logger.list().slice().reverse();
    timelineBody.replaceChildren();
    if (episodes.length === 0) {
      const empty = el("div", "kdp-empty");
      empty.textContent = "no episodes yet";
      timelineBody.appendChild(empty);
      return;
    }
    for (const ep of episodes) {
      const item = el("div", "kdp-episode");
      const head = el("div", "kdp-episode-head");
      const statusChip = el("span", `kdp-status ${cssToken(ep.status)}`);
      statusChip.textContent = ep.status;
      const title = el("span");
      title.textContent = `${ep.trigger.kind}${ep.trigger.target ? ` ${ep.trigger.target}` : ""}`;
      const count = el("span");
      count.style.opacity = "0.5";
      count.textContent = `${ep.steps.length} step${ep.steps.length === 1 ? "" : "s"}`;
      head.append(statusChip, title, count);
      head.addEventListener("click", () => {
        if (expanded.has(ep.id)) expanded.delete(ep.id);
        else expanded.add(ep.id);
        renderTimeline();
      });
      item.appendChild(head);
      if (expanded.has(ep.id)) {
        const ul = document.createElement("ul");
        ul.className = "kdp-steps";
        for (const step of ep.steps) {
          const li = document.createElement("li");
          li.className = `kdp-step${step.kind === "panic" ? " panic" : ""}`;
          li.textContent = formatStep(step);
          ul.appendChild(li);
        }
        item.appendChild(ul);
      }
      timelineBody.appendChild(item);
    }
  }

  function renderInspector(): void {
    const app = opts.getApp();
    const live = app.live ?? {};
    inspectorBody.replaceChildren();

    const slotsSection = section("Slots (app.live)");
    const slotsPre = el("pre", "kdp-json");
    slotsPre.textContent = safeStringify(live, 2);
    slotsSection.appendChild(slotsPre);
    inspectorBody.appendChild(slotsSection);

    const treeSection = section("Tile tree");
    const treePre = el("pre", "kdp-tile");
    treePre.textContent = formatTileTree(app);
    treeSection.appendChild(treePre);
    inspectorBody.appendChild(treeSection);
  }

  let overlay: HTMLElement | null = null;
  let overlayKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  function dismissOverlay(): void {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    if (overlayKeyHandler) {
      // Without this the listener leaks every time the overlay opens — Esc
      // works once and then dangles for the life of the page.
      window.removeEventListener("keydown", overlayKeyHandler);
      overlayKeyHandler = null;
    }
  }

  function showOverlay(title: string, message: string, location: string): void {
    dismissOverlay();
    overlay = el("div", "kdp-overlay");
    const card = el("div", "kdp-overlay-card");
    const titleEl = el("h3", "kdp-overlay-title");
    titleEl.textContent = title;
    const loc = el("p", "kdp-overlay-loc");
    loc.textContent = location;
    const msg = el("pre", "kdp-json");
    msg.textContent = message;
    const hint = el("p", "kdp-overlay-hint");
    hint.textContent = "press Esc to dismiss (a successful next episode also clears this)";
    card.append(titleEl, loc, msg, hint);
    overlay.appendChild(card);
    overlay.addEventListener("click", dismissOverlay);
    overlayKeyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissOverlay();
    };
    window.addEventListener("keydown", overlayKeyHandler);
    document.body.appendChild(overlay);
  }

  function maybeShowOverlay(): void {
    const all = opts.logger.list();
    const latest = all.length > 0 ? all[all.length - 1] : undefined;
    const lastStep = latest?.steps[latest.steps.length - 1];
    if (latest && latest.status === "panic" && lastStep && lastStep.kind === "panic") {
      if (overlay) return;
      showOverlay("Kumiki panic", lastStep.message, lastStep.location ?? "");
    } else if (overlay && latest && latest.status === "completed") {
      dismissOverlay();
    }
  }

  renderTimeline();
  renderInspector();

  return {
    push() {
      renderTimeline();
      if (!inspectorBody.hidden) renderInspector();
      maybeShowOverlay();
    },
    onRemount() {
      renderInspector();
      dismissOverlay();
    },
    showError(message, location) {
      showOverlay("Kumiki error", message, location ?? "");
    },
  };
}

// --- helpers ----------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function button(text: string, className: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = text;
  return b;
}

function section(title: string): HTMLElement {
  const s = el("div", "kdp-section");
  const h = el("h4");
  h.textContent = title;
  s.appendChild(h);
  return s;
}

function cssToken(s: string): string {
  // Restrict status class names to the known-safe set for CSS targeting; an
  // unexpected value still falls back to the base `.kdp-status` style.
  return /^[a-z][a-z0-9-]*$/i.test(s) ? s : "";
}

function safeStringify(v: unknown, indent: number): string {
  try {
    return JSON.stringify(v, null, indent);
  } catch {
    return String(v);
  }
}

function formatStep(step: EpisodeStep): string {
  switch (step.kind) {
    case "reducer": {
      const diffs = step["slot-diffs"]
        .map((d) => `${d.name}: ${safeStringify(d.before, 0)} → ${safeStringify(d.after, 0)}`)
        .join(", ");
      return `[reducer] ${step.name}${diffs ? `  ${diffs}` : ""}`;
    }
    case "effect-start":
      return `[effect-start] ${step.name}(${safeStringify(step.args, 0)})`;
    case "effect-end":
      return `[effect-end] ${step.name} ${step.result} = ${safeStringify(step.value, 0)}`;
    case "effect-cancel":
      return `[effect-cancel] ${step.targetId}`;
    case "signal-update":
      return `[signal-update] dirty=[${step["dirty-slots"].join(",")}]`;
    case "panic":
      return `[panic] ${step.message}${step.location ? `  @ ${step.location}` : ""}`;
  }
}

function formatTileTree(app: AppShape): string {
  const root = app.root;
  if (typeof root !== "function") return "(no root tile)";
  try {
    const node = root();
    return renderTileNode(node, 0);
  } catch (e) {
    return `(tree unavailable: ${(e as Error).message})`;
  }
}

type TileNode = { kind?: string; name?: string; children?: TileNode[] };

function renderTileNode(node: unknown, depth: number): string {
  if (node === null || typeof node !== "object") return `${"  ".repeat(depth)}${String(node)}`;
  const n = node as TileNode;
  const label = n.name ?? n.kind ?? "(unknown)";
  const head = `${"  ".repeat(depth)}- ${label}`;
  const kids = Array.isArray(n.children) ? n.children : [];
  if (kids.length === 0) return head;
  return [head, ...kids.map((k) => renderTileNode(k, depth + 1))].join("\n");
}
