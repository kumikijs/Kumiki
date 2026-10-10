export const RUNTIME_HELPERS = `
function _children(...xs) {
  const out = [];
  const add = (x) => {
    if (x === null || x === undefined) return;
    if (Array.isArray(x)) for (const y of x) add(y);
    else out.push(x);
  };
  for (const x of xs) add(x);
  return out;
}
function _attachProps(node, props) {
  if (node === null || node === undefined || !props) return node;
  if (Array.isArray(node)) return node.map((n) => _attachProps(n, props));
  if (typeof node !== "object" || typeof node.kind !== "string") return node;
  if (Object.keys(props).length === 0) return node;
  return { ...node, props: _mergeProps(node.props || {}, props) };
}
function _mergeProps(own, call, inEl) {
  const out = { ...own, ...call };
  if (own.aria && call.aria) out.aria = { ...own.aria, ...call.aria };
  if (!inEl && own.el && call.el) out.el = _mergeProps(own.el, call.el, true);
  return out;
}
function _named(node, name) {
  if (node === null || node === undefined) return node;
  if (Array.isArray(node)) return node.map((n) => _named(n, name));
  if (typeof node !== "object" || typeof node.kind !== "string") return node;
  return { ...node, props: { ...(node.props || {}), _tile: name } };
}
function _wk(node, key) {
  if (node === null || node === undefined) return node;
  if (key === undefined || key === null || key === "") {
    throw new Error(
      "TileNode.key must be a non-empty string; got " +
        (key === "" ? '""' : String(key)) +
        ". A {key: expr} value evaluated to null / undefined / empty string, which would collapse distinct tiles onto a single identity in the keyed reconciler."
    );
  }
  if (Array.isArray(node)) {
    return _children(node).map((n, i) =>
      _wk(n, JSON.stringify([key, typeof n.key === "string" ? n.key : i])),
    );
  }
  return { ...node, key: key };
}
`;
