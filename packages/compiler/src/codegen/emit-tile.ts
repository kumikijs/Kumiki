import type { Expr, TileDef, TileExpr } from "../ast.ts";
import { isTileExpr } from "../ast.ts";
import { BUILTIN_TILES } from "../builtins.ts";
import { addBind, type EvalCtx, type GenCtx, jsBinding, makeEvalCtx } from "./context.ts";
import { jsOfExpr, tupleArm } from "./expr.ts";
import { keyFor, propsFor } from "./selector.ts";

export function genTile(tile: TileDef, gen: GenCtx): string {
  const ctx = makeEvalCtx(gen, new Set(tile.in ? ["$1"] : []));
  return tileExprJs(tile.body, gen, ctx, tile.name);
}

/**
 * The `try` / `catch` a tile's `error-boundary` lowers to — a panic while
 * rendering under `def` produces the named fallback instead, with `PanicInfo`
 * as its `$1` (lifecycle.md §7.3).
 *
 * Wraps `body` from the outside, so the fallback is not itself named: what the
 * runtime diffs mount/unmount against is the tree that actually rendered.
 */
function boundaryJs(def: TileDef, body: string, gen: GenCtx): string {
  if (!def.errorBoundary) return body;
  const fb = gen.tiles.find((x) => x.name === def.errorBoundary);
  if (!fb) return body;
  const fbCtx = makeEvalCtx(gen, new Set(["$1"]));
  const fbBody = tileExprJs(fb.body, gen, fbCtx, fb.name);
  return `((() => { try { return ${body}; } catch (_err) { const ${jsBinding("$1")} = { message: String(_err && _err.message || _err), location: ${JSON.stringify(def.name)} }; return ${fbBody}; } })())`;
}

/**
 * A tile lowered for the position a route names it in.
 *
 * A route target is a call site of that tile, so it gets what every other call
 * site gets: the `_named(…)` marker the runtime diffs `tile.mount` /
 * `tile.unmount` against (lifecycle.md §7.1.6), and its `error-boundary`
 * (§7.3, which scopes the boundary to renders *under that tile* — a statement
 * about the tile, not about where it was written).
 *
 * Separate from `genTile` because that has a third caller: the `_tilesById`
 * table a `tile-test` compares against, which wants the bare tree.
 */
export function genRouteTile(tile: TileDef, gen: GenCtx): string {
  return boundaryJs(tile, `_named(${genTile(tile, gen)}, ${JSON.stringify(tile.name)})`, gen);
}

export function tileExprJs(
  t: TileExpr,
  gen: GenCtx,
  ctx: EvalCtx,
  enclosingTile?: string,
  // When the enclosing scope is a `TileFor`, this carries the implicit key
  // expression (`_s.show(<loopVar>)`) that any tile call in the body should
  // stamp on itself unless it declared an explicit `{key: …}`. Propagates
  // transparently through TileWhen / TileIf / TileMatch arms; resets at
  // user-tile boundaries (see `tileCallJs`).
  implicitKeyExpr?: string,
): string {
  switch (t.kind) {
    case "TileFor": {
      const iter = jsOfExpr(t.iter, ctx);
      const inner = makeEvalCtx(gen, ctx.localBinds);
      inner.localBinds.add(t.bind);
      const impl = `_s.show(${jsBinding(t.bind)})`;
      // Returns Array<Node|Node[]>. Caller (collectChildren / _children) flattens.
      return `((${iter}) || []).map((${jsBinding(t.bind)}) => (${tileExprJs(t.body, gen, inner, enclosingTile, impl)}))`;
    }
    case "TileWhen":
      // Returns a Node or null. Caller flattens nulls away.
      return `((${jsOfExpr(t.cond, ctx)}) ? (${tileExprJs(t.body, gen, ctx, enclosingTile, implicitKeyExpr)}) : null)`;
    case "TileIf":
      return `((${jsOfExpr(t.cond, ctx)}) ? (${tileExprJs(t.consequent, gen, ctx, enclosingTile, implicitKeyExpr)}) : (${tileExprJs(t.alternate, gen, ctx, enclosingTile, implicitKeyExpr)}))`;
    case "TileMatch": {
      const sc = jsOfExpr(t.scrutinee, ctx);
      const arms = t.arms
        .map((arm) => {
          if (arm.pattern.kind === "PVariant") {
            const inner = makeEvalCtx(gen, ctx.localBinds);
            for (const b of arm.pattern.binds) if (b !== "_") inner.localBinds.add(b);
            const binds = arm.pattern.binds
              .map((b, i) =>
                b !== "_" ? `const ${jsBinding(b)} = _v[${JSON.stringify(`_${i}`)}];` : "",
              )
              .join(" ");
            return `if (_s.variantIs(_v, ${JSON.stringify(arm.pattern.name)})) { ${binds} return ${tileExprJs(arm.body, gen, inner, enclosingTile, implicitKeyExpr)}; }`;
          }
          if (arm.pattern.kind === "PBind") {
            const inner = makeEvalCtx(gen, ctx.localBinds);
            inner.localBinds.add(arm.pattern.name);
            return `if (true) { const ${jsBinding(arm.pattern.name)} = _v; return ${tileExprJs(arm.body, gen, inner, enclosingTile, implicitKeyExpr)}; }`;
          }
          if (arm.pattern.kind === "PWildcard") {
            return `if (true) { return ${tileExprJs(arm.body, gen, ctx, enclosingTile, implicitKeyExpr)}; }`;
          }
          // PTuple — TileMatch reuses the shared `tupleArm` helper. `ctx` carries
          // no reducerScope here (tile-match runs in pure render context), so the
          // helper's `inheritReducerScope=false` path is what we want.
          {
            const { guard, binds, inner } = tupleArm(arm.pattern, ctx, "_v", false);
            return `if (${guard}) { ${binds} return ${tileExprJs(arm.body, gen, inner, enclosingTile, implicitKeyExpr)}; }`;
          }
        })
        .join(" else ");
      // The no-match fallback renders an empty `text` tile, so the text family
      // must ship whenever a tile-match exists (#71).
      gen.usedTiles.add("text");
      return `((_v) => { ${arms} else { return { kind: "text", text: "" }; } })(${sc})`;
    }
    case "TileCall":
      return tileCallJs(
        t as TileExpr & { kind: "TileCall" },
        gen,
        ctx,
        enclosingTile,
        implicitKeyExpr,
      );
  }
}

/**
 * For `bind=draft` or `bind=draft.title.deeper`, extract the root slot name,
 * the static path (string field names), and a JS expression to read the value.
 * Only static field-access paths are supported (no Index, no dynamic lookups).
 * Returns null if no `bind=` arg exists or the path isn't statically resolvable.
 */
export function extractBindPath(
  args: { name?: string; value: unknown }[],
): { root: string; path: string[]; readJs: string; readJsRaw: string } | null {
  const bindArg = args.find((a) => a.name === "bind");
  if (!bindArg) return null;
  let cur = bindArg.value as Expr;
  const reverseSegments: string[] = [];
  while (cur.kind === "FieldAccess") {
    reverseSegments.push((cur as Expr & { field: string }).field);
    cur = (cur as Expr & { base: Expr }).base;
  }
  if (cur.kind !== "Ref") return null;
  const root = (cur as Expr & { name: string }).name;
  const path = reverseSegments.reverse();
  // Build a safe reader: `((_live["root"] ?? {})["a"] ?? {})["b"] ...` then unwrap.
  let readRaw = `_live[${JSON.stringify(root)}]`;
  for (const seg of path) {
    readRaw = `((${readRaw}) ?? {})[${JSON.stringify(seg)}]`;
  }
  return { root, path, readJs: readRaw, readJsRaw: readRaw };
}

function tileCallJs(
  t: TileExpr & { kind: "TileCall" },
  gen: GenCtx,
  ctx: EvalCtx,
  enclosingTile?: string,
  implicitKeyExpr?: string,
): string {
  const name = t.name;
  // Explicit `{key: <expr>}` on the tile call wins over the enclosing
  // TileFor's implicit key. `null` means no wrap.
  const keyJs = keyFor(t, ctx) ?? implicitKeyExpr ?? null;
  const wrap = (lit: string): string => (keyJs ? `_wk(${lit}, ${keyJs})` : lit);

  if (!BUILTIN_TILES.has(name)) {
    const def = gen.tiles.find((x) => x.name === name);
    if (!def) throw new Error(`Tile "${name}" not found`);
    const inner = makeEvalCtx(gen, ctx.localBinds);
    const arg1 = t.args[0];
    const wrapBoundary = (body: string): string => boundaryJs(def, body, gen);
    // Each user-tile call site wraps its rendered output with `_named(…, "X")`
    // so the runtime can diff `tile.mount(X)` / `tile.unmount(X)` against the
    // rendered tree (lifecycle.md §7.1.6). Builtin tiles are NOT named — only
    // user-defined tile boundaries fire mount/unmount.
    const nameLit = JSON.stringify(def.name);
    if (arg1) {
      const v = arg1.value;
      if (isTileExpr(v)) {
        return wrap(
          wrapBoundary(`_named(${tileExprJs(v as TileExpr, gen, inner, def.name)}, ${nameLit})`),
        );
      }
      // Evaluate the positional arg and props in the OUTER context (where
      // `_d_1` still refers to the enclosing tile's `$1`), then pass them in
      // as arguments so the inner IIFE can rebind `_d_1` without colliding
      // with the outer scope.
      const oneJs = jsOfExpr(v as Expr, ctx);
      const propsJs = propsFor(t, ctx);
      const bodyJs = tileExprJs(def.body, gen, addBind(inner, "$1"), def.name);
      return wrap(
        wrapBoundary(
          `((_arg, _propsOuter) => { const ${jsBinding("$1")} = _arg; return _named(_attachProps(${bodyJs}, _propsOuter), ${nameLit}); })(${oneJs}, ${propsJs})`,
        ),
      );
    }
    const propsJs = propsFor(t, ctx);
    const bodyJs = tileExprJs(def.body, gen, inner, def.name);
    return wrap(wrapBoundary(`_named(_attachProps(${bodyJs}, ${propsJs}), ${nameLit})`));
  }

  // Builtin tiles. Each case returns the object-literal JS for one node.
  // Wrapping is centralised at the tail (`return wrap(lit)`) so every builtin
  // uniformly picks up `_wk(..., key)` when the call site has an explicit or
  // implicit key, without touching each individual case.
  gen.usedTiles.add(name);
  const propsObj = propsFor(t, ctx, enclosingTile);
  const emitBuiltin = (): string => {
    switch (name) {
      case "page":
      case "row":
      case "column":
      case "card":
      case "box":
      case "grid":
      case "stack":
      case "overlay":
      case "region":
      case "scroll":
      case "divider":
      case "fieldset":
      case "list-item":
      case "table":
      case "table-head":
      case "table-body":
      case "table-row":
      case "panel": {
        const children = collectChildren(t.args, gen, ctx, enclosingTile);
        return `({ kind: ${JSON.stringify(name)}, children: [${children}], props: ${propsObj} })`;
      }
      case "heading": {
        const text = t.args[0] ? jsOfExpr(asExpr(t.args[0].value), ctx) : '""';
        return `({ kind: "heading", text: _s.show(${text}), props: ${propsObj} })`;
      }
      case "text": {
        const text = t.args[0] ? jsOfExpr(asExpr(t.args[0].value), ctx) : '""';
        return `({ kind: "text", text: _s.show(${text}), props: ${propsObj} })`;
      }
      case "button": {
        const textArg = t.args.find((a) => a.name === "text");
        const textJs = textArg ? jsOfExpr(asExpr(textArg.value), ctx) : '""';
        // `type=` decides whether this button submits the form it is inside
        // (forms.md §5.2.2). Emitted only when written, so a button that says
        // nothing keeps the HTML default rather than being given one here.
        const typeArg = t.args.find((a) => a.name === "type");
        const typeField = typeArg ? `type: ${jsOfExpr(asExpr(typeArg.value), ctx)}, ` : "";
        return `({ kind: "button", text: _s.show(${textJs}), ${typeField}props: ${propsObj} })`;
      }
      case "input": {
        const fields: string[] = [`kind: "input"`];
        const bindInfo = extractBindPath(t.args);
        for (const arg of t.args) {
          if (!arg.name || arg.name === "bind") continue;
          const valJs = jsOfExpr(asExpr(arg.value), ctx);
          if (arg.name === "value") fields.push(`value: _s.show(${valJs})`);
          else if (arg.name === "placeholder") fields.push(`placeholder: ${valJs}`);
          else if (arg.name === "type") fields.push(`type: ${valJs}`);
          else if (arg.name === "id") fields.push(`id: ${valJs}`);
          else if (arg.name === "auto-focus") fields.push(`autoFocus: ${valJs}`);
          else if (arg.name === "required") fields.push(`required: ${valJs}`);
          else if (arg.name === "accept") fields.push(`accept: ${valJs}`);
          else if (arg.name === "multiple") fields.push(`multiple: ${valJs}`);
        }
        if (bindInfo) {
          fields.push(`bind: ${JSON.stringify(bindInfo.root)}`);
          if (bindInfo.path.length > 0) {
            fields.push(`bindPath: ${JSON.stringify(bindInfo.path)}`);
          }
          fields.push(`value: _s.show(${bindInfo.readJs})`);
        }
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "textarea": {
        const fields: string[] = [`kind: "textarea"`];
        const bindInfo = extractBindPath(t.args);
        for (const arg of t.args) {
          if (!arg.name || arg.name === "bind") continue;
          const valJs = jsOfExpr(asExpr(arg.value), ctx);
          if (arg.name === "value") fields.push(`value: _s.show(${valJs})`);
          else if (arg.name === "placeholder") fields.push(`placeholder: ${valJs}`);
          else if (arg.name === "id") fields.push(`id: ${valJs}`);
          else if (arg.name === "rows") fields.push(`rows: ${valJs}`);
        }
        if (bindInfo) {
          fields.push(`bind: ${JSON.stringify(bindInfo.root)}`);
          if (bindInfo.path.length > 0) {
            fields.push(`bindPath: ${JSON.stringify(bindInfo.path)}`);
          }
          fields.push(`value: _s.show(${bindInfo.readJs})`);
        }
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "check": {
        const valArg = t.args.find((a) => a.name === "value");
        const checked = valArg ? jsOfExpr(asExpr(valArg.value), ctx) : "false";
        return `({ kind: "check", checked: !!(${checked}), props: ${propsObj} })`;
      }
      case "select": {
        const fields: string[] = [`kind: "select"`];
        const bindInfo = extractBindPath(t.args);
        if (bindInfo) {
          fields.push(`bind: ${JSON.stringify(bindInfo.root)}`);
          if (bindInfo.path.length > 0) {
            fields.push(`bindPath: ${JSON.stringify(bindInfo.path)}`);
          }
          fields.push(`value: ${bindInfo.readJsRaw}`);
        } else {
          // No bind=; allow `value=<expr>` for read-only / dispatch-via-reducer selects.
          const valArg = t.args.find((a) => a.name === "value");
          if (valArg) fields.push(`value: ${jsOfExpr(asExpr(valArg.value), ctx)}`);
        }
        const optionsArg = t.args.find((a) => a.name === "options");
        if (optionsArg) {
          fields.push(`options: ${jsOfExpr(asExpr(optionsArg.value), ctx)}`);
        } else {
          fields.push(`options: []`);
        }
        const placeholderArg = t.args.find((a) => a.name === "placeholder");
        if (placeholderArg) {
          fields.push(`placeholder: ${jsOfExpr(asExpr(placeholderArg.value), ctx)}`);
        }
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "radio": {
        const fields: string[] = [`kind: "radio"`];
        for (const arg of t.args) {
          if (!arg.name) continue;
          const valJs = jsOfExpr(asExpr(arg.value), ctx);
          if (arg.name === "group") fields.push(`group: ${valJs}`);
          else if (arg.name === "value") fields.push(`value: ${valJs}`);
          else if (arg.name === "selected") fields.push(`selected: !!(${valJs})`);
        }
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "spinner":
        return `({ kind: "spinner", props: ${propsObj} })`;
      case "form": {
        const children = collectChildren(t.args, gen, ctx, enclosingTile);
        return `({ kind: "form", children: [${children}], props: ${propsObj} })`;
      }
      case "label": {
        const text = t.args.find((a) => a.name === "text");
        const textJs = text ? jsOfExpr(asExpr(text.value), ctx) : '""';
        return `({ kind: "label", text: _s.show(${textJs}), props: ${propsObj} })`;
      }
      case "link": {
        const toArg = t.args.find((a) => a.name === "to");
        const to = toArg ? jsOfExpr(asExpr(toArg.value), ctx) : '""';
        // Label is the `text=` argument (canonical, consistent with `button`); the
        // `{text: …}` prop form is also accepted for back-compat (§1.7.1).
        const textArg = t.args.find((a) => a.name === "text");
        const textProp = t.props.find((p) => p.name === "text");
        const textExpr = textArg ? asExpr(textArg.value) : textProp ? textProp.value : undefined;
        const text = textExpr ? jsOfExpr(textExpr, ctx) : '""';
        // §3.8 prefetch — the prop value is a bare reducer ident (Ref) or a
        // string literal. We surface it as a literal string so the runtime can
        // route it through `_dispatch` without re-resolving identifiers.
        const fields = [`kind: "link"`, `text: _s.show(${text})`, `to: _s.show(${to})`];
        const prefetchProp = t.props.find((p) => p.name === "prefetch");
        if (prefetchProp) {
          const v = prefetchProp.value as Expr;
          if (v.kind === "Ref") {
            fields.push(`prefetch: ${JSON.stringify((v as Expr & { name: string }).name)}`);
          } else if (v.kind === "Str") {
            fields.push(`prefetch: ${JSON.stringify((v as Expr & { value: string }).value)}`);
          } else {
            fields.push(`prefetch: ${jsOfExpr(v, ctx)}`);
          }
        }
        const prefetchArgsProp = t.props.find((p) => p.name === "prefetch-args");
        if (prefetchArgsProp) {
          fields.push(`prefetchArgs: ${jsOfExpr(prefetchArgsProp.value, ctx)}`);
        }
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "markdown": {
        const text = t.args[0] ? jsOfExpr(asExpr(t.args[0].value), ctx) : '""';
        return `({ kind: "markdown", text: _s.show(${text}), props: ${propsObj} })`;
      }
      case "skeleton":
        return `({ kind: "skeleton", props: ${propsObj} })`;
      case "image": {
        const src = t.args.find((a) => a.name === "src");
        const srcJs = src ? jsOfExpr(asExpr(src.value), ctx) : '""';
        return `({ kind: "image", src: _s.show(${srcJs}), props: ${propsObj} })`;
      }
      case "icon": {
        const name = t.args.find((a) => a.name === "name");
        const nameExpr = name ? asExpr(name.value) : null;
        // String-literal names get captured so the toolchain can bake matching
        // entries from the project's icon registry into `App.icons` (#101). Other
        // forms (Ref, expression) resolve dynamically through `theme.icons` at
        // runtime — no compile-time bundling.
        if (nameExpr && nameExpr.kind === "Str") {
          const literal = (nameExpr as Expr & { value: string }).value;
          if (literal) ctx.gen.usedIcons.add(literal);
        }
        const nameJs = nameExpr ? jsOfExpr(nameExpr, ctx) : '""';
        return `({ kind: "icon", name: _s.show(${nameJs}), props: ${propsObj} })`;
      }
      case "code": {
        const arg0 = t.args.find((a) => !a.name);
        const text = arg0 ? jsOfExpr(asExpr(arg0.value), ctx) : '""';
        const langArg = t.args.find((a) => a.name === "lang");
        const lang = langArg ? `_s.show(${jsOfExpr(asExpr(langArg.value), ctx)})` : "undefined";
        return `({ kind: "code", text: _s.show(${text}), lang: ${lang}, props: ${propsObj} })`;
      }
      case "video": {
        const fields: string[] = [`kind: "video"`];
        const src = t.args.find((a) => a.name === "src");
        if (src) fields.push(`src: _s.show(${jsOfExpr(asExpr(src.value), ctx)})`);
        const controls = t.args.find((a) => a.name === "controls");
        if (controls) fields.push(`controls: !!(${jsOfExpr(asExpr(controls.value), ctx)})`);
        const autoplay = t.args.find((a) => a.name === "autoplay");
        if (autoplay) fields.push(`autoplay: !!(${jsOfExpr(asExpr(autoplay.value), ctx)})`);
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "list": {
        const children = collectChildren(t.args, gen, ctx, enclosingTile);
        const ordered = t.args.find((a) => a.name === "ordered");
        const ord = ordered ? `!!(${jsOfExpr(asExpr(ordered.value), ctx)})` : "false";
        return `({ kind: "list", ordered: ${ord}, children: [${children}], props: ${propsObj} })`;
      }
      case "table-cell": {
        const children = collectChildren(t.args, gen, ctx, enclosingTile);
        const fields: string[] = [`kind: "table-cell"`, `children: [${children}]`];
        const colspan = t.args.find((a) => a.name === "colspan");
        if (colspan) fields.push(`colspan: ${jsOfExpr(asExpr(colspan.value), ctx)}`);
        const rowspan = t.args.find((a) => a.name === "rowspan");
        if (rowspan) fields.push(`rowspan: ${jsOfExpr(asExpr(rowspan.value), ctx)}`);
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "modal":
      case "drawer":
      case "popover": {
        const children = collectChildren(t.args, gen, ctx, enclosingTile);
        const fields: string[] = [`kind: ${JSON.stringify(name)}`, `children: [${children}]`];
        const open = t.args.find((a) => a.name === "open");
        fields.push(`open: ${open ? `!!(${jsOfExpr(asExpr(open.value), ctx)})` : "true"}`);
        for (const key of ["title", "side", "placement"]) {
          const a = t.args.find((x) => x.name === key);
          if (a) fields.push(`${key}: _s.show(${jsOfExpr(asExpr(a.value), ctx)})`);
        }
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "tooltip": {
        const children = collectChildren(t.args, gen, ctx, enclosingTile);
        const fields: string[] = [`kind: "tooltip"`, `children: [${children}]`];
        const text = t.args.find((a) => a.name === "text");
        if (text) fields.push(`text: _s.show(${jsOfExpr(asExpr(text.value), ctx)})`);
        const placement = t.args.find((a) => a.name === "placement");
        if (placement) fields.push(`placement: _s.show(${jsOfExpr(asExpr(placement.value), ctx)})`);
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "toast": {
        const fields: string[] = [`kind: "toast"`];
        const level = t.args.find((a) => a.name === "kind");
        if (level) fields.push(`level: _s.show(${jsOfExpr(asExpr(level.value), ctx)})`);
        const text = t.args.find((a) => a.name === "text");
        if (text) fields.push(`text: _s.show(${jsOfExpr(asExpr(text.value), ctx)})`);
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "progress": {
        const fields: string[] = [`kind: "progress"`];
        const value = t.args.find((a) => a.name === "value");
        if (value) fields.push(`value: ${jsOfExpr(asExpr(value.value), ctx)}`);
        const max = t.args.find((a) => a.name === "max");
        if (max) fields.push(`max: ${jsOfExpr(asExpr(max.value), ctx)}`);
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "slider": {
        const fields: string[] = [`kind: "slider"`];
        const bindInfo = extractBindPath(t.args);
        for (const arg of t.args) {
          if (!arg.name || arg.name === "bind") continue;
          const valJs = jsOfExpr(asExpr(arg.value), ctx);
          if (arg.name === "min") fields.push(`min: ${valJs}`);
          else if (arg.name === "max") fields.push(`max: ${valJs}`);
          else if (arg.name === "step") fields.push(`step: ${valJs}`);
        }
        if (bindInfo) {
          fields.push(`bind: ${JSON.stringify(bindInfo.root)}`);
          if (bindInfo.path.length > 0) fields.push(`bindPath: ${JSON.stringify(bindInfo.path)}`);
          fields.push(`value: ${bindInfo.readJsRaw}`);
        }
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "switch": {
        const valArg = t.args.find((a) => a.name === "value");
        const checked = valArg ? jsOfExpr(asExpr(valArg.value), ctx) : "false";
        return `({ kind: "switch", checked: !!(${checked}), props: ${propsObj} })`;
      }
      case "error": {
        const fieldArg = t.args.find((a) => a.name === "field");
        const fieldName =
          fieldArg && (fieldArg.value as Expr).kind === "Ref"
            ? (fieldArg.value as Expr & { name: string }).name
            : "";
        return `({ kind: "error", field: ${JSON.stringify(fieldName)}, props: ${propsObj} })`;
      }
      case "route-outlet":
        return `({ kind: "route-outlet", children: [], props: ${propsObj} })`;
      case "details": {
        // <details>: `summary=` supplies the disclosure label; unnamed args
        // are the collapsed children. `open` is optional and defaults to
        // false so the panel starts collapsed (native browser default).
        const children = collectChildren(t.args, gen, ctx, enclosingTile);
        const summaryArg = t.args.find((a) => a.name === "summary");
        const summary = summaryArg ? jsOfExpr(asExpr(summaryArg.value), ctx) : '""';
        const fields: string[] = [
          `kind: "details"`,
          `summary: _s.show(${summary})`,
          `children: [${children}]`,
        ];
        const openArg = t.args.find((a) => a.name === "open");
        if (openArg) fields.push(`open: !!(${jsOfExpr(asExpr(openArg.value), ctx)})`);
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "editable": {
        // contenteditable: first positional (or `text=`) supplies initial
        // content; `bind=` optionally writes back user edits. Mirrors the
        // input / textarea shape so codegen for text-in-bind is uniform.
        const fields: string[] = [`kind: "editable"`];
        const bindInfo = extractBindPath(t.args);
        const textArg = t.args.find((a) => !a.name) ?? t.args.find((a) => a.name === "text");
        const textJs = textArg ? jsOfExpr(asExpr(textArg.value), ctx) : '""';
        if (bindInfo) {
          fields.push(`bind: ${JSON.stringify(bindInfo.root)}`);
          if (bindInfo.path.length > 0) {
            fields.push(`bindPath: ${JSON.stringify(bindInfo.path)}`);
          }
          fields.push(`text: _s.show(${bindInfo.readJs})`);
        } else {
          fields.push(`text: _s.show(${textJs})`);
        }
        const idArg = t.args.find((a) => a.name === "id");
        if (idArg) fields.push(`id: ${jsOfExpr(asExpr(idArg.value), ctx)}`);
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
    }
    throw new Error(`Unsupported builtin tile "${name}"`);
  };
  return wrap(emitBuiltin());
}

function asExpr(v: Expr | TileExpr): Expr {
  return v as Expr;
}

function collectChildren(
  args: { kind: "TileArg"; name?: string; value: Expr | TileExpr }[],
  gen: GenCtx,
  ctx: EvalCtx,
  enclosingTile?: string,
): string {
  const parts: string[] = [];
  for (const a of args) {
    if (a.name) continue; // skip named args at container level
    const v = a.value;
    if (isTileExpr(v)) {
      parts.push(tileExprJs(v, gen, ctx, enclosingTile));
    } else if ((v as Expr).kind === "Ref") {
      const refName = (v as Expr & { name: string }).name;
      const def = gen.tiles.find((x) => x.name === refName);
      if (def) {
        parts.push(tileExprJs(def.body, gen, ctx, def.name));
      } else {
        parts.push("null");
      }
    }
  }
  // Wrap in _children(...) so the runtime can flatten arrays and drop nulls.
  return `..._children(${parts.join(", ")})`;
}
