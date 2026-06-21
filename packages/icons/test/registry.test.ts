import { describe, expect, it } from "vitest";
import { ALL_ICONS, check, ICON_NAMES, plus } from "../src/index.ts";

// The spec/style.md §4.8.1 closed name set, sorted lexicographically. Any
// addition / removal must land in spec, README, and this list in lockstep —
// the test pins the surface so silent drift can't happen.
const SPEC_NAMES: readonly string[] = [
  "alert-circle",
  "alert-triangle",
  "arrow-down",
  "arrow-down-left",
  "arrow-left",
  "arrow-right",
  "arrow-up",
  "arrow-up-right",
  "bell",
  "bookmark",
  "calendar",
  "camera",
  "caret-down",
  "caret-up",
  "check",
  "check-circle",
  "chevron-down",
  "chevron-left",
  "chevron-right",
  "chevron-up",
  "chevrons-left",
  "chevrons-right",
  "clipboard",
  "clock",
  "copy",
  "download",
  "edit",
  "external-link",
  "eye",
  "eye-off",
  "file",
  "file-text",
  "filter",
  "folder",
  "folder-open",
  "heart",
  "help-circle",
  "home",
  "image",
  "info",
  "key",
  "link",
  "lock",
  "mail",
  "menu",
  "microphone",
  "minus",
  "moon",
  "more-horizontal",
  "more-vertical",
  "paperclip",
  "pencil",
  "phone",
  "plus",
  "print",
  "refresh",
  "save",
  "search",
  "settings",
  "share",
  "shield-check",
  "shield-exclamation",
  "star",
  "sun",
  "trash",
  "unlock",
  "upload",
  "user",
  "users",
  "wifi",
  "x",
  "x-circle",
];

describe("@kumikijs/icons", () => {
  it("exports named SVG path data for documented icons", () => {
    expect(typeof check).toBe("string");
    expect(check.length).toBeGreaterThan(0);
    expect(typeof plus).toBe("string");
    expect(plus.length).toBeGreaterThan(0);
  });

  it("groups every named export into ALL_ICONS keyed by spec-form name", () => {
    expect(ALL_ICONS.check).toBe(check);
    expect(ALL_ICONS["check-circle"]).toBeDefined();
    expect(ALL_ICONS["external-link"]).toBeDefined();
  });

  it("ICON_NAMES matches spec/style.md §4.8.1 exactly", () => {
    expect(ICON_NAMES).toEqual(SPEC_NAMES);
  });

  it("ICON_NAMES and ALL_ICONS expose the same key set", () => {
    expect([...Object.keys(ALL_ICONS)].sort()).toEqual([...ICON_NAMES]);
  });

  it("every ALL_ICONS value starts with an SVG move command", () => {
    for (const [name, d] of Object.entries(ALL_ICONS)) {
      expect(d, `${name} should be a valid SVG path-d`).toMatch(/^[Mm]/);
    }
  });
});
