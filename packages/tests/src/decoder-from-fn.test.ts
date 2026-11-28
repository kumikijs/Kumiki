import { describe, expect, it } from "vitest";
import { clickThrough } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";

// A `fn` answering the decoder hands the handler a value the checker only knows to be a `Decoder`,
// so what is read back shows that the one the `fn` chose is the one the read decoded by.
const SOURCE = `slot shown : Text = "idle"

fn pick(raw: Bool) -> Decoder = if raw then Decoder.Text else Decoder.Json(Text)
fn strict(key: Text) -> Decoder = Decoder.Json(Email)

effect save cap=storage.write in=Text out=Result(Unit, Text) map-request={key: "note", value: $1}
effect load cap=storage.read in=Bool out=Result(Option(Text), Text) map-request={key: "note", decode: pick($1)}
effect loadEmail cap=storage.read in=Text out=Result(Option(Email), Text) map-request={key: $1, decode: strict($1)}

reducer goSave on=ui.click(SaveBtn) do= emit save("hello")
reducer goRaw on=ui.click(RawBtn) do= emit load(true)
reducer goJson on=ui.click(JsonBtn) do= emit load(false)
reducer goEmail on=ui.click(EmailBtn) do= emit loadEmail("note")
reducer saved on=save.ok(_, _) do= shown := "saved"
reducer loaded on=load.ok($o, _) do= shown := "read " + $o.get-or("nothing")
reducer emailed on=loadEmail.ok(_, _) do= shown := "read an Email"
reducer refused on=loadEmail.err($e, _) do= shown := "refused: " + $e

tile SaveBtn = button(text="Save")
tile RawBtn = button(text="Raw")
tile JsonBtn = button(text="Json")
tile EmailBtn = button(text="Email")
tile App = column(SaveBtn, RawBtn, JsonBtn, EmailBtn, text("shown: " + shown))

app D
    caps = [storage.read, storage.write]
    routes = {"/" -> App, "/404" -> App}
    init = []
`;

/** The page's text after saving `"hello"` and then pressing `button`, once the page shows `until`. */
async function afterSave(button: string, until: string): Promise<string> {
  const pages = await clickThrough(
    await loadSource(SOURCE),
    [
      ["Save", "shown: saved"],
      [button, until],
    ],
    (root) => root.textContent ?? "",
  );
  return pages.at(-1) ?? "";
}

describe("a read decodes by the decoder a fn answers", () => {
  it("delivers the stored JSON as it is under Decoder.Text, quotes included", async () => {
    expect(await afterSave("Raw", "shown: read ")).toContain('shown: read "hello"');
    expect(localStorage.getItem("note")).toBe('"hello"');
  });

  it("parses it under Decoder.Json(Text)", async () => {
    expect(await afterSave("Json", "shown: read ")).toContain("shown: read hello");
  });

  it("runs the check a refined Decoder.Json(T) carries, and refuses what it fails", async () => {
    const page = await afterSave("Email", "shown: re");
    expect(page).toContain("shown: refused: decode failed:");
  });
});
