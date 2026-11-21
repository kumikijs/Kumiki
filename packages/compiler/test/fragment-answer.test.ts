// What a `flat-map` fragment answers is the call's result on a `Some` / `Ok`, so an answer that is
// no `Option` or `Result` puts a bare value into the slot the call is written to. A `filter`
// predicate decides what is kept, so one that is no `Bool` keeps whatever is truthy.

import { describe, expect, it } from "vitest";
import { pointedErrorsOf } from "./helpers/diagnostics.ts";
import { withReducer } from "./helpers/programs.ts";

const DEFS = `slot o  : Option(Int)       = Some(1)
slot ot : Option(Text)      = Some("1")
slot r  : Result(Int, Text) = Ok(1)
slot m  : Option(Int)       = None
slot xs : List(Int)         = [1, 2]
slot mp : Map(Text, Int)    = {}
slot s  : Set(Int)          = []
fn half(n: Int) -> Option(Int) = if n % 2 == 0 then Some((n / 2).to-int) else None
fn plusOne(n: Int) -> Int = n + 1
fn checked(n: Int) -> Result(Int, Text) = Ok(n)
fn checkedI(n: Int) -> Result(Int, Int) = Ok(n)
fn positive(n: Int) -> Bool = n > 0
fn undecided(n: Int) = [n].map($1)`;

/** The errors of a reducer that runs `stmt`, each with the source text it is reported at. */
const write = (stmt: string) => pointedErrorsOf(withReducer(DEFS, stmt));

describe("a flat-map fragment answers the receiver's own container", () => {
  // `at` is the source text from the reported position to the end of the line.
  it.each([
    [
      "an Int, over an Option",
      "m := o.flat-map($1 + 1)",
      "$1 + 1)",
      "Expected Option(?) but got Int",
    ],
    [
      "a record, over an Option",
      "m := o.flat-map({n: $1})",
      "{n: $1})",
      "Expected Option(?) but got {n: Int}",
    ],
    [
      "a Result, over an Option",
      "m := o.flat-map(checked($1))",
      "checked($1))",
      "Expected Option(?) but got Result(Int, Text)",
    ],
    [
      "a fn named that answers an Int",
      "m := o.flat-map(plusOne)",
      "plusOne)",
      "Expected Option(?) but got Int",
    ],
    [
      "an if branch that is no Option",
      "m := o.flat-map(if $1 > 0 then Some($1) else 0)",
      "0)",
      "Expected Option(?) but got Int",
    ],
    [
      "a match arm that is no Option",
      "m := o.flat-map(match half($1) with | Some(h) -> h | None -> None)",
      "h | None -> None)",
      "Expected Option(?) but got Int",
    ],
    [
      "an Int, over a Result",
      "r := r.flat-map($1 + 1)",
      "$1 + 1)",
      "Expected Result(?, Text) but got Int",
    ],
    [
      "an Option, over a Result",
      "r := r.flat-map(half($1))",
      "half($1))",
      "Expected Result(?, Text) but got Option(Int)",
    ],
    [
      "a Result of another error type",
      "r := r.flat-map(checkedI)",
      "checkedI)",
      "Expected Result(?, Text) but got Result(Int, Int)",
    ],
    [
      "an Err of another error type",
      "r := r.flat-map(Err($1))",
      "$1))",
      "Expected Text but got Int",
    ],
  ])("reports %s once, at the answer", (_name, stmt, at, message) => {
    expect(write(stmt)).toEqual([{ code: "E0201", message, text: at }]);
  });

  it.each([
    "m := o.flat-map(Some($1 + 1))",
    "m := o.flat-map(None)",
    "m := o.flat-map(half)",
    "m := o.flat-map(half($1))",
    "m := ot.flat-map($1.parse-int)",
    "m := o.flat-map(if $1 > 0 then Some($1) else None)",
    "m := o.flat-map(match half($1) with | Some(h) -> Some(h + 1) | None -> None)",
    "r := r.flat-map(Ok($1 + 1))",
    'r := r.flat-map(Err("no"))',
    "r := r.flat-map(checked)",
    'r := r.flat-map(if $1 > 0 then Ok($1) else Err("negative"))',
  ])("accepts %s", (stmt) => {
    expect(write(stmt)).toEqual([]);
  });

  it.each([
    ["a fn whose answer is not decided", "m := o.flat-map(undecided)"],
    ["a receiver whose type is not decided", "m := undecided(1).head.flat-map($1 + 1)"],
  ])("checks nothing against %s", (_name, stmt) => {
    expect(write(stmt)).toEqual([]);
  });
});

describe("a filter predicate answers a Bool", () => {
  it.each([
    ["a List predicate", "xs := xs.filter($1 + 1)", "$1 + 1)", "Expected Bool but got Int"],
    ["a fn named", "xs := xs.filter(plusOne)", "plusOne)", "Expected Bool but got Int"],
    ["an Option predicate", "m := o.filter($1 + 1)", "$1 + 1)", "Expected Bool but got Int"],
    ["a Map predicate", "mp := mp.filter($2.show)", "$2.show)", "Expected Bool but got Text"],
    ["a Set predicate", 's := s.filter("x")', '"x")', "Expected Bool but got Text"],
  ])("reports %s that is no Bool once, at the predicate", (_name, stmt, at, message) => {
    expect(write(stmt)).toEqual([{ code: "E0201", message, text: at }]);
  });

  it.each([
    "xs := xs.filter($1 > 0)",
    "xs := xs.filter(positive)",
    "m := o.filter(positive($1))",
    'mp := mp.filter($1 == "k")',
    "s := s.filter(true)",
  ])("accepts %s", (stmt) => {
    expect(write(stmt)).toEqual([]);
  });
});
