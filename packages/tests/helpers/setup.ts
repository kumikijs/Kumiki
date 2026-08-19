// Vitest setup: install the same environment doubles `kumiki smoke` installs,
// so an example behaves the same whether it is driven from the CLI or from
// this suite. See packages/cli/src/harness.ts for what they are and why.

import { installTestDoubles } from "@kumikijs/cli";

installTestDoubles();
