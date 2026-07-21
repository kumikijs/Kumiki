export const RUNTIME_HELPERS = `
function _setPath(obj, path, value) {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const cur = obj ?? {};
  return { ...cur, [head]: _setPath(cur[head], rest, value) };
}
function _children(...xs) {
  const out = [];
  for (const x of xs) {
    if (x === null || x === undefined) continue;
    if (Array.isArray(x)) {
      for (const y of x) if (y !== null && y !== undefined) out.push(y);
    } else {
      out.push(x);
    }
  }
  return out;
}
function _attachProps(node, props) {
  if (!node || !props) return node;
  return { ...node, props: { ...(node.props || {}), ...props } };
}
function _named(node, name) {
  if (node === null || node === undefined) return node;
  if (Array.isArray(node)) return node.map((n) => _named(n, name));
  if (typeof node !== "object" || typeof node.kind !== "string") return node;
  return { ...node, props: { ...(node.props || {}), _tile: name } };
}
// _wk (with-key) — stamps stable tile identity onto the emitted TileNode.
// Used by codegen at every tile call site that either declared its own
// {key: expr} or sits inside a for iteration whose loop variable supplies
// the implicit key. The reconciler in runtime/core.ts reads node.key on both
// sides of a diff to do keyed child matching (survives reorder/insert/remove).
// Rejects null / undefined / empty-string keys — those collapse different
// tiles onto one identity and mask real bugs (e.g. show() on nil coerces
// to the empty string, making every "no-key" item collide). Throws so
// the outer render bailout catches the panic and falls back to a full
// rebuild rather than silently reusing the wrong DOM element.
function _wk(node, key) {
  if (node === null || node === undefined) return node;
  if (key === undefined || key === null || key === "") {
    throw new Error(
      "TileNode.key must be a non-empty string; got " +
        (key === "" ? '""' : String(key)) +
        ". A {key: expr} value (or a for-loop variable used as an implicit key) evaluated to null / undefined / empty string, which would collapse distinct tiles onto a single identity in the keyed reconciler."
    );
  }
  return { ...node, key: key };
}
`;
