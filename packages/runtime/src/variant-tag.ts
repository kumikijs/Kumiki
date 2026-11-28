// The field a variant value carries its name in: `{_tag: "Some", _0: 1}`. In the runtime, beside
// the values it names, so the checker that reserves the field and the codegen that writes
// variants read it from one place. A subpath of its own, so the compiler does not evaluate the
// whole runtime to reach one name.
export const VARIANT_TAG_FIELD = "_tag";
