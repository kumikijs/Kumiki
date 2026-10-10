import { ROUTE_SLOT_FIELDS } from "@kumikijs/compiler";
import { emptyRoute } from "@kumikijs/runtime";
import { expect, it } from "vitest";

// The compiler rejects a route seed naming a field outside this set, and the runtime fills the
// rest of a partial seed from emptyRoute; a field on one side only is a false E0108 or an
// undefined field at runtime.
it("the route fields a test may seed are exactly the ones the runtime fills", () => {
  expect([...ROUTE_SLOT_FIELDS].sort()).toEqual(Object.keys(emptyRoute()).sort());
});
