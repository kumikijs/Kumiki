import { resolveBuiltinIcons } from "@kumikijs/compiler/node";

/** The path data of the built-in icons a program uses, or null when none resolves. */
export async function builtinIconSubset(
  inputPath: string,
  usedIcons: readonly string[],
): Promise<Record<string, string> | null> {
  if (usedIcons.length === 0) return null;
  const registry = await resolveBuiltinIcons(inputPath);
  if (!registry) return null;
  const subset: Record<string, string> = {};
  for (const name of usedIcons) {
    const path = registry[name];
    if (typeof path === "string") subset[name] = path;
  }
  return Object.keys(subset).length > 0 ? subset : null;
}
