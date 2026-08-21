// Icon renderer (#101) — built-in path lookup, theme.icons override, props,
// and graceful placeholder fallback when neither registry knows a name.

import type { AppShape } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CHECK_PATH = "M4 12l6 6L20 6";
const CUSTOM_CHECK = "M0 0 L24 24";
const LOGO_PATH = "M3 3h18v18H3z";

function makeIconApp(opts: {
  appIcons?: Record<string, string>;
  themeIcons?: Record<string, string>;
  iconName?: string;
  iconProps?: Record<string, unknown>;
}): AppShape {
  return {
    slots: {},
    caps: [],
    effects: {},
    init: [],
    reducers: [],
    ...(opts.appIcons ? { icons: opts.appIcons } : {}),
    ...(opts.themeIcons
      ? {
          themes: { T: { colors: { success: "#16a34a" }, icons: opts.themeIcons } },
          themeName: "T",
        }
      : {}),
    root: () => ({
      kind: "icon",
      name: opts.iconName ?? "check",
      ...(opts.iconProps ? { props: opts.iconProps } : {}),
    }),
  };
}

function rootSpan(host: HTMLElement): HTMLSpanElement {
  const span = host.querySelector('[data-kumiki-tile="icon"]');
  if (!span) throw new Error("icon span not found in mount host");
  return span as HTMLSpanElement;
}

describe("icon renderer", () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  it("renders the compile-baked built-in path when no theme override is set", () => {
    mount(makeIconApp({ appIcons: { check: CHECK_PATH } }), host);
    const span = rootSpan(host);
    expect(span.dataset.kumikiIconName).toBe("check");
    const svg = span.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg?.getAttribute("fill")).toBe("currentColor");
    expect(svg?.querySelector("path")?.getAttribute("d")).toBe(CHECK_PATH);
  });

  it("theme.icons[name] overrides the compile-baked built-in", () => {
    mount(
      makeIconApp({
        appIcons: { check: CHECK_PATH },
        themeIcons: { check: CUSTOM_CHECK },
      }),
      host,
    );
    expect(rootSpan(host).querySelector("path")?.getAttribute("d")).toBe(CUSTOM_CHECK);
  });

  it("theme.icons fills names absent from the built-in registry", () => {
    mount(
      makeIconApp({
        themeIcons: { logo: LOGO_PATH },
        iconName: "logo",
      }),
      host,
    );
    expect(rootSpan(host).querySelector("path")?.getAttribute("d")).toBe(LOGO_PATH);
  });

  it("falls back to a [name] placeholder when neither registry has the name", () => {
    mount(makeIconApp({ iconName: "unknown-icon" }), host);
    const span = rootSpan(host);
    expect(span.querySelector("svg")).toBeNull();
    expect(span.textContent).toBe("[unknown-icon]");
  });

  it("size tokens map to pixel dimensions on the inner <svg>", () => {
    mount(
      makeIconApp({
        appIcons: { check: CHECK_PATH },
        iconProps: { size: "lg" },
      }),
      host,
    );
    const svg = rootSpan(host).querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("32px");
    expect(svg?.getAttribute("height")).toBe("32px");
  });

  it("numeric size is taken as px", () => {
    mount(
      makeIconApp({
        appIcons: { check: CHECK_PATH },
        iconProps: { size: 20 },
      }),
      host,
    );
    expect(rootSpan(host).querySelector("svg")?.getAttribute("width")).toBe("20px");
  });

  it("color is applied to the wrapping span (SVG inherits via currentColor)", () => {
    mount(
      makeIconApp({
        appIcons: { check: CHECK_PATH },
        themeIcons: { check: CHECK_PATH },
        iconProps: { color: "success" },
      }),
      host,
    );
    expect(rootSpan(host).style.color).toBe("#16a34a");
  });
});
