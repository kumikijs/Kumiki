// Issue #92: Bytes constructors live in `_stdlibCore` and are reached via
// codegen-emitted `_s.bytesFrom*` calls. The unit test pins the byte-level
// behavior of each constructor so a regression in the runtime helper surfaces
// here even if the compiler's smoke / examples test happens to skip the path.

import { describe, expect, it } from "vitest";
import { KumikiPanic } from "../src/core.ts";
import { _stdlibCore } from "../src/stdlib.ts";

describe("Bytes constructors (docs/spec/stdlib.md §2.1.1 / §2.2.10)", () => {
  it("bytesFromText UTF-8 encodes the string", () => {
    expect(_stdlibCore.bytesFromText("hi")).toEqual(new Uint8Array([0x68, 0x69]));
    expect(_stdlibCore.bytesFromText("")).toEqual(new Uint8Array([]));
    // multi-byte (Japanese "あ" → E3 81 82)
    expect(_stdlibCore.bytesFromText("あ")).toEqual(new Uint8Array([0xe3, 0x81, 0x82]));
  });

  it("bytesFromText coerces nullish to empty without throwing", () => {
    expect(_stdlibCore.bytesFromText(null)).toEqual(new Uint8Array([]));
    expect(_stdlibCore.bytesFromText(undefined)).toEqual(new Uint8Array([]));
  });

  it("bytesFromBase64 decodes standard base64", () => {
    // "hi" → "aGk="
    expect(_stdlibCore.bytesFromBase64("aGk=")).toEqual(new Uint8Array([0x68, 0x69]));
    expect(_stdlibCore.bytesFromBase64("")).toEqual(new Uint8Array([]));
  });

  it("bytesFromBase64 returns an empty Uint8Array for malformed / nullish input (does not throw)", () => {
    expect(_stdlibCore.bytesFromBase64(null)).toEqual(new Uint8Array([]));
    expect(_stdlibCore.bytesFromBase64(undefined)).toEqual(new Uint8Array([]));
    // `!` is not a valid base64 character; native atob would throw a DOMException.
    expect(_stdlibCore.bytesFromBase64("!!!not base64!!!")).toEqual(new Uint8Array([]));
  });

  it("bytesFromBytes accepts a List(Int) and clamps to the low 8 bits", () => {
    expect(_stdlibCore.bytesFromBytes([1, 2, 3])).toEqual(new Uint8Array([1, 2, 3]));
    // 256 wraps to 0, 257 to 1 — same as `& 0xff`.
    expect(_stdlibCore.bytesFromBytes([1, 2, 256, 257])).toEqual(new Uint8Array([1, 2, 0, 1]));
    expect(_stdlibCore.bytesFromBytes([])).toEqual(new Uint8Array([]));
  });

  it("bytesFromBytes falls back to an empty Uint8Array for non-list input", () => {
    expect(_stdlibCore.bytesFromBytes(null)).toEqual(new Uint8Array([]));
    expect(_stdlibCore.bytesFromBytes(undefined)).toEqual(new Uint8Array([]));
  });
});

// Issue #92 review: previously `.sort()` lowered inline to JS's default
// (string-comparator) sort, so `[3,1,2,10].sort` → `[1,10,2,3]` for a
// `List(Int)`. The fix routes both forms through `_stdlibCore.listSort`
// which sorts numerically when every element is a finite number.
// `sort-by` subtracted its keys, and two Text keys subtract to `NaN`, which
// `Array.prototype.sort` reads as "equal": a list sorted by a name came back
// in the order it went in.
describe("listSortBy (docs/spec/stdlib.md §2.2.3 List.sort-by)", () => {
  const users = [
    { name: "carol", age: 30 },
    { name: "alice", age: 20 },
    { name: "bob", age: 25 },
    { name: "abe", age: 20 },
  ];
  const names = (xs: { name: string }[]) => xs.map((u) => u.name);

  it("orders a Text key as `<` orders two Texts", () => {
    expect(names(_stdlibCore.listSortBy(users, (u) => u.name))).toEqual([
      "abe",
      "alice",
      "bob",
      "carol",
    ]);
  });

  it("orders a numeric key numerically, keeping equal keys in their order", () => {
    expect(names(_stdlibCore.listSortBy(users, (u) => u.age))).toEqual([
      "alice",
      "abe",
      "bob",
      "carol",
    ]);
    expect(_stdlibCore.listSortBy([10, 9, 100], (x) => x)).toEqual([9, 10, 100]);
  });

  // A key the checker could not type arrives as whatever it is at runtime.
  const keyed = (ks: unknown[]) => ks.map((k, i) => ({ id: i, k }));
  const ids = (xs: { id: number }[]) => xs.map((x) => x.id);

  it("sorts an absent (undefined) key after every other, keeping its order", () => {
    // Compared as "equal" to everything, one missing key used to leave the
    // whole list as it found it.
    expect(ids(_stdlibCore.listSortBy(keyed([3, undefined, 1, null, 2]), (x) => x.k))).toEqual([
      2, 4, 0, 1, 3,
    ]);
    expect(
      ids(_stdlibCore.listSortBy(keyed([undefined, undefined, undefined]), (x) => x.k)),
    ).toEqual([0, 1, 2]);
  });

  it("sorts a NaN key after every other, keeping its order", () => {
    expect(
      ids(_stdlibCore.listSortBy(keyed(["b", Number.NaN, "a", Number.NaN]), (x) => x.k)),
    ).toEqual([2, 0, 1, 3]);
  });

  it("orders a numeric key that arrives as Text the way `<` does", () => {
    // Text against Text compares as text ("10" < "9"); Text against a number
    // is coerced to a number. Not converted to the declared type
    // (stdlib.md §2.2.3).
    expect(_stdlibCore.listSortBy(["9", "10"], (x) => x)).toEqual(["10", "9"]);
    expect(_stdlibCore.listSortBy([10, "9", 2], (x) => x)).toEqual([2, "9", 10]);
  });

  it("keeps every element of a key list `<` cannot order, and leaves the input alone", () => {
    // A number against a non-numeric Text answers false both ways, so there
    // is no single order to assert — only that nothing is lost or mutated.
    const xs = keyed([3, "b", 1, { r: 1 }, "a"]);
    const out = _stdlibCore.listSortBy(xs, (x) => x.k);
    expect(ids(out).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(ids(xs)).toEqual([0, 1, 2, 3, 4]);
  });
});

// The implicit key of each tile a `for` renders (runtime.md §10.3.10). It was
// `show(x)` alone, so equal values keyed two siblings alike and the keyed
// reconciler refused the render.
describe("loopKeys (docs/spec/runtime.md §10.3.10)", () => {
  it("keys equal values apart by their occurrence", () => {
    const keys = _stdlibCore.loopKeys([7, 3, 7], "App_0");
    expect(new Set(keys).size).toBe(3);
    expect(keys).toEqual(["App_0|1|7", "App_0|1|3", "App_0|2|7"]);
  });

  it("keys two loops' shared value apart by the loop", () => {
    expect(_stdlibCore.loopKeys([2], "App_0")).not.toEqual(_stdlibCore.loopKeys([2], "App_1"));
  });

  it("keeps a value's key when the list is reordered", () => {
    const before = _stdlibCore.loopKeys(["a", "b", "c"], "App_0");
    const after = _stdlibCore.loopKeys(["c", "a", "b"], "App_0");
    expect(after).toEqual([before[2], before[0], before[1]]);
  });

  it("cannot be spelled by another element's value", () => {
    // A Text value may contain the separator; the count comes first, so the
    // second "x" and a value spelling "2|x" still differ.
    expect(new Set(_stdlibCore.loopKeys(["x", "x", "2|x", "1|2|x"], "App_0")).size).toBe(4);
  });

  it("keys records, Maps and Sets by position, whatever they hold", () => {
    // A record, Map or Set element adds no shown value to its key, so the
    // occurrence is all that tells two of them apart (runtime.md §10.3.10):
    // a reorder or an edit of one keeps every key where it was.
    const keys = _stdlibCore.loopKeys([{ id: 2 }, { id: 1 }], "App_0");
    expect(keys).toEqual(["App_0|1|", "App_0|2|"]);
    expect(_stdlibCore.loopKeys([{ id: 1 }, { id: 2 }], "App_0")).toEqual(keys);
    expect(_stdlibCore.loopKeys([{ id: 1, done: true }, { id: 2 }], "App_0")).toEqual(keys);
  });

  it("keys a List element and a variant by what they show", () => {
    expect(_stdlibCore.loopKeys([[1, 2], { _tag: "Some", _0: 3 }], "App_0")).toEqual([
      "App_0|1|[1, 2]",
      "App_0|1|Some",
    ]);
  });
});

// `show` (docs/spec/stdlib.md §2.2.7): the one text form `+`, `.show`, `fmt`
// and a tile's text render a value in. A structured value is written the way
// a program writes it as a literal; the shape argument is what the checker
// knows of its type and the value alone does not say — a Map, a Set and a
// Tuple are a plain object, an object of keys and an array at run time.
describe("show (docs/spec/stdlib.md §2.2.7)", () => {
  const { show, mapInsert, setOf } = _stdlibCore;

  it("writes a record as its fields, in the order it holds them", () => {
    expect(show({ name: "ada", age: 3 })).toBe('{name: "ada", age: 3}');
    expect(show({ "episode-id": { _tag: "None" }, ok: true })).toBe("{episode-id: None, ok: true}");
  });

  it("writes a record inside a record, and a List inside either, the same way", () => {
    expect(show({ at: { x: 0, y: -1 }, tags: ["a", "b"] })).toBe(
      '{at: {x: 0, y: -1}, tags: ["a", "b"]}',
    );
  });

  it("writes a List in brackets, its Text members quoted", () => {
    expect(show([1, 2])).toBe("[1, 2]");
    expect(show(["a", 'say "hi"\n'])).toBe('["a", "say \\"hi\\"\\n"]');
    expect(show([[1], []])).toBe("[[1], []]");
    expect(show([])).toBe("[]");
  });

  it("leaves a Text on its own, and every other scalar, as it was", () => {
    expect(show("ada")).toBe("ada");
    expect(show('say "hi"')).toBe('say "hi"');
    expect(show(1.5)).toBe("1.5");
    expect(show(false)).toBe("false");
    expect(show(null)).toBe("");
    expect(show(undefined)).toBe("");
    expect(show(new Uint8Array([104, 105]))).toBe("104,105");
  });

  it("writes a variant as its tag, inside a structure too", () => {
    expect(show({ _tag: "Some", _0: 1 })).toBe("Some");
    expect(show([{ _tag: "Some", _0: 1 }, { _tag: "None" }])).toBe("[Some, None]");
    expect(show({ role: { _tag: "Admin" } })).toBe("{role: Admin}");
  });

  it("writes a Map as its entries, each key in its own literal form", () => {
    expect(show(mapInsert(mapInsert({}, "a", 1), "b", 2), ["m", 0, 0, 0])).toBe('{"a": 1, "b": 2}');
    expect(show(mapInsert({}, 3, "c"), ["m", "number", 0, 0])).toBe('{3: "c"}');
    expect(show(mapInsert({}, true, 1), ["m", "bool", 0, 0])).toBe("{true: 1}");
    expect(show(mapInsert({}, { y: 0, x: 1 }, "o"), ["m", "value", 0, 0])).toBe(
      '{{x: 1, y: 0}: "o"}',
    );
    expect(show(mapInsert({}, [1, 2], 10), ["m", "value", ["t", 0, 0], 0])).toBe("{(1, 2): 10}");
    expect(show({}, ["m", 0, 0, 0])).toBe("{}");
  });

  it("writes a Set as its members in brackets, as a Set literal is written", () => {
    expect(show(setOf([1, 2]), ["s", "number", 0])).toBe("[1, 2]");
    expect(show(setOf(["a"]), ["s", 0, 0])).toBe('["a"]');
    expect(show(setOf([{ _tag: "Red" }]), ["s", "value", 0])).toBe("[Red]");
    expect(show({}, ["s", 0, 0])).toBe("[]");
  });

  it("writes a Tuple in parentheses", () => {
    expect(show([1, "a"], ["t", 0, 0])).toBe('(1, "a")');
  });

  it("follows a shape down through a record, a List and a Map's values", () => {
    const tags = setOf(["x"]);
    expect(show({ name: "ada", tags }, { tags: ["s", 0, 0] })).toBe('{name: "ada", tags: ["x"]}');
    expect(show([tags, {}], ["l", ["s", 0, 0]])).toBe('[["x"], []]');
    expect(show(mapInsert({}, "k", [1, "a"]), ["m", 0, 0, ["t", 0, 0]])).toBe('{"k": (1, "a")}');
  });

  it("is what `+` and `fmt` render, for a structured value too", () => {
    expect(_stdlibCore.add("p: ", { name: "ada" })).toBe('p: {name: "ada"}');
    expect(_stdlibCore.add([1, 2], "!")).toBe("[1, 2]!");
    expect(_stdlibCore.fmt("{0} / {1}", { at: { x: 0 } }, ["a"])).toBe('{at: {x: 0}} / ["a"]');
  });
});

describe("listSort (docs/spec/stdlib.md §2.2.3 List.sort)", () => {
  it("sorts a numeric list numerically, not lexicographically", () => {
    expect(_stdlibCore.listSort([3, 1, 2, 10])).toEqual([1, 2, 3, 10]);
    expect(_stdlibCore.listSort([])).toEqual([]);
    expect(_stdlibCore.listSort(null)).toEqual([]);
  });

  it("sorts a text list as strings", () => {
    expect(_stdlibCore.listSort(["banana", "apple", "cherry"])).toEqual([
      "apple",
      "banana",
      "cherry",
    ]);
  });

  it("does not mutate the input list", () => {
    const xs = [3, 1, 2];
    _stdlibCore.listSort(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

// `find` is typed `Option(T)` by the spec and by the checker, and lowered to
// this helper. The raw `Array.prototype.find` it used to lower to answers
// `undefined` on no match, which is neither a `Some` nor a `None`: `.is-some`
// on it is false whether or not an element was found, and a `match` finds no
// arm. The two cases below are the ones that tell those apart.
describe("listFind (docs/spec/stdlib.md §2.2.3 List.find)", () => {
  it("wraps a hit in Some, so is-some reads true", () => {
    const hit = _stdlibCore.listFind([3, 1, 2], (x) => x > 2);
    expect(hit).toEqual({ _tag: "Some", _0: 3 });
    expect(_stdlibCore.variantIs(hit, "Some")).toBe(true);
  });

  it("answers None on a miss, rather than undefined", () => {
    const miss = _stdlibCore.listFind([3, 1, 2], (x) => x > 99);
    expect(miss).toEqual({ _tag: "None" });
    expect(_stdlibCore.variantIs(miss, "Some")).toBe(false);
    expect(_stdlibCore.variantIs(miss, "None")).toBe(true);
  });

  it("treats a nullish list as empty rather than throwing", () => {
    expect(_stdlibCore.listFind(undefined as unknown as number[], () => true)).toEqual({
      _tag: "None",
    });
  });
});

// Issue #340: `fmt` had no helper at all, so codegen's `_s.fmt ? … : template`
// guard always took the else branch and every call returned its template with
// the placeholders intact. The rules pinned here are the ones docs/spec/stdlib.md
// §2.4.5 now states — including the two it used to leave open.
describe("fmt (docs/spec/stdlib.md §2.4.5)", () => {
  it("replaces each {n} with the argument at that index", () => {
    expect(_stdlibCore.fmt("{0}-{1}", "a", "b")).toBe("a-b");
    expect(_stdlibCore.fmt("Hello {0}, you have {1}", "Ada", 3)).toBe("Hello Ada, you have 3");
  });

  it("reuses an index as many times as the template names it, in any order", () => {
    expect(_stdlibCore.fmt("{1} {0} {1}", "a", "b")).toBe("b a b");
  });

  it("renders an argument through `show`", () => {
    // `show`: a variant is its tag, a nullish is the empty string, a scalar is
    // its text form (the structured values are in the `show` block below).
    expect(_stdlibCore.fmt("{0}", { _tag: "None" })).toBe("None");
    expect(_stdlibCore.fmt("[{0}]", null)).toBe("[]");
    expect(_stdlibCore.fmt("{0}", true)).toBe("true");
    expect(_stdlibCore.fmt("{0}", 1.5)).toBe("1.5");
  });

  it("agrees with `+` on every value, which is what §2.4.5 promises", () => {
    // Asserted against `add` rather than restated: `"x=" + v` and
    // `fmt("x={0}", v)` are two ways to put one value in one sentence, and
    // §2.4.5 says both render it through `show`. `add` used to be
    // `String(a) + String(b)`, which disagreed exactly here — `[object Object]`
    // for an absent Option, `"null"` for a nullish — so this is the assertion
    // that keeps the two halves of the promise from drifting apart again.
    for (const v of [{ _tag: "None" }, { _tag: "Some", _0: 1 }, null, undefined, true, 1.5, "s"]) {
      expect(_stdlibCore.fmt("{0}", v)).toBe(_stdlibCore.add("", v));
    }
  });

  it("leaves an index the arguments do not reach exactly as written", () => {
    expect(_stdlibCore.fmt("{0} {1}", "a")).toBe("a {1}");
    expect(_stdlibCore.fmt("{3}", "a")).toBe("{3}");
    expect(_stdlibCore.fmt("{0}")).toBe("{0}");
  });

  it("drops an argument no placeholder names", () => {
    // The direction with no trace in the output: the result is what a correct
    // call would render, so nothing downstream can tell the value was passed.
    // W0214 is what makes it visible, and only for a literal template — this
    // is what the runtime does when the template is an expression.
    expect(_stdlibCore.fmt("{0}", "a", "b")).toBe("a");
    expect(_stdlibCore.fmt("none here", "a")).toBe("none here");
  });

  it("copies through a `{` that opens no placeholder, with no escape", () => {
    expect(_stdlibCore.fmt("{}", "a")).toBe("{}");
    expect(_stdlibCore.fmt("{a}", "a")).toBe("{a}");
    expect(_stdlibCore.fmt("{ 0 }", "a")).toBe("{ 0 }");
    expect(_stdlibCore.fmt("{01", "a")).toBe("{01");
    expect(_stdlibCore.fmt("0}", "a")).toBe("0}");
    // …but `{01}` IS one: the digits are read as a decimal index, so a leading
    // zero is a digit and nothing more. Pinned beside the unclosed `{01` it
    // sits next to in the spec, where the two are easy to conflate.
    expect(_stdlibCore.fmt("{01}", "a", "b")).toBe("b");
    // No escape: the inner `{0}` is the placeholder and the outer braces are text.
    expect(_stdlibCore.fmt("{{0}}", "a")).toBe("{a}");
  });

  it("does not re-scan what it substituted", () => {
    // One left-to-right pass. Otherwise a formatted user string could reach
    // back into the argument list and print an argument it was never given.
    expect(_stdlibCore.fmt("{0}", "{1}", "secret")).toBe("{1}");
  });

  it("takes a nullish template as the empty string rather than throwing", () => {
    expect(_stdlibCore.fmt(null, "a")).toBe("");
    expect(_stdlibCore.fmt(undefined)).toBe("");
  });
});

// A Set is stored as `{ [key]: true }` and a Map as a plain object, so their
// keys are JavaScript object keys — strings, whatever the declared type. The
// readers that hand keys back restore them to the kind the checker recorded
// (stdlib.md §2.2.1 / §2.2.2): without that, a `Set(Int)` read back `["7", "8"]`
// under a `List(Int)` type, and `contains(7)`, `sort` and `+` all disagreed
// with it.
describe("keys read back as the declared key type (docs/spec/stdlib.md §2.2.1 / §2.2.2)", () => {
  const set = _stdlibCore.setAdd(_stdlibCore.setAdd({}, 7), 8);

  it("Set.to-list answers numbers for a numeric element", () => {
    expect(_stdlibCore.toList(set, "number")).toEqual([7, 8]);
  });

  it("Map.keys answers numbers for a numeric key", () => {
    expect(_stdlibCore.mapKeys({ 1: "a", 2: "b" }, "number")).toEqual([1, 2]);
  });

  it("Map.entries pairs a numeric key with its value", () => {
    expect(_stdlibCore.mapEntries({ 1: "a" }, "number")).toEqual([[1, "a"]]);
  });

  it("answers booleans for a Bool key", () => {
    const flags = _stdlibCore.setAdd(_stdlibCore.setAdd({}, true), false);
    expect(_stdlibCore.toList(flags, "bool")).toEqual([true, false]);
    expect(_stdlibCore.mapKeys({ true: 1 }, "bool")).toEqual([true]);
  });

  it("leaves a Text key a string, including one that looks like a number", () => {
    expect(_stdlibCore.mapKeys({ "7": 1, a: 2 })).toEqual(["7", "a"]);
    expect(_stdlibCore.toList(_stdlibCore.setAdd({}, "7"))).toEqual(["7"]);
  });

  // `Map.filter` hands each key to its predicate as `$1`, so it reads keys
  // too: `m.filter($1 == 3)` on a `Map(Int, _)` compared `"3"` with `3` under a
  // strict `eq` and kept nothing.
  it("Map.filter hands its predicate the restored key and keeps the entry under its stored key", () => {
    const seen: unknown[] = [];
    const pred = (pair: unknown) => {
      const [k] = pair as [unknown, unknown];
      seen.push(k);
      return k === 3;
    };
    expect(_stdlibCore.filter({ 3: "c", 4: "d" }, pred, "number")).toEqual({ 3: "c" });
    expect(seen).toEqual([3, 4]);
  });
});

// `Map(K, V).map` lowers to the polymorphic `_s.mapOver`, which used to call
// the fragment once with the whole Map, so a `Map(Int, Text)` slot ended up
// holding the string `"[object Object]!"`.
describe("mapOver on a Map (docs/spec/stdlib.md §2.2.1 Map.map)", () => {
  // The fragment is called the way `filter` calls its predicate: with one
  // argument, the `[key, value]` pair, which the generated lambda takes apart
  // into `$1` / `$2`.
  it("hands the fragment one [key, value] argument, the key restored to its kind", () => {
    const calls: unknown[][] = [];
    const out = _stdlibCore.mapOver(
      { 3: "c", 4: "d" },
      (...args: unknown[]) => {
        calls.push(args);
        const [, v] = args[0] as [unknown, unknown];
        return `${String(v)}!`;
      },
      "number",
    );
    expect(calls).toEqual([[[3, "c"]], [[4, "d"]]]);
    expect(out).toEqual({ 3: "c!", 4: "d!" });
  });

  it("hands a two-element structured key whole, inside the pair", () => {
    const calls: unknown[][] = [];
    const out = _stdlibCore.mapOver(
      { "[1,2]": "a" },
      (...args: unknown[]) => {
        calls.push(args);
        return `${String((args[0] as [unknown, unknown])[1])}!`;
      },
      "value",
    );
    expect(calls).toEqual([[[[1, 2], "a"]]]);
    expect(out).toEqual({ "[1,2]": "a!" });
  });

  // A `Map(Text, _)` may have a `"_tag"` key; only a real variant tag makes it
  // an Option / Result, as `filter` decides with `variantIs`.
  it('maps a Map that has a "_tag" key instead of returning it unchanged', () => {
    const out = _stdlibCore.mapOver(
      { _tag: "label", a: "x" },
      (pair) => `${String((pair as [unknown, unknown])[1])}!`,
    );
    expect(out).toEqual({ _tag: "label!", a: "x!" });
  });
});

// `Option(T).filter` lowers to the polymorphic `_s.filter`, which used to read
// an Option's own representation (`{_tag, _0}`) as a Map and filter its fields.
// The result was neither a `Some` nor a `None`.
describe("filter on an Option (docs/spec/stdlib.md §2.2.4 Option.filter)", () => {
  it("keeps a Some whose value passes the predicate", () => {
    const kept = _stdlibCore.filter(_stdlibCore.Some(3), (x) => (x as number) > 2);
    expect(kept).toEqual({ _tag: "Some", _0: 3 });
  });

  it("turns a Some whose value fails the predicate into None", () => {
    const dropped = _stdlibCore.filter(_stdlibCore.Some(3), (x) => (x as number) > 5);
    expect(dropped).toEqual({ _tag: "None" });
    expect(_stdlibCore.variantIs(dropped, "None")).toBe(true);
  });

  it("calls the predicate with the Option's value, not with its fields", () => {
    const seen: unknown[][] = [];
    _stdlibCore.filter(_stdlibCore.Some(3), (...args) => {
      seen.push(args);
      return true;
    });
    expect(seen).toEqual([[3]]);
  });

  it("leaves a None a None without calling the predicate", () => {
    let calls = 0;
    const out = _stdlibCore.filter(_stdlibCore.None, () => {
      calls++;
      return true;
    });
    expect(out).toEqual({ _tag: "None" });
    expect(calls).toBe(0);
  });

  it("still filters a Map entry-wise", () => {
    const pred = (pair: unknown) => (pair as [string, number])[1] > 1;
    expect(_stdlibCore.filter({ a: 1, b: 2 }, pred)).toEqual({ b: 2 });
  });
});

// `xs[i]` reads the element the same write names (language.md §1.6.3), so an
// index that names no element panics on both sides of `:=`. A Map is a plain
// object and is read by key.
describe("an index read (docs/spec/language.md §1.6.3)", () => {
  it("reads the element of a List at the index", () => {
    expect(_stdlibCore.index([10, 20, 30], 1)).toBe(20);
  });

  it("panics for an index past the end or a negative one", () => {
    expect(() => _stdlibCore.index([10, 20, 30], 7)).toThrow(KumikiPanic);
    expect(() => _stdlibCore.index([10, 20, 30], 7)).toThrow(
      "Index 7 is out of range for a List of length 3",
    );
    expect(() => _stdlibCore.index([10, 20, 30], -1)).toThrow(KumikiPanic);
  });

  it("reads a Map entry by key, a numeric key included", () => {
    expect(_stdlibCore.index({ a: 1 }, "a")).toBe(1);
    expect(_stdlibCore.index({ 5: "x" }, 5)).toBe("x");
  });

  // An absent key answered `undefined`, which no `V` is, and the next read
  // through it (`todos["zz"].title`) was a raw TypeError outside the panic
  // model. It is a panic, as an index past the end of a List is.
  it("panics for a key the Map does not hold", () => {
    expect(() => _stdlibCore.index({ a: 1 }, "zz")).toThrow(KumikiPanic);
    expect(() => _stdlibCore.index({ a: 1 }, "zz")).toThrow('Key "zz" is not in the Map');
    expect(() => _stdlibCore.index({ 5: "x" }, 6)).toThrow("Key 6 is not in the Map");
  });

  // A structured key is shown in its `entryKey` encoding (fields sorted, a
  // variant as its `_tag` object): the one spelling the Map stores it under,
  // pinned here so the `app.error` message does not drift on its own.
  it("shows a record key and a union key in their entry encoding", () => {
    expect(() => _stdlibCore.index({}, { y: 2, x: 1 })).toThrow(
      'Key {"x":1,"y":2} is not in the Map',
    );
    expect(() => _stdlibCore.index({}, { _tag: "Red" })).toThrow(
      'Key {"_tag":"Red"} is not in the Map',
    );
  });

  it("does not read an Object.prototype member as an entry", () => {
    expect(() => _stdlibCore.index({}, "toString")).toThrow(KumikiPanic);
  });
});

describe("one key per value (docs/spec/stdlib.md §2.2.1 / §2.2.2)", () => {
  const s = _stdlibCore;
  const red = () => ({ _tag: "Red" });

  it("keeps distinct variants and records apart, and equal ones together", () => {
    const set = s.setAdd(s.setAdd({}, red()), { _tag: "Blue" });
    expect(s.setHas(set, red())).toBe(true);
    expect(s.setHas(set, { _tag: "Green" })).toBe(false);
    const m = s.mapInsert(s.mapInsert({}, { x: 0, y: 1 }, "a"), { y: 1, x: 0 }, "b");
    expect(s.mapSize(m)).toBe(1);
    expect(s.mapGet(m, { x: 0, y: 1 })).toBe("b");
    expect(s.index(m, { y: 1, x: 0 })).toBe("b");
  });

  it("removes the entry the other members stored, for any key type", () => {
    expect(s.mapRemove({ 1: "a", 2: "b" }, 1)).toEqual({ 2: "b" });
    expect(s.mapRemove(s.setAdd(s.setAdd({}, true), false), true)).toEqual({ false: true });
    expect(s.mapRemove(s.setAdd(s.setAdd({}, red()), { _tag: "Blue" }), red())).toEqual({
      '{"_tag":"Blue"}': true,
    });
    expect(s.mapRemove({ a: 1, b: 2 }, "a")).toEqual({ b: 2 });
  });

  it("reads a structured key back as the value it was written from", () => {
    const m = s.mapInsert({}, { y: 2, x: 1 }, 7);
    expect(s.mapKeys(m, "value")).toEqual([{ x: 1, y: 2 }]);
    expect(s.mapEntries(m, "value")).toEqual([[{ x: 1, y: 2 }, 7]]);
    expect(s.toList(s.setAdd({}, red()), "value")).toEqual([red()]);
  });

  it("panics, naming the key, on a structured key no member stored", () => {
    // A record key stored before keys were encoded, or a decoded Map whose
    // keys are bare variant names: neither is the JSON a structured key reads
    // back from, so the reader says so instead of throwing a bare SyntaxError.
    expect(() => s.mapKeys({ "[object Object]": 1 }, "value")).toThrow(KumikiPanic);
    expect(() => s.mapEntries({ Red: 1 }, "value")).toThrow(/"Red"/);
    expect(() => s.toList({ "[object Object]": true }, "value")).toThrow(
      /"\[object Object\]" was not stored by a Set or Map member/,
    );
  });
});

describe("value equality (docs/spec/language.md §1.9.4)", () => {
  const { eq, contains, listUnique } = _stdlibCore;

  it("compares Lists, records, tuples, Maps and variant payloads by value", () => {
    expect(eq([], [])).toBe(true);
    expect(eq([1, [2, 3]], [1, [2, 3]])).toBe(true);
    expect(eq({ x: 1, y: 2 }, { y: 2, x: 1 })).toBe(true);
    expect(
      eq(
        { _tag: "Some", _0: { _tag: "Some", _0: 1 } },
        { _tag: "Some", _0: { _tag: "Some", _0: 1 } },
      ),
    ).toBe(true);
    expect(eq({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("tells different values apart", () => {
    expect(eq([1, 2], [2, 1])).toBe(false);
    expect(eq([1], [1, 1])).toBe(false);
    expect(eq({ x: 1, y: 2 }, { x: 1, y: 3 })).toBe(false);
    expect(eq({ a: undefined }, { b: undefined })).toBe(false);
    expect(eq({ _tag: "Some", _0: 1 }, { _tag: "None" })).toBe(false);
    expect(eq([1], { 0: 1 })).toBe(false);
    expect(eq(null, undefined)).toBe(false);
  });

  it("contains and listUnique ask eq's question, and contains on Text is a substring test", () => {
    const admin = () => ({ _tag: "Admin" });
    expect(contains([admin(), { _tag: "Editor" }], admin())).toBe(true);
    expect(contains([admin()], { _tag: "Viewer" })).toBe(false);
    expect(contains(null, 1)).toBe(false);
    expect(contains("kumiki", "mik")).toBe(true);
    expect(listUnique([admin(), admin(), { _tag: "Viewer" }, admin()])).toEqual([
      { _tag: "Admin" },
      { _tag: "Viewer" },
    ]);
    expect(listUnique([3, 1, 3, 2, 1])).toEqual([3, 1, 2]);
    expect(contains(["ab", "cd"], "b")).toBe(false);
    expect(contains(["ab", "cd"], "cd")).toBe(true);
  });

  it("compares Bytes byte by byte", () => {
    const { bytesFromText } = _stdlibCore;
    expect(eq(bytesFromText("abc"), bytesFromText("abc"))).toBe(true);
    expect(eq(bytesFromText("abc"), bytesFromText("abd"))).toBe(false);
    expect(eq(bytesFromText("ab"), bytesFromText("abc"))).toBe(false);
    expect(eq(bytesFromText("ab"), [97, 98])).toBe(false);
    expect(eq(bytesFromText("ab"), { 0: 97, 1: 98 })).toBe(false);
  });

  // A Blob, File or Date keeps its state outside its own enumerable keys, so
  // key-wise it is an empty bag and any two would compare equal.
  it.each([
    ["a Blob", () => new Blob(["aaa"]), () => new Blob(["bbb"])],
    ["a File", () => new File(["aaa"], "a.txt"), () => new File(["bbb"], "a.txt")],
    ["a Date", () => new Date(0), () => new Date(999)],
  ])("%s equals only itself", (_what, one, other) => {
    const a = one();
    expect(eq(a, a)).toBe(true);
    expect(eq(a, other())).toBe(false);
    expect(eq(a, one())).toBe(false);
  });

  it("keeps apart two picked files whose name, size and type agree", () => {
    const picked = (body: string) => {
      const file = new File([body], "a.txt", { type: "text/plain" });
      return { name: file.name, size: file.size, type: file.type, _file: file };
    };
    const a = picked("aaa");
    const b = picked("bbb");
    expect(eq(a, b)).toBe(false);
    expect(eq(a, a)).toBe(true);
    expect(listUnique([a, b, a])).toEqual([a, b]);
    expect(contains([a], b)).toBe(false);
  });

  it("answers a nullish or empty List with an empty List", () => {
    expect(listUnique(null)).toEqual([]);
    expect(listUnique(undefined)).toEqual([]);
    expect(listUnique([])).toEqual([]);
  });

  it("never finds NaN, the way == does not", () => {
    expect(eq(Number.NaN, Number.NaN)).toBe(false);
    expect(contains([Number.NaN], Number.NaN)).toBe(false);
    expect(listUnique([Number.NaN, 1, Number.NaN, 1])).toEqual([Number.NaN, 1, Number.NaN]);
    expect(listUnique([0, -0, "0", 0])).toEqual([0, "0"]);
  });
});

describe("isEmpty's scalar tail (docs/spec/stdlib.md §2.2.1 / §2.2.3 / §2.2.6 is-empty)", () => {
  // A missing value cannot be written as a slot's initial value, so the
  // receiver rows in `packages/tests` never reach this half of the last line.
  it("a missing value is empty", () => {
    expect(_stdlibCore.isEmpty(undefined)).toBe(true);
    expect(_stdlibCore.isEmpty(null)).toBe(true);
  });

  it("any other scalar is not empty, zero and false included", () => {
    expect(_stdlibCore.isEmpty(0)).toBe(false);
    expect(_stdlibCore.isEmpty(7)).toBe(false);
    expect(_stdlibCore.isEmpty(false)).toBe(false);
  });
});
