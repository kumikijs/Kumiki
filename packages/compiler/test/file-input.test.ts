import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { checkSource } from "./helpers/diagnostics.ts";

describe('forms — input(type="file") bind=', () => {
  it("reports bind= on a file input (E0205)", () => {
    const src = `
      slot avatar : Option(File) = None
      tile AvatarPicker = input(type="file", bind=avatar, accept="image/*")
      tile App = column(AvatarPicker)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(
      errors.some(
        (e) =>
          e.code === "E0205" &&
          e.kind === "bind-on-file-input" &&
          e.message.includes("avatar") &&
          e.message.includes("$event.files.head"),
      ),
    ).toBe(true);
  });

  it("accepts a file input that uses ui.change instead of bind=", () => {
    const src = `
      slot avatar : Option(File) = None
      tile AvatarPicker = input(type="file", accept="image/*")
      reducer pickFile on=ui.change(AvatarPicker) do= avatar := $event.files.head
      tile App = column(AvatarPicker)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    expect(checkSource(src)).toEqual([]);
  });

  it("does not flag bind= on a non-file input", () => {
    const src = `
      slot draft : Text = ""
      tile In = input(type="text", bind=draft)
      tile App = column(In)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    expect(checkSource(src)).toEqual([]);
  });
});

describe("forms — accept/multiple gated to file inputs (E0206)", () => {
  it("flags accept on a text input (E0206)", () => {
    const src = `
      tile Picker = input(type="text", accept="image/*")
      tile App = column(Picker)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(
      errors.some(
        (e) =>
          e.code === "E0206" &&
          e.kind === "file-only-prop" &&
          e.message.includes("accept") &&
          e.message.includes(`type="file"`),
      ),
    ).toBe(true);
  });

  it("flags accept when type is omitted (defaults to text)", () => {
    const src = `
      tile Picker = input(accept="image/*")
      tile App = column(Picker)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(
      errors.some(
        (e) => e.code === "E0206" && e.kind === "file-only-prop" && e.message.includes("accept"),
      ),
    ).toBe(true);
  });

  it("flags multiple on a text input (E0206)", () => {
    const src = `
      tile Picker = input(type="text", multiple=true)
      tile App = column(Picker)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(
      errors.some(
        (e) => e.code === "E0206" && e.kind === "file-only-prop" && e.message.includes("multiple"),
      ),
    ).toBe(true);
  });

  it("flags both accept and multiple independently on a text input", () => {
    const src = `
      tile Picker = input(type="text", accept="image/*", multiple=true)
      tile App = column(Picker)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    const codes = errors.filter((e) => e.code === "E0206");
    expect(codes.length).toBe(2);
    expect(codes.some((e) => e.message.includes("accept"))).toBe(true);
    expect(codes.some((e) => e.message.includes("multiple"))).toBe(true);
  });

  it("does not flag accept/multiple on a file input", () => {
    const src = `
      slot avatar : Option(File) = None
      tile Picker = input(type="file", accept="image/*", multiple=true)
      reducer pickFile on=ui.change(Picker) do= avatar := $event.files.head
      tile App = column(Picker)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    expect(checkSource(src)).toEqual([]);
  });
});

describe("the fields of a File", () => {
  const source = (read: string) => `
    slot picked : Option(File) = None
    slot shown  : Text = ""
    tile Picker = input(type="file", accept="image/*")
    reducer pick on=ui.change(Picker) do= picked := $event.files.head
    reducer show on=ui.click(Show) do= shown := ${read}
    tile Show = button(text="show")
    tile App = column(Picker, Show)
    app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
  `;

  it.each([
    ["size", "picked.get.size.show"],
    ["name", "picked.get.name"],
    ["type", "picked.get.type"],
  ])("reads .%s as the field, not a container member", (field, read) => {
    const result = compile(source(read), { runtimeSpecifier: "./runtime.js" });
    expect(result.kind === "fail" ? result.errors : []).toEqual([]);
    if (result.kind !== "ok") return;
    expect(result.js).toContain(`["${field}"]`);
    expect(result.js).not.toContain("_s.mapSize");
  });
});
