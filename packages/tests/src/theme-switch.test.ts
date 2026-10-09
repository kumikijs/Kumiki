import { readFileSync } from "node:fs";
import { feature } from "@kumikijs/examples";
import type { AppShape } from "@kumikijs/runtime";
import { hydrate, mount, renderToString } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

const SRC = readFileSync(feature("157-theme-switch"), "utf8");
const STARTS_DARK = SRC.replace(
  'slot themeName : Text = "Light"',
  'slot themeName : Text = "Dark"',
);

// The variants below add one thing each to the example, so a failure points at what that thing does across a switch.
const WITH_INPUT = SRC.replace(
  'slot themeName : Text = "Light"',
  'slot themeName : Text = "Light"\nslot name : Text = "hello"',
).replace(
  'tile App    = page(text("theme: " + themeName), ToggleBtn, Swatch)',
  'tile App    = page(text("theme: " + themeName), ToggleBtn, input(bind=name, id="name"), Swatch)',
);
const WITH_REFUSED = SRC.replace(
  'slot themeName : Text = "Light"',
  'slot themeName : Text = "Light"\nslot contact : Text where email = "ada@example.com"',
).replace(
  'tile App    = page(text("theme: " + themeName), ToggleBtn, Swatch)',
  'tile App    = page(text("theme: " + themeName), ToggleBtn, input(bind=contact, id="contact"), error(field=contact) {id: "contact-err"}, Swatch)',
);
const WITH_MOTION = SRC.replace(
  'slot themeName : Text = "Light"',
  'slot themeName : Text = "Light"\nslot shown : Bool = false\nreducer reveal on=ui.click(RevealBtn) do= shown := true',
)
  .replace(
    'tile Swatch = box(text("swatch"), Inner) {bg: "surface", color: "fg", pad: "md", gap: "sm", id: "sw"}',
    'tile Swatch = box(text("swatch"), Inner) {bg: "surface", color: "fg", pad: "md", gap: "sm", id: "sw", transition: "fade"}\n' +
      'motion Rise = {keyframes: {from: {opacity: 0}, to: {opacity: 1}}, duration: "slow"}\n' +
      'tile Risen = box(text("risen")) {motion: "Rise", id: "risen"}\n' +
      'tile Late = box(text("late")) {transition: "fade", id: "late"}\n' +
      'tile RevealBtn = button(text="Reveal", onClick=reveal)',
  )
  .replace(
    'tile App    = page(text("theme: " + themeName), ToggleBtn, Swatch)',
    'tile App    = page(text("theme: " + themeName), ToggleBtn, RevealBtn, Swatch, Risen, when(shown, Late()))',
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

async function press(root: HTMLElement, label: string): Promise<void> {
  const btn = Array.from(root.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(label),
  );
  if (!btn) throw new Error(`no "${label}" button`);
  // `click()` dispatches the event without moving focus, so a control that was focused before the toggle is still the one focused when it runs.
  btn.click();
  await new Promise((r) => setTimeout(r, 0));
}

const toggle = (root: HTMLElement): Promise<void> => press(root, "Toggle theme");

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

  it("repaints a second view of the app, added by mounting the same shape again", async () => {
    const dark = await paintedAt(STARTS_DARK);
    const light = await paintedAt(SRC);
    const app = await loadSource(SRC);
    const first = host();
    const second = host();
    const one = mount(app, first);
    const two = mount(app, second);
    expect(styles(second)).toEqual(light);
    await toggle(first);
    expect(styles(first)).toEqual(dark);
    expect(styles(second)).toEqual(dark);
    two.dispose();
    one.dispose();
    first.remove();
    second.remove();
  });

  it("gives a focused control its focus and selection back on the rebuilt element", async () => {
    const root = host();
    const handle = mount(await loadSource(WITH_INPUT), root);
    const before = root.querySelector<HTMLInputElement>("#name");
    if (!before) throw new Error("#name not found");
    before.focus();
    before.setSelectionRange(1, 3);
    await toggle(root);
    const after = root.querySelector<HTMLInputElement>("#name");
    expect(after).not.toBe(before);
    expect(document.activeElement).toBe(after);
    expect([after?.selectionStart, after?.selectionEnd]).toEqual([1, 3]);
    handle.dispose();
    root.remove();
  });

  it("drops a refused bind's text and its field error, like other DOM state no slot holds", async () => {
    // The refused text lives only in the control the switch replaces. The rebuilt control shows the value the slot kept.
    const root = host();
    const handle = mount(await loadSource(WITH_REFUSED), root);
    const before = root.querySelector<HTMLInputElement>("#contact");
    if (!before) throw new Error("#contact not found");
    before.value = "ada@examplecom";
    before.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    const shownError = root.querySelector("#contact-err")?.textContent ?? "";
    expect(shownError).toContain("Invalid email");
    await toggle(root);
    expect(root.querySelector<HTMLInputElement>("#contact")?.value).toBe("ada@example.com");
    expect(root.querySelector("#contact-err")?.textContent ?? "").not.toContain("Invalid email");
    handle.dispose();
    root.remove();
  });

  it("does not replay enter animations on the elements it rebuilds", async () => {
    // A CSS animation starts whenever its element is inserted, so the rebuilt tree would fade and rise in again.
    // The switch marks what it rebuilt as settled, and the injected motion stylesheet moves a settled element's animation straight to its end (the browser tier checks it plays that way).
    const root = host();
    const handle = mount(await loadSource(WITH_MOTION), root);
    const settled = (id: string): boolean =>
      root.querySelector(`#${id}`)?.hasAttribute("data-kumiki-settled") ?? false;
    // A first mount animates.
    expect(root.querySelector("#sw")?.classList.contains("kumiki-anim")).toBe(true);
    expect(root.querySelector("#risen")?.classList.contains("kumiki-motion")).toBe(true);
    expect([settled("sw"), settled("risen")]).toEqual([false, false]);

    await toggle(root);
    expect([settled("sw"), settled("risen")]).toEqual([true, true]);
    // The classes stay, so a settled element keeps its end state (fill-mode).
    expect(root.querySelector("#sw")?.classList.contains("kumiki-anim")).toBe(true);
    expect(root.querySelector("#risen")?.classList.contains("kumiki-motion")).toBe(true);
    expect(document.getElementById("kumiki-motions")?.textContent).toContain(
      "[data-kumiki-settled]",
    );

    // An ordinary re-render after the switch still animates what it inserts.
    await press(root, "Reveal");
    expect(root.querySelector("#late")?.classList.contains("kumiki-anim")).toBe(true);
    expect(settled("late")).toBe(false);
    handle.dispose();
    root.remove();
  });
});
