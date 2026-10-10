import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCompileTools } from "./tools/compile.ts";
import { registerDefinitionTools } from "./tools/definitions.ts";
import { registerEpisodeTools } from "./tools/episodes.ts";
import { toolRegistrar } from "./tools/registrar.ts";
import { registerRepairTools } from "./tools/repair.ts";
import { registerSpecTools } from "./tools/spec-docs.ts";

export { serialiseFixFromTest } from "./wire.ts";

export function createServer(): McpServer {
  const server = new McpServer({ name: "kumiki", version: "0.1.0" });
  const tool = toolRegistrar(server);
  registerCompileTools(tool);
  registerDefinitionTools(tool);
  registerEpisodeTools(tool);
  registerRepairTools(tool);
  registerSpecTools(tool);
  return server;
}
