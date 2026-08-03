import type { Command } from "commander";

export function applyStrictFlags(cmd: Command): Command {
  return cmd
    .option("--strict-a11y", "promote a11y warnings (E0701..E0703) to errors")
    .option(
      "--strict-icons",
      "reject icon(name=...) that no theme.icons nor @kumikijs/icons declares (E0704)",
    )
    .option(
      "--strict-selector-id",
      "reject ui.<ev>(Tile#id) whose #id cannot match any literal (E0212)",
    );
}
