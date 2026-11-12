import { describe, expect, it } from "vitest";
import { loadReducer } from "./helpers/module.ts";

// Example 182 runs a `fn` body's binding arm; this runs the arm before it too.
const scoring = (color: string): string => `type Color = Red | Green | Blue
slot n : Int = 0
fn score(x: Color) -> Int = match x with | Red -> 1 | other -> 2
reducer subject on=ui.click(Go) do= n := score(${color})
tile Go = button(text="go")
app A caps=[] routes={"/" -> Go, "/404" -> Go} init=[]
`;

describe("a fn body's match with a binding arm after another arm", () => {
  it.each([
    ["Red", 1],
    ["Green", 2],
  ])("takes %s to the arm that names it first", async (color, n) => {
    const reducer = await loadReducer(scoring(color), "subject");
    expect(reducer.apply({}, {}).slots.n).toBe(n);
  });
});
