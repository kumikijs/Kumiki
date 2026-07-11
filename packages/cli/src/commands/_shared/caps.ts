import { CapabilityManifestError, resolveCapabilities } from "@kumikijs/compiler/node";

export function capsFor(inputPath: string): string[] {
  try {
    return resolveCapabilities(inputPath);
  } catch (e) {
    if (e instanceof CapabilityManifestError) {
      console.error(`capability manifest error: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}
