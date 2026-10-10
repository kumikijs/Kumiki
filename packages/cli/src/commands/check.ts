import { resolve } from "node:path";
import { check, type KumikiError } from "@kumikijs/compiler";
import { resolveBuiltinIcons } from "@kumikijs/compiler/node";
import type { Command } from "commander";
import { formatDiagnostic } from "../diagnostic.ts";
import { plural } from "../fix.ts";
import { load } from "../store.ts";
import { capsFor, reportCapabilitySearch } from "./_shared/caps.ts";
import { applyStrictFlags } from "./_shared/strict-flags.ts";
import { exitWithUsage } from "./_shared/usage.ts";

const USAGE =
  "Usage: kumiki check <input.kumiki> [--strict-a11y] [--strict-icons] [--strict-selector-id] [--types] [--refs] [--effects]";

export type CheckScope = "types" | "refs" | "effects";

const SCOPE_BANDS: Record<CheckScope, readonly string[]> = {
  types: ["E02", "E04", "E06"],
  refs: ["E01"],
  effects: ["E03"],
};

const SCOPED_BANDS = new Set(Object.values(SCOPE_BANDS).flat());

const STRICT_GATE_CODES = new Set(["E0212"]);

export function filterByScope(errors: KumikiError[], scopes: readonly CheckScope[]): KumikiError[] {
  if (scopes.length === 0) return errors;
  const selected = new Set(scopes.flatMap((s) => SCOPE_BANDS[s]));
  return errors.filter((e) => {
    if (e.severity === "warning") return true;
    if (STRICT_GATE_CODES.has(e.code)) return true;
    const band = e.code.slice(0, 3);
    if (!SCOPED_BANDS.has(band)) return true;
    return selected.has(band);
  });
}

export async function checkCmd(
  inputArg: string,
  strictA11y: boolean,
  strictIcons: boolean,
  strictSelectorId: boolean,
  scopes: readonly CheckScope[],
): Promise<void> {
  const inputPath = resolve(process.cwd(), inputArg);
  const store = load(inputPath);
  let iconNames: string[] = [];
  if (strictIcons) {
    const registry = await resolveBuiltinIcons(inputPath);
    if (registry) {
      iconNames = Object.keys(registry);
    } else {
      console.error(
        "note: --strict-icons: @kumikijs/icons not resolved; checking against theme.icons only",
      );
    }
  }
  const caps = capsFor(inputPath);
  const all = check(store.program, {
    strictA11y,
    strictIcons,
    strictSelectorId,
    iconNames,
    capabilities: caps.capabilities,
  });
  const filtered = filterByScope(all, scopes);
  const warnings = filtered.filter((d) => d.severity === "warning");
  const errors = filtered.filter((d) => d.severity !== "warning");
  for (const d of [...warnings, ...errors]) {
    console.error(formatDiagnostic(d));
  }
  reportCapabilitySearch(errors, caps);
  if (errors.length > 0) process.exit(1);
  console.log(warnings.length > 0 ? `ok (${plural(warnings.length)})` : "ok");
}

type CheckOptions = {
  strictA11y?: boolean;
  strictIcons?: boolean;
  strictSelectorId?: boolean;
  types?: boolean;
  refs?: boolean;
  effects?: boolean;
};

function scopesFrom(options: CheckOptions): CheckScope[] {
  const scopes: CheckScope[] = [];
  if (options.types) scopes.push("types");
  if (options.refs) scopes.push("refs");
  if (options.effects) scopes.push("effects");
  return scopes;
}

export function registerCheck(program: Command): string {
  const cmd = program
    .command("check")
    .description(
      "Typecheck / validate a .kumiki file. The narrowing flags below compose (giving two reports both bands) and always also report structure (E00*), opt-in checks (E07*) and runtime hazards (E08*), which no narrowing selects.",
    )
    .argument("[input]", "input .kumiki file")
    .option("--types", "narrow to type errors (E02*/E04*/E06*)")
    .option("--refs", "narrow to reference errors (E01*)")
    .option("--effects", "narrow to effect errors (E03*)")
    .allowExcessArguments(false)
    .action(async (input: string | undefined, options: CheckOptions) => {
      if (!input) exitWithUsage(USAGE);
      await checkCmd(
        input,
        Boolean(options.strictA11y),
        Boolean(options.strictIcons),
        Boolean(options.strictSelectorId),
        scopesFrom(options),
      );
    });
  applyStrictFlags(cmd);
  return USAGE;
}
