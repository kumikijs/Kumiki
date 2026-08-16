import type { KumikiError } from "@kumikijs/compiler";
import {
  type CapabilityLookup,
  CapabilityManifestError,
  describeCapabilitySearch,
  resolveCapabilityManifest,
} from "@kumikijs/compiler/node";

/**
 * The capabilities registered for an input file, with the manifest they came
 * from. Callers that only need the names read `.capabilities`; the ones that
 * report diagnostics keep the rest so an `E0302` can say which file to edit.
 */
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

/**
 * Print where the accepted capability names came from, when a diagnostic says
 * one of them was not accepted. Silent otherwise — the provenance is only
 * interesting to an author who is looking for the manifest.
 */
export function reportCapabilitySearch(diagnostics: KumikiError[], caps: CapabilityLookup): void {
  if (!diagnostics.some((d) => d.code === "E0302")) return;
  console.error(`note: ${describeCapabilitySearch(caps)}`);
}
