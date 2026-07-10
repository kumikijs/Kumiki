// Input tile renderers (#71): interactive controls (button, input, textarea,
// check, radio, select, slider, switch, form). `bind=` controls write back to
// their slot through the owning mount's `_setSlot`, resolved from the control
// element via the multi-mount app registry (`resolveApp` in core) so several
// apps on one page never cross-wire.

import type { AppShape, TileCtx, TileNode, TileRenderers } from "./core.ts";
import { _setPathHelper, resolveApp } from "./core.ts";

type LiveApp = AppShape & {
  _setSlot?: (n: string, v: unknown) => void;
  live?: Record<string, unknown>;
};

/** The app owning the mount tree `el` sits in, typed for slot write-back. */
function liveApp(el: Element): LiveApp | undefined {
  return resolveApp(el) as LiveApp | undefined;
}

function writeBind(
  app: LiveApp,
  slotName: string,
  bindPath: string[] | undefined,
  value: unknown,
): void {
  if (!app._setSlot) return;
  if (bindPath && bindPath.length > 0) {
    const current = app.live?.[slotName] ?? {};
    app._setSlot(slotName, _setPathHelper(current, bindPath, value));
  } else {
    app._setSlot(slotName, value);
  }
}

function bindDataset(el: HTMLElement, bind: string, bindPath: string[] | undefined): void {
  const fullPath = bindPath && bindPath.length > 0 ? `${bind}.${bindPath.join(".")}` : bind;
  el.dataset.kumikiBind = fullPath;
}

// §1.6.2 — `{id: "..."}` on any tile maps to the element's native HTML `id`.
// Read from both `node.id` (top-level field; populated for tiles that lift
// `id` from positional args, e.g. `input(id="..")`) and `node.props.id`
// (block-style `{id: "..."}` for any tile kind). Used only by tile rendering;
// the `el.id` payload that feeds selector matching is built separately in
// codegen's `propsFor` so the two paths stay decoupled.
function tileId(node: { id?: unknown; props?: unknown }): string | undefined {
  const fromProps = (node.props as { id?: unknown } | undefined)?.id;
  const raw = node.id ?? fromProps;
  return raw == null ? undefined : String(raw);
}

export const inputTiles: TileRenderers = {
  button(node) {
    const b = document.createElement("button");
    b.dataset.kumikiTile = "button";
    b.textContent = node.text;
    if (node.disabled) b.disabled = true;
    const id = tileId(node);
    if (id) b.id = id;
    if (node.props?.onClick) {
      b.addEventListener("click", (e) => {
        e.preventDefault();
        node.props?.onClick?.(node.props?.el ?? {});
      });
    }
    return b;
  },
  input(node) {
    const inp = document.createElement("input");
    inp.dataset.kumikiTile = "input";
    inp.type = node.type ?? "text";
    if (node.placeholder) inp.placeholder = node.placeholder;
    if (node.required) inp.required = true;
    if (node.autoFocus) inp.autofocus = true;
    const id = tileId(node);
    if (id) inp.id = id;
    if (node.accept) inp.accept = String(node.accept);
    if (node.multiple) inp.multiple = true;
    const isFile = inp.type === "file";
    // File inputs reject programmatic `.value` assignment (security) and have no
    // text representation worth pre-populating; the picked-file state lives in
    // the slot, not in the DOM. bind= is undefined for files (spec §5.1.1 table).
    if (!isFile) {
      if (node.bind) bindDataset(inp, node.bind, node.bindPath);
      inp.value = node.value ?? "";
      if (node.bind) {
        const slotName = node.bind;
        const bindPath = node.bindPath;
        inp.addEventListener("input", () => {
          const app = liveApp(inp);
          if (!app?._setSlot) return;
          writeBind(app, slotName, bindPath, inp.value);
        });
      }
    }
    if (node.props?.onInput) {
      inp.addEventListener("input", () => {
        node.props?.onInput?.({ ...(node.props?.el ?? {}), value: inp.value });
      });
    }
    if (node.props?.onChange) {
      inp.addEventListener("change", () => {
        if (isFile) {
          // FileList → plain records the Kumiki layer can read: name / size /
          // type are visible to Kumiki expressions; `_file` keeps the original
          // DOM File so `file-url()` can hand it to URL.createObjectURL and a
          // future http effect can wrap it in Multipart.
          const list = inp.files;
          const files: Array<{ name: string; size: number; type: string; _file: File }> = [];
          if (list) {
            for (let i = 0; i < list.length; i++) {
              const f = list[i];
              if (f) files.push({ name: f.name, size: f.size, type: f.type, _file: f });
            }
          }
          node.props?.onChange?.({ ...(node.props?.el ?? {}), files });
        } else {
          node.props?.onChange?.({ ...(node.props?.el ?? {}), value: inp.value });
        }
      });
    }
    return inp;
  },
  textarea(node) {
    const ta = document.createElement("textarea");
    ta.dataset.kumikiTile = "textarea";
    if (node.rows) ta.rows = node.rows;
    if (node.placeholder) ta.placeholder = node.placeholder;
    const id = tileId(node);
    if (id) ta.id = id;
    if (node.bind) bindDataset(ta, node.bind, node.bindPath);
    ta.value = node.value ?? "";
    if (node.bind) {
      const slotName = node.bind;
      const bindPath = node.bindPath;
      ta.addEventListener("input", () => {
        const app = liveApp(ta);
        if (!app?._setSlot) return;
        writeBind(app, slotName, bindPath, ta.value);
      });
    }
    // ui.input / ui.change reducers targeting a textarea (codegen emits these
    // as onInput / onChange props, just like for `input`). Without this a
    // textarea with `bind` would update its slot but never run its reducer —
    // e.g. 20-effect-storage's `edit` reducer never emits the save effect.
    if (node.props?.onInput) {
      ta.addEventListener("input", () => {
        node.props?.onInput?.({ ...(node.props?.el ?? {}), value: ta.value });
      });
    }
    if (node.props?.onChange) {
      ta.addEventListener("change", () => {
        node.props?.onChange?.({ ...(node.props?.el ?? {}), value: ta.value });
      });
    }
    return ta;
  },
  check(node) {
    const wrap = document.createElement("label");
    wrap.dataset.kumikiTile = "check";
    const id = tileId(node);
    if (id) wrap.id = id;
    const inp = document.createElement("input");
    inp.type = "checkbox";
    inp.checked = node.checked;
    if (node.props?.onClick) {
      inp.addEventListener("change", () => {
        node.props?.onClick?.(node.props?.el ?? {});
      });
    }
    if (node.props?.onChange) {
      inp.addEventListener("change", () => {
        node.props?.onChange?.({ ...(node.props?.el ?? {}), checked: inp.checked });
      });
    }
    wrap.appendChild(inp);
    return wrap;
  },
  radio(node) {
    const wrap = document.createElement("label");
    wrap.dataset.kumikiTile = "radio";
    const id = tileId(node);
    if (id) wrap.id = id;
    const inp = document.createElement("input");
    inp.type = "radio";
    if (node.group) inp.name = String(node.group);
    inp.checked = !!node.selected;
    const labelText = (node.props?.label as string | undefined) ?? "";
    wrap.appendChild(inp);
    if (labelText) {
      const span = document.createElement("span");
      span.textContent = labelText;
      wrap.appendChild(span);
    }
    if (node.props?.onClick) {
      inp.addEventListener("change", () => {
        node.props?.onClick?.(node.props?.el ?? {});
      });
    }
    if (node.props?.onChange) {
      inp.addEventListener("change", () => {
        node.props?.onChange?.({ ...(node.props?.el ?? {}), checked: inp.checked });
      });
    }
    return wrap;
  },
  select(node) {
    const sel = document.createElement("select");
    sel.dataset.kumikiTile = "select";
    const id = tileId(node);
    if (id) sel.id = id;
    const options = (node.options ?? []) as Array<{ label: unknown; value: unknown }>;
    const currentValue = node.value;
    // Serialize a value to a stable key. Must recurse into variant payloads
    // so `Some(Backlog)` and `Some(InProgress)` map to distinct keys (a flat
    // `_tag`-only key would collide on the outer "Some").
    const valueKey = (v: unknown): string => {
      if (v && typeof v === "object" && "_tag" in (v as Record<string, unknown>)) {
        const t = v as Record<string, unknown>;
        const parts: string[] = [String(t._tag)];
        for (let i = 0; `_${i}` in t; i++) parts.push(valueKey(t[`_${i}`]));
        return parts.join("|");
      }
      return JSON.stringify(v);
    };
    const currentKey = valueKey(currentValue);
    if (node.placeholder) {
      const ph = document.createElement("option");
      ph.value = "";
      ph.textContent = String(node.placeholder);
      ph.disabled = true;
      if (currentValue == null) ph.selected = true;
      sel.appendChild(ph);
    }
    for (const opt of options) {
      const o = document.createElement("option");
      const k = valueKey(opt.value);
      o.value = k;
      o.textContent = String(opt.label);
      if (k === currentKey) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => {
      const k = sel.value;
      const matched = options.find((o) => valueKey(o.value) === k);
      if (matched === undefined) return;
      const app = liveApp(sel);
      if (node.bind && app?._setSlot) {
        writeBind(app, node.bind, node.bindPath, matched.value);
      }
      // Fire onChange handler (set up by `ui.change(SelectTile)` reducers) so
      // both bound and unbound select tiles can drive logic that reads $event.value.
      if (node.props?.onChange) {
        node.props.onChange({ ...(node.props.el ?? {}), value: matched.value });
      }
    });
    return sel;
  },
  slider(node) {
    const inp = document.createElement("input");
    inp.dataset.kumikiTile = "slider";
    inp.type = "range";
    const id = tileId(node);
    if (id) inp.id = id;
    if (typeof node.min === "number") inp.min = String(node.min);
    if (typeof node.max === "number") inp.max = String(node.max);
    if (typeof node.step === "number") inp.step = String(node.step);
    if (node.bind) bindDataset(inp, node.bind, node.bindPath);
    if (node.value != null) inp.value = String(node.value);
    if (node.bind) {
      const slotName = node.bind;
      const bindPath = node.bindPath;
      inp.addEventListener("input", () => {
        const app = liveApp(inp);
        if (!app?._setSlot) return;
        writeBind(app, slotName, bindPath, Number(inp.value));
      });
    }
    if (node.props?.onChange) {
      inp.addEventListener("change", () => {
        node.props?.onChange?.({ ...(node.props?.el ?? {}), value: Number(inp.value) });
      });
    }
    return inp;
  },
  switch(node) {
    const wrap = document.createElement("label");
    wrap.dataset.kumikiTile = "switch";
    wrap.setAttribute("role", "switch");
    const id = tileId(node);
    if (id) wrap.id = id;
    const inp = document.createElement("input");
    inp.type = "checkbox";
    inp.checked = node.checked;
    if (node.props?.onClick) {
      inp.addEventListener("change", () => {
        node.props?.onClick?.(node.props?.el ?? {});
      });
    }
    if (node.props?.onChange) {
      inp.addEventListener("change", () => {
        node.props?.onChange?.({ ...(node.props?.el ?? {}), checked: inp.checked });
      });
    }
    wrap.appendChild(inp);
    return wrap;
  },
  form(node, ctx: TileCtx) {
    const form = document.createElement("form");
    form.dataset.kumikiTile = "form";
    const id = tileId(node);
    if (id) form.id = id;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (node.props?.onSubmit) node.props.onSubmit(node.props.el ?? {});
    });
    for (const child of node.children as TileNode[]) {
      if (child != null) form.appendChild(ctx.render(child));
    }
    return form;
  },
};
