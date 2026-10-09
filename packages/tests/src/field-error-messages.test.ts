import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

const SOURCE = `
slot mail  : Text where email                      = "nope"
slot site  : Text where url                        = "nope"
slot token : Text where uuid                       = "nope"
slot name  : Text where nonempty                   = ""
slot pin   : Text where len-eq(4)                   = "1"
slot short : Text where len-lt(3)                   = "abcd"
slot long  : Text where len-gt(3)                   = "ab"
slot vol   : Int  where between(0, 11)              = 12
slot qty   : Int  where positive                    = 0
slot owed  : Int  where negative                    = 0
slot slug  : Text where regex("[a-z]+")             = "NOPE"
slot size  : Text where one-of("sm", "md", "lg")    = "xl"

tile App = column(
             error(field=mail), error(field=site), error(field=token),
             error(field=name), error(field=pin), error(field=short),
             error(field=long), error(field=vol), error(field=qty),
             error(field=owed), error(field=slug), error(field=size))

app FieldErrors
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

afterEach(() => {
  document.body.replaceChildren();
});

describe("the error tile renders §5.7.2's message for the predicate a value fails", () => {
  const expected: [string, string][] = [
    ["mail", "Invalid email format"],
    ["site", "Invalid URL"],
    ["token", "Invalid identifier"],
    ["name", "Required"],
    ["pin", "Must be exactly 4 characters"],
    ["short", "Must be less than 3 characters"],
    ["long", "Must be more than 3 characters"],
    ["vol", "Must be between 0 and 11"],
    ["qty", "Must be positive"],
    ["owed", "Must be negative"],
    ["slug", "Does not match pattern"],
    ["size", "Must be one of: sm, md, lg"],
  ];

  it("covers every predicate the language registers", async () => {
    const app = await loadSource(SOURCE);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mount(app, root);

    const rendered = Object.fromEntries(
      Array.from(root.querySelectorAll("[data-kumiki-tile='error']")).map((el) => [
        (el as HTMLElement).dataset.field,
        el.textContent,
      ]),
    );
    expect(rendered).toEqual(Object.fromEntries(expected));
  });
});
