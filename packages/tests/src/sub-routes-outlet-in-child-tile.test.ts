import { afterEach, describe, expect, it, vi } from "vitest";
import { mountApp, navigate, tick } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";

const HEAD = `tile NotFound = page(heading("404"))
tile AccountSettings = page(heading("Account settings"))`;

const app = (routes: string) => `app M
    caps   = []
    routes = {${routes}}
    init   = []`;

const PARENT_ROUTES = `"/settings/*" -> SettingsLayout, "/404" -> NotFound`;

const layout = (body: string) => `tile SettingsLayout
    sub-routes = { "/settings/account" -> AccountSettings }
    = ${body}`;

describe("a sub-routes parent whose outlet is in a tile it renders", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  /** Mount at `/` and navigate to `path`, or, with `deepLink`, mount at `path` itself. */
  const at = async (src: string, path: string, { deepLink = false } = {}) => {
    const loaded = await loadSource(src);
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    const { root, handle } = mountApp(loaded, {
      router: "memory",
      ...(deepLink && { initialPath: path }),
    });
    cleanup = () => {
      handle.dispose();
      root.remove();
      spy.mockRestore();
    };
    await tick(0);
    if (!deepLink) await navigate(loaded, path);
    const outlet = root.querySelector('[data-kumiki-tile="route-outlet"]');
    return { root, outlet, errors };
  };

  it.each([
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
  ])("renders the child in %s", async (_, defs) => {
    const { root, outlet, errors } = await at(
      `${HEAD}\n${defs}\n${app(PARENT_ROUTES)}\n`,
      "/settings/account",
    );
    expect(root.textContent).toContain("Settings");
    expect(outlet?.textContent).toBe("Account settings");
    expect(errors).toEqual([]);
  });

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

  it.each([
    ["named bare", "Shell"],
    ["called", "Shell()"],
  ])("renders the child, on a deep link, when the parent's body is the helper %s", async (_, body) => {
    const src = `${HEAD}
tile Shell = column(heading("Settings"), route-outlet())
${layout(body)}
${app(PARENT_ROUTES)}
`;
    const { root, outlet, errors } = await at(src, "/settings/account", { deepLink: true });
    expect(root.textContent).toContain("Settings");
    expect(outlet?.textContent).toBe("Account settings");
    expect(errors).toEqual([]);
  });

  const branch = (shown: boolean) => `${HEAD}
slot shown : Bool = ${shown}
tile Outlet = column(when(shown, route-outlet()))
${layout(`page(heading("Settings"), Outlet)`)}
${app(PARENT_ROUTES)}
`;

  it("renders the child in a helper's outlet under a branch that renders", async () => {
    const { outlet, errors } = await at(branch(true), "/settings/account");
    expect(outlet?.textContent).toBe("Account settings");
    expect(errors).toEqual([]);
  });

  it("reports the discarded child when that branch does not render", async () => {
    const { root, outlet, errors } = await at(branch(false), "/settings/account");
    expect(outlet).toBeNull();
    expect(root.textContent).not.toContain("Account settings");
    expect(errors.map((args) => String(args[0]))).toEqual([
      `[kumiki] route "/settings/*" matched sub-route "/settings/account" but tile "SettingsLayout" rendered no route-outlet — the child was discarded`,
    ]);
  });

  it("covers the child with the parent's error boundary, not the helper's that holds the outlet", async () => {
    // The child is filled in after the helper's boundary has returned.
    const src = `slot xs : List(Int) = []
tile NotFound = page(heading("404"))
tile AccountSettings = page(text(xs.head.get.show))
tile HelperFallback in=PanicInfo = column(text("helper fallback"))
tile ShellFallback in=PanicInfo = column(text("shell fallback"))
tile Outlet error-boundary=HelperFallback = column(route-outlet())
tile SettingsLayout
    error-boundary = ShellFallback
    sub-routes = { "/settings/account" -> AccountSettings }
    = page(heading("Settings"), Outlet())
${app(PARENT_ROUTES)}
`;
    const { root } = await at(src, "/settings/account");
    expect(root.textContent).toContain("shell fallback");
    expect(root.textContent).not.toContain("helper fallback");
  });
});
