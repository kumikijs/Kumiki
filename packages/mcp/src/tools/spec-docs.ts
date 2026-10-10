import { z } from "zod";
import { getSpecDoc, listSpecDocs, searchSpec } from "../spec.ts";
import { text } from "../wire.ts";
import type { RegisterTool } from "./registrar.ts";

export function registerSpecTools(tool: RegisterTool): void {
  tool(
    "kumiki_spec_search",
    {
      title: "Search the spec",
      description:
        "Keyword search across the normative docs/spec documents. Returns doc:line matches.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => {
      const hits = searchSpec(query).map((h) => `${h.doc}:${h.line}  ${h.text}`);
      return text(hits.join("\n") || `(no matches for "${query}")`);
    },
  );

  tool(
    "kumiki_spec_list",
    {
      title: "List spec documents",
      description: "List the available normative docs/spec documents.",
      inputSchema: {},
    },
    async () => text(listSpecDocs().join("\n") || "(docs/spec not found)"),
  );

  tool(
    "kumiki_spec_get",
    {
      title: "Get a spec document",
      description: "Fetch the full text of one spec document (e.g. 'language' or 'errors.md').",
      inputSchema: { doc: z.string() },
    },
    async ({ doc }) => {
      const body = getSpecDoc(doc);
      if (body === null) throw new Error(`no spec document named "${doc}"`);
      return text(body);
    },
  );
}
