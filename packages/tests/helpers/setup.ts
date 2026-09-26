// Vitest setup: install the same environment doubles `kumiki smoke` installs,
// so an example behaves the same whether it is driven from the CLI or from
// this suite. See packages/cli/src/harness.ts for what they are and why.

import { clearStorage, installTestDoubles } from "@kumikijs/cli";
import { beforeEach } from "vitest";

installTestDoubles();

// Each test mounts its example as a first visit, the way `kumiki smoke` and
// `kumiki run` do: a file's tests share one DOM, and an app that restores a
// key an earlier example wrote (`session`) would boot on that example's value.
beforeEach(() => {
  clearStorage();
});
