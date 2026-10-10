export interface PlaygroundApi {
  compileSource(source: string): unknown;
  listExamples(): string[];
  loadExample(name: string): boolean;
  setSource(source: string): unknown;
}

export interface WebMcpTool {
  name: string;
  description: string;
  inputSchema?: object;
  annotations?: { readOnlyHint?: boolean };
  execute: (input: Record<string, unknown>) => unknown;
}

export interface ModelContext {
  registerTool(tool: WebMcpTool, options?: object): void;
  unregisterTool?(name: string): void;
}

export interface PlaygroundToolHost {
  bind(mc: ModelContext | undefined, api: PlaygroundApi): void;
  release(api: PlaygroundApi): void;
}

export function createPlaygroundToolHost(): PlaygroundToolHost {
  let active: PlaygroundApi | null = null;
  let registered = false;
  let context: ModelContext | null = null;

  const notMounted = () => ({
    ok: false,
    error: "playground is not mounted; open the Playground page first",
  });

  const tools: WebMcpTool[] = [
    {
      name: "kumiki_compile",
      description:
        "Compile the given Kumiki source. Returns ok plus generated JS size, or a list of diagnostics (codes per spec/errors.md).",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: { source: { type: "string", description: "Kumiki source text" } },
        required: ["source"],
      },
      execute: (input) =>
        active ? active.compileSource(String(input.source ?? "")) : notMounted(),
    },
    {
      name: "kumiki_list_examples",
      description: "List the feature examples available in the playground.",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", properties: {} },
      execute: () => (active ? active.listExamples() : notMounted()),
    },
    {
      name: "kumiki_load_example",
      description: "Load a named feature example into the playground editor and preview it.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Example file name, e.g. 07-list.kumiki" },
        },
        required: ["name"],
      },
      execute: (input) => {
        if (!active) return notMounted();
        const name = String(input.name ?? "");
        return active.loadExample(name) ? `loaded ${name}` : `not found: ${name}`;
      },
    },
    {
      name: "kumiki_set_source",
      description:
        "Replace the playground editor's source with the given Kumiki code and preview it.",
      inputSchema: {
        type: "object",
        properties: { source: { type: "string" } },
        required: ["source"],
      },
      execute: (input) => (active ? active.setSource(String(input.source ?? "")) : notMounted()),
    },
  ];

  return {
    bind(mc, api) {
      active = api;
      if (registered || !mc?.registerTool) return;
      registered = true;
      context = mc;
      for (const tool of tools) mc.registerTool(tool);
    },
    release(api) {
      if (active !== api) return;
      active = null;
      if (registered && context?.unregisterTool) {
        for (const tool of tools) context.unregisterTool(tool.name);
        registered = false;
        context = null;
      }
    },
  };
}

// Page-global host shared by every Playground mount in this document.
export const playgroundToolHost: PlaygroundToolHost = createPlaygroundToolHost();
