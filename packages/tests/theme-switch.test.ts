// style.md §4.6: with `app.theme = <slot>`, changing the slot re-themes every
// tile, including those whose own props did not change. Token props resolve to
// literal values when a tile renders, so the check here is the one a reader
// can make: after a switch each styled element carries what a fresh mount
// under the new theme gives it. The corpus example (`157-theme-switch`) shows
// the switch surviving interaction; a scenario cannot read an inline style.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppShape } from "@kumikijs/runtime";
import { hydrate, mount, renderToString } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(here, "..", "examples", "features", "157-theme-switch.kumiki"),
  "utf8",
);
const STARTS_DARK = SRC.replace(
  'slot themeName : Text = "Light"',
  'slot themeName : Text = "Dark"',
);

const IDS = ["sw", "inner"] as const;

function styles(root: HTMLElement): Record<string, string | null> {
  return Object.fromEntries(
    IDS.map((id) => [id, root.querySelector(`#${id}`)?.getAttribute("style") ?? null]),
  );
}

function host(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

async function paintedAt(src: string): Promise<Record<string, string | null>> {
  const root = host();
  const handle = mount(await loadSource(src), root);
  const out = styles(root);
  handle.dispose();
  root.remove();
  return out;
}

async function toggle(root: HTMLElement): Promise<void> {
  const btn = Array.from(root.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Toggle theme"),
  );
  btn?.click();
  await new Promise((r) => setTimeout(r, 0));
}

describe("switching app.theme through its slot", () => {
  it("repaints unchanged tiles, nested ones included, with the new theme's values", async () => {
    const light = await paintedAt(SRC);
    const dark = await paintedAt(STARTS_DARK);
    // The two themes really do paint these elements differently.
    expect(dark.sw).not.toBe(light.sw);
    expect(dark.inner).not.toBe(light.inner);
    expect(dark.sw).toContain("32px");
    expect(dark.sw).toContain("#1c1c1c");

    const root = host();
    const handle = mount(await loadSource(SRC), root);
    expect(styles(root)).toEqual(light);
    await toggle(root);
    expect(styles(root)).toEqual(dark);
    await toggle(root);
    expect(styles(root)).toEqual(light);
    handle.dispose();
    root.remove();
  });

  it("repaints the same way after hydrating server HTML", async () => {
    const dark = await paintedAt(STARTS_DARK);
    const app: AppShape = await loadSource(SRC);
    const rendered = await renderToString(app);
    delete app.live;
    const root = host();
    root.innerHTML = rendered.html;
    const handle = hydrate(app, root, rendered);
    await toggle(root);
    expect(styles(root)).toEqual(dark);
    handle.dispose();
    root.remove();
  });
});
