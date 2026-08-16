// Outbound ecosystem seam: wrap a compiled Kumiki app as a custom element so it
// drops into any host page or framework (React/Vue/Svelte/plain HTML) as a
// standard Web Component. The element owns the mount lifecycle and bridges the
// host both ways:
//   - inbound  (host → app): set slot values via attributes or imperative methods
//   - outbound (app → host): custom-capability effects surface as host providers
//                            (callbacks) and/or DOM CustomEvents
//
// It renders into the element's light DOM (not a shadow root) because the runtime
// injects theme + motion styles into the document; a shadow root would not see
// them. Style isolation via shadow DOM is a deliberate follow-on.
//
// A compiled app module is single-instance — its render closures bind to that
// module's live state — so define one tag per imported app module. Multiple
// independent instances require importing the app module more than once.

import type { AppShape, CapabilityProvider, MountOptions } from "./index.ts";
import { mount } from "./index.ts";

/** Maps one observed attribute to a slot, with an optional parser (default: raw string). */
export type AttributeSlotBinding = {
  slot: string;
  parse?: (raw: string | null) => unknown;
};

export type KumikiElementOptions = {
  /** Host implementations for custom capabilities (the inbound seam), forwarded to mount. */
  providers?: Record<string, CapabilityProvider>;
  /**
   * Custom-capability names to surface as DOM CustomEvents on the element. For
   * each, emitting the effect dispatches `CustomEvent(cap, { detail: input })`
   * (bubbling, composed) and resolves ok — so a host can bind via
   * `addEventListener(cap, …)` / framework `@cap`. A `providers[cap]` entry
   * takes precedence over the passthrough for the same capability.
   */
  events?: string[];
  /** Observed attributes mapped to slots; updates flow in on connect and on change. */
  attributeSlots?: Record<string, AttributeSlotBinding>;
  /**
   * Render into an open shadow root for full style isolation: the app's
   * theme/motion/state `<style>` nodes are injected into the shadow root (not the
   * document head), so host-page CSS does not bleed in and Kumiki's CSS does not
   * leak out. Default: false (light DOM — the runtime's document-level styles
   * apply, matching a standalone Kumiki page).
   */
  shadow?: boolean;
  /**
   * Routing source forwarded to mount (#36). An embedded element rarely owns the
   * top-level URL, so a routed Kumiki app inside it should usually use
   * `"memory"` (an in-memory path) rather than the default `"history"`, which
   * reads/writes the host page's location/history.
   */
  router?: "history" | "memory";
  /** Initial path for the memory router (default `"/"`). */
  initialPath?: string;
};

type AppWithSetSlot = AppShape & {
  _setSlot?: (name: string, value: unknown) => void;
};

/**
 * Register `app` as the custom element `tagName`. Idempotent: if the tag is
 * already defined this is a no-op (so re-imports / HMR don't throw). Requires a
 * DOM environment.
 */
export function defineKumikiElement(
  tagName: string,
  app: AppShape | (() => AppShape),
  options: KumikiElementOptions = {},
): void {
  if (typeof customElements === "undefined") {
    throw new Error(
      "defineKumikiElement requires a DOM environment (customElements is undefined).",
    );
  }
  if (customElements.get(tagName)) return;

  // Pass the compiled module's `createApp` factory to give each element instance
  // its own independent state; pass a single `AppShape` and every element of
  // this tag is a view of ONE app — same slots, all of them live, initialized
  // once (runtime.md §10.9). (A factory's closures bind to each call's own
  // `live`.)
  const makeApp: () => AppShape = typeof app === "function" ? app : () => app;

  const attributeSlots = options.attributeSlots ?? {};
  const observed = Object.keys(attributeSlots);

  // Event-passthrough providers fill in for any `events` capability; explicit
  // host providers override them (host wins on conflict).
  const buildProviders = (el: HTMLElement): Record<string, CapabilityProvider> => {
    const merged: Record<string, CapabilityProvider> = {};
    for (const cap of options.events ?? []) {
      merged[cap] = (input) => {
        el.dispatchEvent(new CustomEvent(cap, { detail: input, bubbles: true, composed: true }));
        return { kind: "ok", value: null };
      };
    }
    return Object.assign(merged, options.providers ?? {});
  };

  // Defined lazily (inside the function) so merely importing this module never
  // references `HTMLElement` — keeping non-DOM imports of the runtime safe.
  class KumikiAppElement extends HTMLElement {
    static get observedAttributes(): string[] {
      return observed;
    }

    private handle: { dispose: () => void } | null = null;
    // This element's own app instance (independent when a factory was given).
    private app: AppShape | null = null;

    connectedCallback(): void {
      if (this.handle) return;
      this.app = makeApp();
      let target: HTMLElement = this;
      const mountOpts: MountOptions = { providers: buildProviders(this) };
      if (options.router) mountOpts.router = options.router;
      if (options.initialPath !== undefined) mountOpts.initialPath = options.initialPath;
      if (options.shadow) {
        const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
        root.replaceChildren();
        const container = document.createElement("div");
        root.appendChild(container);
        target = container;
        mountOpts.styleRoot = root;
        mountOpts.styleHost = container;
      }
      this.handle = mount(this.app, target, mountOpts);
      for (const attr of observed) {
        if (this.hasAttribute(attr)) this.applyAttr(attr, this.getAttribute(attr));
      }
    }

    disconnectedCallback(): void {
      this.handle?.dispose();
      this.handle = null;
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
      if (this.handle) this.applyAttr(name, value);
    }

    private applyAttr(name: string, raw: string | null): void {
      const binding = attributeSlots[name];
      if (!binding) return;
      this.setSlot(binding.slot, binding.parse ? binding.parse(raw) : raw);
    }

    /** Write a live slot (respects its refinement) and re-render. */
    setSlot(name: string, value: unknown): void {
      (this.app as AppWithSetSlot | null)?._setSlot?.(name, value);
    }

    /** Write several live slots at once. */
    setSlots(values: Record<string, unknown>): void {
      for (const [name, value] of Object.entries(values)) this.setSlot(name, value);
    }

    /** Read a single live slot value. */
    getSlot(name: string): unknown {
      return this.app?.live?.[name];
    }

    /** A snapshot of the current live slot values. */
    get slots(): Record<string, unknown> {
      return { ...(this.app?.live ?? {}) };
    }
  }

  customElements.define(tagName, KumikiAppElement);
}
