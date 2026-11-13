import { describe, expect, it } from "vitest";
import { loadReducer, loweredOf } from "./helpers/module.ts";
import { withReducer } from "./helpers/programs.ts";

const DEFS = `type Count = {n: Int}
fn nums() -> List(Int) = [1, 2, 3]
fn some() -> Option(Int) = Some(1)
fn counts() -> Map(Text, Count) = {"a": {n: 1}}
fn failed() -> Result(Int, Text) = Err("no")`;

const program = (rhs: string, type: string, init: string) =>
  withReducer(`${DEFS}\nslot res : ${type} = ${init}`, `res := ${rhs}`);

// A record literal lowers to `{ "n": … }` and a map literal to `{ [_s.entryKey(…)]: … }`, which an
// arrow body without parentheses reads as a block. `loweredOf` runs no `check`, so `flat-map` can be
// pinned with a fragment that answers a record where it should answer an Option.
describe("a fragment lowered to an arrow body returns a record or map literal as an object", () => {
  it.each([
    ["fold", "nums().fold({n: 0}, {n: $1.n + $2})", '{ "n": '],
    ["fold", 'nums().fold({"s": 0}, {"s": $2})', "{ [_s.entryKey("],
    ["flat-map", "some().flat-map({n: $1})", '{ "n": '],
    ["update", 'counts().update("a", {n: $1.n + 1})', '{ "n": '],
    ["map-err", "failed().map-err({n: $1})", '{ "n": '],
  ])("%s: `%s` lowers to an arrow whose body opens with `(`", (_method, rhs, literal) => {
    expect(loweredOf(program(rhs, "Int", "0"))).toContain(`=> (${literal}`);
  });
});

describe("a fragment that is a record or map literal runs", () => {
  it.each([
    ["fold", "nums().fold({n: 0}, {n: $1.n + $2}).n", "Int", "0", 6],
    ["fold", 'nums().fold({"s": 0}, {"s": $1.get-or("s", 0) + $2}).get-or("s", 0)', "Int", "0", 6],
    ["update", 'counts().update("a", {n: $1.n + 1}).get-or("a", {n: 0}).n', "Int", "0", 2],
    ["map-err", "failed().map-err({msg: $1}).get-err.msg", "Text", '""', "no"],
    ["map", "nums().map({v: $1 * 2}).fold(0, $1 + $2.v)", "Int", "0", 12],
  ])("%s: `%s`", { timeout: 30_000 }, async (_method, rhs, type, init, expected) => {
    const reducer = await loadReducer(program(rhs, type, init), "r");
    expect(reducer.apply({ res: JSON.parse(init) }, {}).slots.res).toEqual(expected);
  });
});
