import type { KumikiError } from "@kumikijs/compiler";
import {
  type CapabilityLookup,
  CapabilityManifestError,
  describeCapabilitySearch,
  resolveCapabilityManifest,
} from "@kumikijs/compiler/node";

export function capsFor(inputPath: string): CapabilityLookup {
  try {
    return resolveCapabilityManifest(inputPath);
  } catch (e) {
    if (e instanceof CapabilityManifestError) {
      console.error(`capability manifest error: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}

export function reportCapabilitySearch(diagnostics: KumikiError[], caps: CapabilityLookup): void {
  if (!diagnostics.some((d) => d.code === "E0302")) return;
  console.error(`note: ${describeCapabilitySearch(caps)}`);
}
