// Rollup and rolldown walk a `&&` chain by recursion and fail at a few thousand terms, while
// Node loads the same module without complaint, so only a real build holds the emitted check to a
// shape a bundler takes.

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AppShape } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { kumiki } from "../src/index.ts";
import { buildInto, project } from "./helpers/plugin.ts";
import { scratchRoot } from "./helpers/scratch.ts";

const TMP = scratchRoot(import.meta.url);

/** Forty definitions, each adding 250 `where`s to the one before. */
function chainOfPredicates(): string {
  const lines: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    const over = i === 0 ? "Int" : `T${i - 1}`;
    lines.push(`type T${i} = ${over}${" where between(0, 999)".repeat(250)}`);
  }
  return `${lines.join("\n")}
slot x : T39 = 7
reducer bump on=ui.click(Btn) do= x := x + 1
tile Btn = button(text="+", onClick=bump)
tile App = column(heading("x"), Btn)
app Chain caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
}

describe("a slot whose type carries ten thousand predicates", () => {
  it("builds, and the built check refuses what the predicates refuse", async () => {
    const root = project({
      where: TMP,
      source: chainOfPredicates(),
      main: `import App from "./app.kumiki";\nexport default App;\n`,
    });
    await buildInto(root, join(root, "dist"), [kumiki()]);
    const built: { default: AppShape } = await import(
      pathToFileURL(join(root, "dist", "out.js")).href
    );
    const x = built.default.slots.x;
    expect(x?.refine?.(7)).toBe(true);
    expect(x?.refine?.(1000)).toBe(false);
    expect(x?.refineAll).toHaveLength(40 * 250);
  }, 60_000);
});
