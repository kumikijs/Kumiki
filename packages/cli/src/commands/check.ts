import { resolve } from "node:path";
import { check, type KumikiError } from "@kumikijs/compiler";
import { resolveBuiltinIcons } from "@kumikijs/compiler/node";
import type { Command } from "commander";
import { load } from "../store.ts";
import { capsFor } from "./_shared/caps.ts";
import { applyStrictFlags } from "./_shared/strict-flags.ts";

const USAGE =
  "Usage: kumiki check <input.kumiki> [--strict-a11y|--strict-icons|--strict-selector-id|--types|--refs|--effects]";

type CheckScope = "all" | "types" | "refs" | "effects";

/**
 * Diagnostics gated by an explicit `--strict-*` opt-in upstream (a11y E0701-
 * E0703, strict-icons E0704, strict-selector-id E0212). They survive any
 * `--types/--refs/--effects` scope filter so combining `--strict-icons --types`
 * does not silently drop the strict findings the user asked for.
 */
const STRICT_GATE_CODES = new Set(["E0212", "E0701", "E0702", "E0703", "E0704"]);

function filterByScope(errors: KumikiError[], scope: CheckScope): KumikiError[] {
  if (scope === "all") return errors;
  return errors.filter((e) => {
    const code = e.code;
    if (STRICT_GATE_CODES.has(code)) return true;
    if (e.severity === "warning") return true;
    if (scope === "types")
      return code.startsWith("E02") || code.startsWith("E04") || code.startsWith("E06");
    if (scope === "refs") return code.startsWith("E01") || code.startsWith("E05");
    if (scope === "effects") return code.startsWith("E03");
    return true;
  });
}

export async function checkCmd(
  inputArg: string,
  strictA11y: boolean,
  strictIcons: boolean,
  strictSelectorId: boolean,
  scope: CheckScope,
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
  const filtered = filterByScope(all, scope);
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

function scopeFrom(options: CheckOptions): CheckScope {
  if (options.types) return "types";
  if (options.refs) return "refs";
  if (options.effects) return "effects";
  return "all";
}

export function registerCheck(program: Command): void {
  const cmd = program
    .command("check")
    .description("Typecheck / validate a .kumiki file")
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
        scopeFrom(options),
      );
    });
  applyStrictFlags(cmd);
}
