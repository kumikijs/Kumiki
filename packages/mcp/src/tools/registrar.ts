import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { errText } from "../wire.ts";

export type RegisterTool = <InputArgs extends ZodRawShapeCompat>(
  name: string,
  config: { title: string; description: string; inputSchema: InputArgs },
  handler: ToolCallback<InputArgs>,
) => void;

/** Every thrown error becomes the `{error: {kind, message}}` envelope with `isError` set. */
export function toolRegistrar(server: McpServer): RegisterTool {
  return (name, config, handler) => {
    server.registerTool(name, config, (async (args, extra): Promise<CallToolResult> => {
      try {
        return await handler(args, extra);
      } catch (e) {
        return errText(e);
      }
    }) as typeof handler);
  };
}
