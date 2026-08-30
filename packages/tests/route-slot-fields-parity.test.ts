// The compiler rejects a `route` seed naming a field the slot does not have,
// and the runtime completes a partial seed from `emptyRoute`. Two declarations
// of one field set: if the runtime gains a route field the compiler does not
// know, a test naming it is reported as a typo; if the compiler gains one the
// runtime does not supply, the completion leaves it `undefined` — the panic
// the seeding exists to prevent, arriving through the check that was supposed
// to prevent it.
//
// Compared here, in the one package that depends on both.

import { ROUTE_SLOT_FIELDS } from "@kumikijs/compiler";
import { emptyRoute } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

describe("the route fields a test may name", () => {
  it("are exactly the ones the runtime seeds", () => {
    expect([...ROUTE_SLOT_FIELDS].sort()).toEqual(Object.keys(emptyRoute()).sort());
  });
});
