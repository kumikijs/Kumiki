import { describe, expect, it } from "vitest";
import { find, mountApp } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";

/** A real second route, so a click that IS taken over shows in what renders, not only in `defaultPrevented`. */
const linkSource = (to: string, props: string): string => `
tile Home = column(link(to="${to}", text="docs") ${props})
tile Next = text("arrived at next")

app P
    caps   = []
    routes = {"/" -> Home, "/next" -> Next, "/404" -> Home}
    init   = []
`;

type Clicked = { intercepted: boolean; html: string; warnings: string[] };

/**
 * Click the link and report whether the runtime took the navigation over.
 *
 * The click is cancelled from a bubble-phase listener on `window` after it is observed: happy-dom really navigates an un-cancelled anchor click, and moving `location` to another origin (or, for `mailto:`, to an opaque one) would leave the rest of the file asserting against the wrong origin.
 */
async function clickLink(
  to: string,
  props = "{}",
  opts: { again?: boolean; router?: "history" | "memory" } = {},
): Promise<Clicked> {
  const app = await loadSource(linkSource(to, props));
  const { root } = mountApp(app, opts.router ? { router: opts.router } : {});
  const a = find(root, '[data-kumiki-tile="link"]');
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]): void => {
    warnings.push(args.map(String).join(" "));
  };
  let intercepted = false;
  const guard = (e: Event): void => {
    intercepted = e.defaultPrevented;
    e.preventDefault();
  };
  window.addEventListener("click", guard);
  try {
    const fire = (): void =>
      void a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    fire();
    if (opts.again) fire();
    return { intercepted, html: root.textContent ?? "", warnings };
  } finally {
    window.removeEventListener("click", guard);
    console.warn = origWarn;
    root.remove();
    window.history.replaceState(null, "", "/");
  }
}

describe("a link the router can serve is routed through the app", () => {
  const served: { what: string; to: () => string; router?: "memory" }[] = [
    { what: "a relative link", to: () => "/next" },
    { what: "a relative link under a memory router", to: () => "/next", router: "memory" },
    { what: "an absolute URL to this origin", to: () => `${location.origin}/next` },
    { what: "a protocol-relative URL to this origin", to: () => `//${location.host}/next` },
  ];

  it.each(served)("$what", async ({ to, router }) => {
    const r = await clickLink(to(), "{}", router ? { router } : {});
    expect(r.intercepted).toBe(true);
    expect(r.html).toContain("arrived at next");
  });
});

describe("a link the router cannot serve is left to the browser", () => {
  it("leaves a link marked external", async () => {
    expect((await clickLink("https://example.com", "{external: true}")).intercepted).toBe(false);
  });

  it("leaves an off-origin target even without external, and says which link", async () => {
    // Cancelling it would hand an off-origin URL to `history.pushState`, which refuses it: a dead link.
    const r = await clickLink("https://example.com/docs");
    expect(r.intercepted).toBe(false);
    expect(r.warnings.join("\n")).toContain("https://example.com/docs");
  });

  it("leaves an off-origin target under a memory router too", async () => {
    // The memory router has no route for another origin; taking the click would render its 404.
    const r = await clickLink("https://example.com/docs", "{}", { router: "memory" });
    expect(r.intercepted).toBe(false);
  });

  it("leaves a non-http scheme", async () => {
    expect((await clickLink("mailto:hi@example.com")).intercepted).toBe(false);
  });

  it("warns once per link, not once per click", async () => {
    const r = await clickLink("https://example.com/docs", "{}", { again: true });
    expect(r.warnings).toHaveLength(1);
  });
});

describe("a javascript: target is cancelled rather than run", () => {
  it.each(["{}", "{external: true}"])("with props %s", async (props) => {
    const r = await clickLink("javascript:void 0", props);
    expect(r.intercepted).toBe(true);
    expect(r.html).not.toContain("arrived at next");
    expect(r.warnings.join("\n")).toContain("does not navigate");
  });
});
