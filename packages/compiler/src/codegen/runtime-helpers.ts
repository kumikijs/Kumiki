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
`;
