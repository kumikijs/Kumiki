// Rollup and rolldown walk a `&&` chain by recursion and fail at a few thousand terms, while
// Node loads the same module without complaint, so only a real build holds the emitted check to a
// shape a bundler takes.

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { kumiki } from "../src/index.ts";
import { buildInto, project } from "./helpers/plugin.ts";

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
  it("builds", async () => {
    const root = project(
      chainOfPredicates(),
      `import App from "./app.kumiki";\nexport default App;\n`,
    );
    const out = await buildInto(root, join(root, "dist"), [kumiki()]);
    // Once in the slot's check and once among its named parts.
    expect(out.split("v >= 0 && v <= 999").length - 1).toBe(2 * 40 * 250);
  }, 60_000);
});
