import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveCapabilities } from "@kumikijs/compiler/node";
import { z } from "zod";

export function absPath(path: string): string {
  return resolve(process.cwd(), path);
}

export function requireSourceFile(path: string): string {
  const abs = absPath(path);
  if (!existsSync(abs)) throw new Error(`File "${abs}" not found`);
  return abs;
}

export function readSource(input: {
  source?: string | undefined;
  path?: string | undefined;
}): string {
  if (typeof input.source === "string") return input.source;
  if (input.path) return readFileSync(absPath(input.path), "utf8");
  throw new Error("provide either `source` or `path`");
}

export function capsForInput(input: {
  path?: string | undefined;
  capabilities?: string[] | undefined;
}): string[] {
  if (input.path) return resolveCapabilities(absPath(input.path));
  return input.capabilities ?? [];
}

const capabilityList = z.array(z.string()).optional();

const READ_FROM_PATH =
  "With `path`, the nearest kumiki.caps.json at or above it is read automatically.";

/** For the tools that typecheck `app.caps` against the list. */
export const sourceCapabilities = capabilityList.describe(
  `Project-registered capabilities accepted in app.caps (when passing \`source\`). ${READ_FROM_PATH}`,
);

/** For the tools that run the app with the list's providers. */
export const runCapabilities = capabilityList.describe(
  `Project-registered capabilities (when passing \`source\`). ${READ_FROM_PATH}`,
);

export const pathCapabilities = capabilityList.describe(
  "Project-registered capabilities. Defaults to the nearest kumiki.caps.json at or above the path.",
);
