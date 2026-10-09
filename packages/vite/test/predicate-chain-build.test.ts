// A type carries every predicate of every definition it is declared through
// (spec/language.md §1.3.1), so how many predicates one slot's check holds is
// up to the program. Rollup walks a `&&` chain by recursion and rolldown fails
// on one as well, both at a few thousand terms — fewer than a chain the parser
// accepts can carry — while Node loads the same module without complaint. So
// what holds the emitted check to a shape a bundler takes is a real build.

import { describe, expect, it } from "vitest";
import { buildProject } from "./helpers/build-project.ts";

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
    const out = await buildProject(
      chainOfPredicates(),
      `import App from "./app.kumiki";\nexport default App;\n`,
    );
    // Every predicate is still a test in what was built: once in the slot's
    // check and once among its named parts.
    expect(out.split("v >= 0 && v <= 999").length - 1).toBe(2 * 40 * 250);
  }, 60_000);
});
