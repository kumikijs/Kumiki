import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

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

describe("the Err payload of a storage-family effect", () => {
  it("is Text: reading it as Text passes, reading a member Text lacks does not", () => {
    expect(
      diagnostics(
        app(`slot problem : Text = ""
slot detail : Text = ""
${LOAD}
reducer failed on=loadSession.err($e, _) do= problem := $e
reducer member on=loadSession.err($e, _) do= detail := $e.message`),
      ),
    ).toEqual(['E0108 8 Type "Text" has no member ".message"']);
  });

  it("a slot of another type is a mismatch", () => {
    expect(
      diagnostics(
        app(`slot n : Int = 0
${LOAD}
reducer failed on=loadSession.err($e, _) do= n := $e`),
      ),
    ).toEqual(["E0201 6 Expected Int but got Text"]);
  });

  it.each([
    ["session.read", `map-request={key: "k", decode: Decoder.Json(Session)}`],
    ["indexed.read", `map-request={store: "s", key: "k", decode: Decoder.Json(Session)}`],
    ["indexed.write", `map-request={store: "s", key: "k", value: $1}`],
    ["indexed.delete", `map-request={store: "s", key: "k"}`],
    ["storage.write", `map-request={key: "k", value: $1}`],
    ["session.write", `map-request={key: "k", value: $1}`],
  ])("holds for cap=%s", (cap, mapRequest) => {
    const src = `type Session = {email: Text}
slot n : Int = 0
effect run cap=${cap} in=Unit out=Result(Unit, Text)
    ${mapRequest}
reducer boot   on=app.start        do= emit run()
reducer failed on=run.err($e, _)   do= n := $e
tile App = column(text("x"))
app A
    caps   = [${cap}]
    routes = {"/" -> App, "/404" -> App}
    init   = []`;
    expect(diagnostics(src)).toEqual(["E0201 6 Expected Int but got Text"]);
  });
});

describe("a storage-family effect that declares an E other than Text", () => {
  it("is E0306, and $e is the Text that arrives rather than the declared record", () => {
    expect(
      diagnostics(
        app(`slot problem : Text = ""
slot raw : Text = ""
${effect("loadSession", "Result(Option(Session), {message: Text})")}
reducer failed on=loadSession.err($e, _) do= problem := $e.message
reducer kept   on=loadSession.err($e, _) do= raw := $e`),
      ),
    ).toEqual([
      'E0306 4 effect "loadSession" with cap=storage.read declares its error as {message: Text}, but storage.read delivers a failure as its message, a Text — declare out=Result(Option(Session), Text)',
      'E0108 7 Type "Text" has no member ".message"',
    ]);
  });

  it("is E0306 for an Int E, and storing $e into an Int slot is still a mismatch", () => {
    expect(
      diagnostics(
        app(`slot n : Int = 0
${effect("loadSession", "Result(Option(Session), Int)")}
reducer failed on=loadSession.err($e, _) do= n := $e`),
      ),
    ).toEqual([
      'E0306 3 effect "loadSession" with cap=storage.read declares its error as Int, but storage.read delivers a failure as its message, a Text — declare out=Result(Option(Session), Text)',
      "E0201 6 Expected Int but got Text",
    ]);
  });

  it("an E or a whole out= that names Text through an alias is Text, and an E that does not is reported", () => {
    expect(
      diagnostics(
        app(`type Message = Text
type Code = Int
type Loaded = Result(Option(Session), Text)
slot n : Int = 0
${effect("viaE", "Result(Option(Session), Message)")}
${effect("viaOut", "Loaded")}
${effect("wrong", "Result(Option(Session), Code)")}
reducer a on=viaE.err($e, _)   do= n := $e
reducer b on=viaOut.err($e, _) do= n := $e`),
      ),
    ).toEqual([
      'E0306 12 effect "wrong" with cap=storage.read declares its error as Code, but storage.read delivers a failure as its message, a Text — declare out=Result(Option(Session), Text)',
      "E0201 15 Expected Int but got Text",
      "E0201 16 Expected Int but got Text",
    ]);
  });

  it.each([
    "storage.write",
    "session.read",
    "session.write",
    "indexed.read",
    "indexed.write",
    "indexed.delete",
  ])("holds for cap=%s", (cap) => {
    const src = `effect run cap=${cap} in=Unit out=Result(Unit, Int)
reducer boot on=app.start do= emit run()
tile App = column(text("x"))
app A
    caps   = [${cap}]
    routes = {"/" -> App, "/404" -> App}
    init   = []`;
    expect(diagnostics(src)).toEqual([
      `E0306 1 effect "run" with cap=${cap} declares its error as Int, but ${cap} delivers a failure as its message, a Text — declare out=Result(Unit, Text)`,
    ]);
  });

  it("an HTTP effect's E and a storage effect whose out= is not a Result are not this check's", () => {
    const src = `effect load cap=http.get in=Unit out=Result(Text, HttpError)
    map-request={url: "/x", decode: Decoder.Text}
effect peek cap=storage.read in=Unit out=Option(Text)
    map-request={key: "k", decode: Decoder.Text}
effect bad cap=storage.read in=Unit out=Result(Option(Text), Int)
    map-request={key: "k", decode: Decoder.Text}
reducer boot on=app.start do= emit load()
tile App = column(text("x"))
app A
    caps   = [http.get, storage.read]
    routes = {"/" -> App, "/404" -> App}
    init   = []`;
    expect(diagnostics(src).map((d) => d.split(" ").slice(0, 2).join(" "))).toEqual(["E0306 5"]);
  });
});

describe("the Err payload of an effect whose failure value the runtime does not fix", () => {
  it("an HTTP effect's $e reads as the HttpError record it is", () => {
    const src = `slot problem : Text = ""
effect load cap=http.get in=Unit out=Result(Text, HttpError)
    map-request={url: "/x", decode: Decoder.Text}
reducer boot   on=app.start       do= emit load()
reducer failed on=load.err($e, _) do= problem := $e.message
tile App = column(text("x"))
app A
    caps   = [http.get]
    routes = {"/" -> App, "/404" -> App}
    init   = []`;
    expect(diagnostics(src)).toEqual([]);
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
    expect(
      diagnostics(
        app(`slot session : Option(Session) = None
${effect("loadSession", "Result(Option(Session))")}
reducer keep on=loadSession.ok($s, _) do= session := $s`),
      ),
    ).toEqual(['E0210 3 Type "Result" expects 2 type argument(s) but got 1']);
  });
});
