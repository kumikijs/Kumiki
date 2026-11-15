import { APP_A } from "./files.ts";

/**
 * One E0103 that no repair can answer: `count` is one edit from `countA` and from `countB`.
 * `first` is declared before `second`, so a repair that keeps the first name it meets is caught
 * in one of the two orders.
 */
export function tiedCounts(first: string, second: string): string {
  return `slot ${first} : Int = 0
slot ${second} : Int = 0
reducer bumpA on=ui.click(BtnA) do= countA := countA + 1
reducer bumpB on=ui.click(BtnB) do= countB := countB + 1
tile BtnA = button(text="a", onClick=bumpA)
tile BtnB = button(text="b", onClick=bumpB)
tile App  = column(BtnA, BtnB, text("total: " + count.show))
${APP_A}`;
}
