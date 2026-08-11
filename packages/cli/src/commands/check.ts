import { resolve } from "node:path";
import { check, type KumikiError } from "@kumikijs/compiler";
import { resolveBuiltinIcons } from "@kumikijs/compiler/node";
import type { Command } from "commander";
import { load } from "../store.ts";
import { capsFor } from "./_shared/caps.ts";
import { applyStrictFlags } from "./_shared/strict-flags.ts";

const USAGE =
  "Usage: kumiki check <input.kumiki> [--strict-a11y|--strict-icons|--strict-selector-id|--types|--refs|--effects]";

export type CheckScope = "types" | "refs" | "effects";

/**
 * Which diagnostic bands each narrowing flag selects (see the code system in
 * `docs/spec/errors.md`). The three named scopes divide one axis — what kind of
 * mistake this is — and `E00` (structure), `E07` (a11y / strict-icons /
 * testing-DSL invariants) and `E08` (runtime hazards) are not on it. No scope
 * can ask for those, so no scope may hide them: `check --types` would otherwise
 * report `ok` for a file with no `app` definition, a failure `--types` was
 * never meant to have an opinion about.
 */
const SCOPE_BANDS: Record<CheckScope, readonly string[]> = {
  types: ["E02", "E04", "E06"],
  refs: ["E01", "E05"],
  effects: ["E03"],
};

const SCOPED_BANDS = new Set(Object.values(SCOPE_BANDS).flat());

/**
 * `E0212` (strict-selector-id) is the one `--strict-*` diagnostic that lands in
 * a band a scope claims (`E02`), so `--strict-selector-id --refs` would drop the
 * finding the user explicitly asked for. The a11y and strict-icons codes are
 * `E07`, which no scope claims, so the rule above already keeps them.
 */
const STRICT_GATE_CODES = new Set(["E0212"]);

/**
 * Narrow `errors` to the bands the given scopes select. Scopes compose: they
 * name what to keep, so `--types --refs` keeps the union of both. Taking only
 * the first would drop findings the same command line explicitly asked for, and
 * `check` would report `ok` for a file the user was told to look at.
 *
 * The empty list is the identity — nothing was narrowed, so nothing is hidden.
 *
 * Exported for the band × scope table test; the CLI is the only other caller.
 */
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
  const all = check(store.program, {
    strictA11y,
    strictIcons,
    strictSelectorId,
    iconNames,
    capabilities: capsFor(inputPath),
  });
  const filtered = filterByScope(all, scopes);
  const warnings = filtered.filter((d) => d.severity === "warning");
  const errors = filtered.filter((d) => d.severity !== "warning");
  for (const d of [...warnings, ...errors]) {
    console.error(`${d.code} ${d.kind} at ${d.pos.line}:${d.pos.col}: ${d.message}`);
  }
  if (errors.length > 0) process.exit(1);
  console.log(
    warnings.length > 0
      ? `ok (${warnings.length} warning${warnings.length === 1 ? "" : "s"})`
      : "ok",
  );
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

export function registerCheck(program: Command): void {
  const cmd = program
    .command("check")
    .description(
      "Typecheck / validate a .kumiki file. The narrowing flags below compose (giving two reports both bands) and always also report structure (E00*), opt-in checks (E07*) and runtime hazards (E08*), which no narrowing selects.",
    )
    .argument("[input]", "input .kumiki file")
    .option("--types", "narrow to type errors (E02*/E04*/E06*)")
    .option("--refs", "narrow to reference errors (E01*/E05*)")
    .option("--effects", "narrow to effect errors (E03*)")
    .allowExcessArguments(false)
    .action(async (input: string | undefined, options: CheckOptions) => {
      if (!input) {
        console.error(USAGE);
        process.exit(2);
      }
      await checkCmd(
        input,
        Boolean(options.strictA11y),
        Boolean(options.strictIcons),
        Boolean(options.strictSelectorId),
        scopesFrom(options),
      );
    });
  applyStrictFlags(cmd);
}
