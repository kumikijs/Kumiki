import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "@kumikijs/examples";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach } from "vitest";
import { createServer } from "../../src/index.ts";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const fixture = (name: string): string => join(fixtures, `${name}.kumiki`);

export const FIX_COUNTER_TYPO = fixture("counter-typo");
export const FIX_COUNTER_TESTS = fixture("counter-with-tests");
export const FIX_COUNTER_TYPO_WITH_TEST = fixture("counter-typo-with-test");
export const FIX_A11Y = fixture("a11y-missing-alt");
export const FIX_REGRESSION = fixture("regression");
export const FIX_FAILING_SINGLE = fixture("failing-single");
export const FIX_WARNING_ONLY = fixture("warning-only");
export const FIX_SMOKE_PANICS = fixture("smoke-panics");
export const COUNTER = app("01-counter");

type TextContent = { type: "text"; text: string };

export type ToolResult = { isError: boolean; body: string; items: string[] };

export async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const server = createServer();
  const [serverT, clientT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  try {
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

export async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const res = await client.callTool({ name, arguments: args });
  const items = (res.content as TextContent[]).map((c) => c.text);
  return { isError: res.isError === true, body: items.join("\n"), items };
}

export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  return (await call(client, name, args)).body;
}

/** A one-shot call on a fresh server, for tests that only need the result. */
export function callOnce(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return withClient((client) => call(client, name, args));
}

export async function flag(name: string, args: Record<string, unknown>): Promise<boolean> {
  return (await callOnce(name, args)).isError;
}

export function errorMessage(body: string): string {
  return (JSON.parse(body) as { error: { message: string } }).error.message;
}

export async function listTools(): Promise<Awaited<ReturnType<Client["listTools"]>>["tools"]> {
  return withClient(async (client) => (await client.listTools()).tools);
}

/** A fresh temp directory per test; read `.path` inside the test body. */
export function useWorkdir(): { path: string } {
  const dir = { path: "" };
  beforeEach(() => {
    dir.path = mkdtempSync(join(tmpdir(), "kumiki-mcp-"));
  });
  afterEach(() => rmSync(dir.path, { recursive: true, force: true }));
  return dir;
}
