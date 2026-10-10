import { describe, expect, it } from "vitest";
import { checkSource } from "./helpers/diagnostics.ts";

describe("sub-routes", () => {
  const nested = (parentPath: string, extra = "") => `
    tile NotFound = page(heading("404"))
    tile Account = page(heading("account"))
    tile SettingsHome = page(heading("home"))
    tile SettingsLayout
      sub-routes = {
        "/settings/account" -> Account,
        "/settings"         -> SettingsHome${extra}
      }
      = page(route-outlet())
    app A caps=[] routes={
      "${parentPath}" -> SettingsLayout,
      "/404" -> NotFound
    } init=[]
  `;

  it("accepts a wildcard parent with valid sub-routes", () => {
    expect(checkSource(nested("/settings/*"))).toEqual([]);
  });

  it("reports an undefined sub-route target as E0105", () => {
    const src = `
      tile NotFound = page(heading("404"))
      tile Layout sub-routes = { "/x" -> Missing } = page(route-outlet())
      app A caps=[] routes={ "/x/*" -> Layout, "/404" -> NotFound } init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0105" && e.message.includes("Missing"))).toBe(true);
  });

  it("reports a non-wildcard parent as E0114", () => {
    const errors = checkSource(nested("/settings"));
    expect(
      errors.some((e) => e.code === "E0114" && e.kind === "sub-routes-without-wildcard-parent"),
    ).toBe(true);
  });

  it("reports orphan sub-routes (tile not reachable from app.routes) as E0111", () => {
    const src = `
      tile NotFound = page(heading("404"))
      tile Account = page(heading("a"))
      tile Orphan sub-routes = { "/x" -> Account } = page(route-outlet())
      tile App = page(heading("root"))
      app A caps=[] routes={ "/" -> App, "/404" -> NotFound } init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0111" && e.kind === "orphan-sub-routes")).toBe(true);
  });

  it("reports duplicate sub-route paths as E0112", () => {
    const src = `
      tile NotFound = page(heading("404"))
      tile Account = page(heading("a"))
      tile Layout
        sub-routes = {
          "/x/a" -> Account,
          "/x/a" -> Account
        }
        = page(route-outlet())
      app A caps=[] routes={ "/x/*" -> Layout, "/404" -> NotFound } init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0112" && e.kind === "duplicate-sub-route")).toBe(true);
  });

  it("reports a parent without route-outlet in its body as E0113", () => {
    const src = `
      tile NotFound = page(heading("404"))
      tile Account = page(heading("a"))
      tile Layout
        sub-routes = { "/x/a" -> Account }
        = page(heading("settings"))
      app A caps=[] routes={ "/x/*" -> Layout, "/404" -> NotFound } init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0113" && e.kind === "sub-routes-without-outlet")).toBe(
      true,
    );
  });
});
