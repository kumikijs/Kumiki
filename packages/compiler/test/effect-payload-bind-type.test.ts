import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

// An `effect-event` trigger binds the effect's result — `load.ok($v, $key)` /
// `load.err($e, $key)` (language.md §1.6.5) — and the effect's `out=` says what
// a success is. Nothing carried the type to the bind, so every read of one was
// undecidable and every assignment out of one was accepted: the shape the
// `.get-or` defect actually shipped in, `session := $s.get-or(None)`, passed
// `check` although the same call on a slot receiver is a pair of E0201s.
//
// `$1` on `.ok` now has the type `out=` declares: the Ok payload of a
// `Result(T, E)`, or the whole value of any other `out=`. `$1` on `.err`, the
// request key (`$2`) and a result no declaration types stay undecided — the
// err value is the runtime's failure record, which `E` does not describe.
//
// Each case that pins something staying *quiet* shares its program with one
// that must report, and the expectation is the whole list — so the quiet half
// cannot pass merely because payload binds are untyped altogether.

const app = (defs: string): string =>
  `type Session = {email: Text}
${defs}
tile B = button(text="x")
tile App = column(B)
app A
    caps   = [storage.read]
    routes = {"/" -> App, "/404" -> App}
    init   = []`;

const effect = (name: string, out: string): string =>
  `effect ${name} cap=storage.read in=Unit out=${out}
    map-request={key: "session", decode: Decoder.Json(Session)}
reducer boot-${name} on=app.start do= emit ${name}()`;

const LOAD = effect("loadSession", "Result(Option(Session), Text)");

const diagnostics = (src: string) =>
  check(parse(lex(src))).map((e) => `${e.code} ${e.pos.line} ${e.message}`);

describe("the Ok payload of a Result out=", () => {
  it("is the Ok type: a slot of another type is a mismatch, a slot of that type is not", () => {
    expect(
      diagnostics(
        app(`slot label : Text = ""
slot session : Option(Session) = None
${LOAD}
reducer raw  on=loadSession.ok($s, _) do= label := $s
reducer keep on=loadSession.ok($s, _) do= session := $s`),
      ),
    ).toEqual(["E0201 7 Expected Text but got Option(Session)"]);
  });

  it("a method call on it resolves from that type — the same pair a slot receiver gets", () => {
    expect(
      diagnostics(
        app(`slot session : Option(Session) = None
${LOAD}
reducer sessIn on=loadSession.ok($s, _) do= session := $s.get-or(None)`),
      ),
    ).toEqual([
      'E0201 6 Expected Session but got variant "None"',
      "E0201 6 Expected Option(Session) but got Session",
    ]);
  });

  it("an out= named through an alias still splits into its payloads", () => {
    expect(
      diagnostics(
        app(`type Loaded = Result(Option(Session), Text)
slot label : Text = ""
${effect("loadSession", "Loaded")}
reducer raw on=loadSession.ok($s, _) do= label := $s`),
      ),
    ).toEqual(["E0201 7 Expected Text but got Option(Session)"]);
  });
  it("an out= named through a generic alias splits into the substituted payloads", () => {
    expect(
      diagnostics(
        app(`type Loaded(T) = Result(T, Text)
slot label : Text = ""
slot session : Option(Session) = None
${effect("loadSession", "Loaded(Option(Session))")}
reducer raw  on=loadSession.ok($s, _) do= label := $s
reducer keep on=loadSession.ok($s, _) do= session := $s`),
      ),
    ).toEqual(["E0201 8 Expected Text but got Option(Session)"]);
  });
});

describe("the Err payload", () => {
  it("is undecided: the runtime's err value is not the declared E, so no read of it is claimed", () => {
    // `out=Result(T, E)` declares `E`, but the built-in handlers deliver their
    // own failure record — storage / session / indexed and the dispatcher's
    // catch give `{message: …}`, whatever `E` says. Typing `$e` as `E` would
    // reject `$e.message`, the read that matches what arrives, and accept
    // `problem := $e`, which puts a record into a `Text` slot. Until the two
    // agree, `$e` is not typed from `out=`. The `.ok` reducer in the same
    // program shows the binds are typed at all.
    expect(
      diagnostics(
        app(`slot problem : Text = ""
slot label : Text = ""
${LOAD}
reducer raw    on=loadSession.ok($s, _)  do= label := $s
reducer failed on=loadSession.err($e, _) do= problem := $e.message`),
      ),
    ).toEqual(["E0201 7 Expected Text but got Option(Session)"]);
  });
});

describe("what stays undecided", () => {
  it("the second bind, the request key", () => {
    expect(
      diagnostics(
        app(`slot label : Text = ""
slot n : Int = 0
${LOAD}
reducer keyed on=loadSession.ok($s, $k)
    do= label := $s
        n := $k`),
      ),
    ).toEqual(["E0201 8 Expected Text but got Option(Session)"]);
  });

  it("an out= whose type is undecidable leaves its bind undecided", () => {
    // `Missing` is reported where it is written; the bind adds no second
    // report by guessing a type for it.
    const errs = diagnostics(
      app(`slot label : Text = ""
${effect("loadMissing", "Missing")}
${LOAD}
reducer a on=loadMissing.ok($m, _) do= label := $m
reducer b on=loadSession.ok($s, _) do= label := $s`),
    ).filter((d) => d.startsWith("E0201"));
    expect(errs).toEqual(["E0201 10 Expected Text but got Option(Session)"]);
  });

  it("a Result out= of the wrong arity is reported once, and its bind stays undecided", () => {
    // E0210 already says the `Result` is malformed; the bind must not then be
    // typed as that malformed `Result` and add an E0201 of its own.
    expect(
      diagnostics(
        app(`slot session : Option(Session) = None
${effect("loadSession", "Result(Option(Session))")}
reducer keep on=loadSession.ok($s, _) do= session := $s`),
      ),
    ).toEqual(['E0210 3 Type "Result" expects 2 type argument(s) but got 1']);
  });
});
