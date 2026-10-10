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
  events?: string[];
  /** Observed attributes mapped to slots; updates flow in on connect and on change. */
  attributeSlots?: Record<string, AttributeSlotBinding>;
  shadow?: boolean;
  router?: "history" | "memory";
  /** Initial path for the memory router (default `"/"`). */
  initialPath?: string;
};

type AppWithSetSlot = AppShape & {
  _setSlot?: (name: string, value: unknown) => void;
};

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

  const makeApp: () => AppShape = typeof app === "function" ? app : () => app;

  const attributeSlots = options.attributeSlots ?? {};
  const observed = Object.keys(attributeSlots);

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
