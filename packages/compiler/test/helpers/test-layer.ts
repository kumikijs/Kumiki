/** A program whose single `test` definition has the given body. */
export function withTest(body: string): string {
  return `type Probe = nominal Text where uuid
slot count : Int = 0
slot label : Text = ""
fn double(x: Int) -> Int = x * 2
effect persist cap=storage.write in=Int out=Result(Unit, Text)
reducer inc on=ui.click(B) do= count := count + 1
reducer save on=ui.click(S) do= emit persist(count)
reducer tick on=timer(1s, name=countdown) do= count := count + 1
reducer failed on=persist.err($e, _) do= label := $e
reducer note on=ui.click(B) do= emit toast({kind: "info", text: "hi"})
tile B = button(text="+", onClick=inc)
tile S = button(text="save", onClick=save)
tile Greeting in=Text = heading("Hi, " + $1)
tile App = column(B, S, text(count.show), text(label))
app A caps=[storage.write, notification.show] routes={"/" -> App, "/404" -> App} init=[]
test t =
${body}
`;
}

/** A reducer-test with the two halves spelled out. */
export const reducerTest = (given: string, expectPart: string) =>
  withTest(`    reducer-test inc
        given  = ${given}
        expect = ${expectPart}`);

export const GIVEN = `{slots: {count: 0}, event: {type: ui.click, target: B}}`;
export const EXPECT = `{slots: {count: 1}, effects: []}`;

export const property = (forAll: string, given: string, invariant: string) =>
  withTest(`    property-test
        for-all   = ${forAll}
        given     = ${given}
        invariant = ${invariant}`);
