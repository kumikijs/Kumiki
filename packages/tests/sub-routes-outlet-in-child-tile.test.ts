// A `sub-routes` parent's `route-outlet` may sit in a tile the parent renders.
//
// The runtime fills the first `route-outlet` in the tree the parent's factory
// builds (routing.md §3.6.3), and code generation builds that tree by inlining
// every tile the parent's body expands into. So an outlet in a layout helper —
// named bare, called, any number of tiles down — is in the parent's tree, and
// the matched child renders there. E0113 reads the same expansion, so each
// program below checks, builds, and renders the child inside the outlet.
//
// These run the real pipeline and the real runtime: `loadSource` refuses a
// program `check` refuses, so what is asserted is that what `check` accepts is
// what renders.

import { type AppShape, mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSource } from "./helpers/load.ts";

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

const HEAD = `tile NotFound = page(heading("404"))
tile AccountSettings = page(heading("Account settings"))`;

const app = (routes: string) => `app M
    caps   = []
    routes = {${routes}}
    init   = []`;

const PARENT_ROUTES = `"/settings/*" -> SettingsLayout, "/404" -> NotFound`;

/** `SettingsLayout` with one sub-route, rendering `body`. */
const layout = (body: string) => `tile SettingsLayout
    sub-routes = { "/settings/account" -> AccountSettings }
    = ${body}`;

describe("a sub-routes parent whose outlet is in a tile it renders", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  const at = async (src: string, path: string) => {
    const loaded: AppShape = await loadSource(src);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    const { dispose } = mount(loaded, root, { router: "memory" });
    cleanup = () => {
      dispose();
      root.remove();
      spy.mockRestore();
    };
    await tick();
    (loaded as AppShape & { _navigate: (p: string, replace?: boolean) => void })._navigate(
      path,
      false,
    );
    await tick();
    const outlet = root.querySelector('[data-kumiki-tile="route-outlet"]');
    return { root, outlet, errors };
  };

  const forms: [string, string][] = [
    // The program the report was filed with, verbatim.
    [
      "a helper named bare",
      `tile Outlet = column(route-outlet())
${layout(`page(heading("Settings"), Outlet)`)}`,
    ],
    [
      "a helper called",
      `tile Outlet = column(route-outlet())
${layout(`page(heading("Settings"), Outlet())`)}`,
    ],
    [
      "a helper more than one tile down",
      `tile Inner = column(route-outlet())
tile Middle = row(Inner())
tile Outlet = column(Middle)
${layout(`page(heading("Settings"), Outlet)`)}`,
    ],
    [
      "a helper that takes an input",
      `tile Frame in=Text = column(heading($1), route-outlet())
${layout(`page(Frame("Settings"))`)}`,
    ],
    [
      "a helper named as a child of a builtin container",
      `tile Outlet = column(route-outlet())
${layout(`page(heading("Settings"), card(Outlet))`)}`,
    ],
  ];
  for (const [what, defs] of forms) {
    it(`renders the child in ${what}`, async () => {
      const { root, outlet, errors } = await at(
        `${HEAD}\n${defs}\n${app(PARENT_ROUTES)}\n`,
        "/settings/account",
      );
      expect(root.textContent).toContain("Settings");
      expect(outlet?.textContent).toBe("Account settings");
      expect(errors).toEqual([]);
    });
  }

  // A tile that declares `sub-routes` of its own is, rendered inside another
  // parent, a helper like any other: its body is inlined into that parent's
  // tree, and its outlet is the first one there. Its own `sub-routes` apply
  // where it is the route target — and there the same outlet shows its child.
  const NESTED = `${HEAD}
tile InnerChild = page(heading("Inner child"))
tile Inner
    sub-routes = { "/inner/a" -> InnerChild }
    = column(heading("Inner"), route-outlet())
${layout(`page(heading("Settings"), Inner)`)}
${app(`"/settings/*" -> SettingsLayout, "/inner/*" -> Inner, "/404" -> NotFound`)}
`;

  it("renders the child in the outlet of a tile that declares sub-routes of its own", async () => {
    const { root, outlet, errors } = await at(NESTED, "/settings/account");
    expect(root.textContent).toContain("Settings");
    expect(outlet?.textContent).toBe("Account settings");
    expect(errors).toEqual([]);
  });

  it("fills that tile's outlet with its own child where it is the route target", async () => {
    const { root, outlet, errors } = await at(NESTED, "/inner/a");
    expect(root.textContent).not.toContain("Settings");
    expect(outlet?.textContent).toBe("Inner child");
    expect(errors).toEqual([]);
  });
});
