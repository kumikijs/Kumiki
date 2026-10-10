import { unaliasType } from "../assignable.ts";
import type { Expr, TileArg, TileDef, TileExpr, TypeExpr } from "../ast.ts";
import { isTileExpr } from "../ast.ts";
import { BUILTIN_TILES, contentArg } from "../builtins.ts";
import { TIME_INPUT_PATTERNS } from "../input-bind.ts";
import type { ParseReading } from "../parse-reading.ts";
import {
  addBind,
  bindRef,
  childCtx,
  declareBind,
  type EnclosingTiles,
  type EvalCtx,
  type GenCtx,
  makeEvalCtx,
} from "./context.ts";
import { jsOfExpr, readingJs, tupleArm } from "./expr.ts";
import { type BindSegment, isUnwrapStep, UNWRAP_SEGMENT } from "./path-segment.ts";
import { explicitHandlers, type HandlerWiring, keyFor, propsFor, propValue } from "./selector.ts";

export function genTile(tile: TileDef, gen: GenCtx): string {
  const ctx = makeEvalCtx(gen, new Set(tile.in ? ["$1"] : []));
  return tileExprJs(tile.body, gen, ctx, [tile.name]);
}

function under(chain: EnclosingTiles | undefined, name: string): EnclosingTiles {
  const outer = chain ?? [];
  return outer.includes(name) ? outer : [...outer, name];
}

function boundaryJs(
  def: TileDef,
  body: string,
  gen: GenCtx,
  enclosingTiles?: EnclosingTiles,
): string {
  if (!def.errorBoundary) return body;
  const fb = gen.tiles.find((x) => x.name === def.errorBoundary);
  if (!fb)
    throw new Error(
      `Tile "${def.name}" declares error-boundary=${def.errorBoundary}, which is not a tile`,
    );
  const fbCtx = makeEvalCtx(gen, ["$1"]);
  const fbBody = tileExprJs(fb.body, gen, fbCtx, under(enclosingTiles, fb.name));
  return `((() => { try { return ${body}; } catch (_err) { const ${bindRef(fbCtx, "$1")} = _s.boundaryPanic(_err, ${JSON.stringify(def.name)}); return ${fbBody}; } })())`;
}

export function genRouteTile(tile: TileDef, gen: GenCtx, where: string, fill?: string): string {
  if (tile.in) throw new Error(`${where} targets tile "${tile.name}", which declares in=`);
  const named = `_named(${genTile(tile, gen)}, ${JSON.stringify(tile.name)})`;
  return boundaryJs(tile, fill ? `${fill}(${named})` : named, gen);
}

function loopName(t: TileExpr & { kind: "TileFor" }, gen: GenCtx): LoopName {
  let names = loopNames.get(gen.tiles);
  if (!names) {
    const table = new Map<TileExpr, LoopName>();
    for (const def of gen.tiles) {
      let n = 0;
      forEachLoop(def.body, (loop) => {
        table.set(loop, { name: `${def.name}_${n++}`, id: table.size });
      });
    }
    names = table;
    loopNames.set(gen.tiles, names);
  }
  const known = names.get(t);
  if (known) return known;
  const named = { name: `expect_${names.size}`, id: names.size };
  names.set(t, named);
  return named;
}

type LoopName = { readonly name: string; readonly id: number };

const loopNames = new WeakMap<readonly TileDef[], Map<TileExpr, LoopName>>();

/** Every `for` under `t`, outer before inner and in source order. */
function forEachLoop(t: TileExpr, f: (loop: TileExpr & { kind: "TileFor" }) => void): void {
  switch (t.kind) {
    case "TileFor":
      f(t);
      forEachLoop(t.body, f);
      return;
    case "TileWhen":
      forEachLoop(t.body, f);
      return;
    case "TileIf":
      forEachLoop(t.consequent, f);
      forEachLoop(t.alternate, f);
      return;
    case "TileMatch":
      for (const arm of t.arms) forEachLoop(arm.body, f);
      return;
    case "TileCall":
      for (const a of t.args) if (isTileExpr(a.value)) forEachLoop(a.value, f);
      return;
    default: {
      const unhandled: never = t;
      throw new Error(`forEachLoop: unhandled tile kind ${(unhandled as TileExpr).kind}`);
    }
  }
}

export function tileExprJs(
  t: TileExpr,
  gen: GenCtx,
  ctx: EvalCtx,
  enclosingTiles?: EnclosingTiles,
  implicitKeyExpr?: string,
  rootHandlers?: HandlerWiring,
): string {
  switch (t.kind) {
    case "TileFor": {
      const iter = jsOfExpr(t.iter, ctx);
      const inner = childCtx(ctx);
      const bind = declareBind(inner, t.bind);
      const { name, id } = loopName(t, gen);
      const keys = `__fk${id}`;
      const index = `__fi${id}`;
      const impl = `${keys}[${index}]`;
      const body = tileExprJs(t.body, gen, inner, enclosingTiles, impl, rootHandlers);
      const list = body.includes(impl)
        ? `((__xs) => { const ${keys} = _s.loopKeys(__xs, ${JSON.stringify(name)}); return __xs.map((${bind}, ${index}) => (${body})); })((${iter}) || [])`
        : `((${iter}) || []).map((${bind}) => (${body}))`;
      return implicitKeyExpr ? `_wk(${list}, ${implicitKeyExpr})` : list;
    }
    case "TileWhen":
      // Returns a Node or null. Caller flattens nulls away.
      return `((${jsOfExpr(t.cond, ctx)}) ? (${tileExprJs(t.body, gen, ctx, enclosingTiles, implicitKeyExpr, rootHandlers)}) : null)`;
    case "TileIf":
      return `((${jsOfExpr(t.cond, ctx)}) ? (${tileExprJs(t.consequent, gen, ctx, enclosingTiles, implicitKeyExpr, rootHandlers)}) : (${tileExprJs(t.alternate, gen, ctx, enclosingTiles, implicitKeyExpr, rootHandlers)}))`;
    case "TileMatch": {
      const sc = jsOfExpr(t.scrutinee, ctx);
      const arms = t.arms
        .map((arm) => {
          if (arm.pattern.kind === "PVariant") {
            const inner = childCtx(ctx);
            const binds = arm.pattern.binds
              .map((b, i) =>
                b !== "_" ? `const ${declareBind(inner, b)} = _v[${JSON.stringify(`_${i}`)}];` : "",
              )
              .join(" ");
            return `if (_s.variantIs(_v, ${JSON.stringify(arm.pattern.name)})) { ${binds} return ${tileExprJs(arm.body, gen, inner, enclosingTiles, implicitKeyExpr, rootHandlers)}; }`;
          }
          if (arm.pattern.kind === "PBind") {
            const inner = childCtx(ctx);
            const bind = declareBind(inner, arm.pattern.name);
            return `if (true) { const ${bind} = _v; return ${tileExprJs(arm.body, gen, inner, enclosingTiles, implicitKeyExpr, rootHandlers)}; }`;
          }
          if (arm.pattern.kind === "PWildcard") {
            return `if (true) { return ${tileExprJs(arm.body, gen, ctx, enclosingTiles, implicitKeyExpr, rootHandlers)}; }`;
          }
          {
            const { guard, binds, inner } = tupleArm(arm.pattern, ctx, "_v");
            return `if (${guard}) { ${binds} return ${tileExprJs(arm.body, gen, inner, enclosingTiles, implicitKeyExpr, rootHandlers)}; }`;
          }
        })
        .join(" else ");
      gen.usedTiles.add("text");
      return `((_v) => { ${arms} else { return { kind: "text", text: "" }; } })(${sc})`;
    }
    case "TileCall":
      return tileCallJs(
        t as TileExpr & { kind: "TileCall" },
        gen,
        ctx,
        enclosingTiles,
        implicitKeyExpr,
        rootHandlers,
      );
  }
}

export type BindInfo = { root: string; path: BindSegment[]; read: string };

export function extractBindPath(bind: Expr | undefined): BindInfo | null {
  if (!bind) return null;
  let cur = bind;
  const reverseSegments: BindSegment[] = [];
  while (cur.kind === "FieldAccess") {
    const fa = cur as Expr & { field: string; accessKind?: "field" | "shortcut" };
    reverseSegments.push(isUnwrapStep(fa.field, fa.accessKind) ? UNWRAP_SEGMENT : fa.field);
    cur = (cur as Expr & { base: Expr }).base;
  }
  if (cur.kind !== "Ref") return null;
  const root = (cur as Expr & { name: string }).name;
  const path = reverseSegments.reverse();
  // Build a safe reader: `((_live["root"] ?? {})["a"] ?? {})["b"] ...`.
  let readRaw = `_live[${JSON.stringify(root)}]`;
  for (const seg of path) {
    readRaw =
      typeof seg === "string"
        ? `((${readRaw}) ?? {})[${JSON.stringify(seg)}]`
        : `_s.unwrap(${readRaw})`;
  }
  return { root, path, read: readRaw };
}

function bindFields(bindInfo: Pick<BindInfo, "root" | "path">): string[] {
  const fields = [`bind: ${JSON.stringify(bindInfo.root)}`];
  if (bindInfo.path.length > 0) fields.push(`bindPath: ${JSON.stringify(bindInfo.path)}`);
  return fields;
}

function toggleJs(
  kind: "check" | "switch",
  t: TileExpr & { kind: "TileCall" },
  ctx: EvalCtx,
  propsObj: string,
): string {
  const bindInfo = extractBindPath(propValue(t, "bind", ctx));
  const fields = [`kind: ${JSON.stringify(kind)}`];
  if (bindInfo) {
    fields.push(...bindFields(bindInfo), `checked: !!(${bindInfo.read})`);
  } else {
    const value = propValue(t, "value", ctx);
    fields.push(`checked: !!(${value ? jsOfExpr(value, ctx) : "false"})`);
  }
  fields.push(`props: ${propsObj}`);
  return `({ ${fields.join(", ")} })`;
}

function boundReading(
  bindInfo: { root: string; path: BindSegment[] },
  gen: GenCtx,
): "Int" | "Float" | "Time" | null {
  let t: TypeExpr | null = gen.slots.find((s) => s.name === bindInfo.root)?.type ?? null;
  for (const seg of bindInfo.path) {
    const u = unaliasType(t, gen);
    if (typeof seg === "string") {
      t = u?.kind === "TypeRecord" ? (u.fields.find((f) => f.name === seg)?.type ?? null) : null;
    } else {
      t =
        u?.kind === "TypeApp" && (u.name === "Option" || u.name === "Result")
          ? (u.args[0] ?? null)
          : null;
    }
  }
  const base = unaliasType(t, gen);
  if (base?.kind !== "TypePrim") return null;
  return base.name === "Int" || base.name === "Float" || base.name === "Time" ? base.name : null;
}

const readerName = (reading: ParseReading): string => `_read${reading}`;

export function bindReaderDecls(readings: ReadonlySet<ParseReading>): string[] {
  return [...readings]
    .sort()
    .map(
      (r) =>
        `const ${readerName(r)} = { as: ${JSON.stringify(r)}, read: (_t) => ${readingJs(r, "_t")} };`,
    );
}

function boundInputValueJs(
  reading: ParseReading | null,
  type: Expr | undefined,
  readJs: string,
): string {
  if (reading === "Time") {
    const pattern = type?.kind === "Str" ? TIME_INPUT_PATTERNS.get(type.value) : undefined;
    if (pattern) return `_s.formatTime(${readJs}, ${JSON.stringify(pattern)})`;
  }
  return `_s.show(${readJs})`;
}

function tileCallJs(
  t: TileExpr & { kind: "TileCall" },
  gen: GenCtx,
  ctx: EvalCtx,
  enclosingTiles?: EnclosingTiles,
  implicitKeyExpr?: string,
  rootHandlers?: HandlerWiring,
): string {
  const name = t.name;
  const keyJs = keyFor(t, ctx) ?? implicitKeyExpr ?? null;
  const wrap = (lit: string): string => (keyJs ? `_wk(${lit}, ${keyJs})` : lit);

  if (!BUILTIN_TILES.has(name)) {
    const def = gen.tiles.find((x) => x.name === name);
    if (!def) throw new Error(`Tile "${name}" not found`);
    const inner = makeEvalCtx(gen, new Set<string>());
    const arg1 = firstPositional(t);
    const wrapBoundary = (body: string): string => boundaryJs(def, body, gen, enclosingTiles);
    const nameLit = JSON.stringify(def.name);
    const handlers = explicitHandlers(t, rootHandlers);
    const callSiteProps = (): string => propsFor(t, ctx, undefined, new Map());
    const bodyHandlers = handlers.size > 0 ? handlers : undefined;
    if (arg1) {
      const v = arg1.value;
      if (isTileExpr(v)) {
        throw new Error(`Tile "${name}" called with a tile as its positional argument`);
      }
      const oneJs = jsOfExpr(v as Expr, ctx);
      const propsJs = callSiteProps();
      const bodyCtx = addBind(inner, "$1");
      const bodyJs = tileExprJs(
        def.body,
        gen,
        bodyCtx,
        under(enclosingTiles, def.name),
        undefined,
        bodyHandlers,
      );
      return wrap(
        wrapBoundary(
          `((_arg, _propsOuter) => { const ${bindRef(bodyCtx, "$1")} = _arg; return _named(_attachProps(${bodyJs}, _propsOuter), ${nameLit}); })(${oneJs}, ${propsJs})`,
        ),
      );
    }
    const propsJs = callSiteProps();
    const bodyJs = tileExprJs(
      def.body,
      gen,
      inner,
      under(enclosingTiles, def.name),
      undefined,
      bodyHandlers,
    );
    return wrap(wrapBoundary(`_named(_attachProps(${bodyJs}, ${propsJs}), ${nameLit})`));
  }

  gen.usedTiles.add(name);
  const propsObj = propsFor(t, ctx, enclosingTiles, explicitHandlers(t, rootHandlers));
  const prop = (propName: string): Expr | undefined => propValue(t, propName, ctx);
  const propJs = (propName: string): string | undefined => {
    const v = prop(propName);
    return v === undefined ? undefined : jsOfExpr(v, ctx);
  };
  const field = (
    fields: string[],
    propName: string,
    key: string = propName,
    wrapJs: (js: string) => string = (js) => js,
  ): void => {
    const js = propJs(propName);
    if (js !== undefined) fields.push(`${key}: ${wrapJs(js)}`);
  };
  const show = (js: string): string => `_s.show(${js})`;
  const truthy = (js: string): string => `!!(${js})`;
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
        const children = collectChildren(t.args, gen, ctx, enclosingTiles);
        return `({ kind: ${JSON.stringify(name)}, children: [${children}], props: ${propsObj} })`;
      }
      case "heading": {
        const text = contentJs(t, ctx);
        return `({ kind: "heading", text: _s.show(${text}), props: ${propsObj} })`;
      }
      case "text": {
        const text = contentJs(t, ctx);
        return `({ kind: "text", text: _s.show(${text}), props: ${propsObj} })`;
      }
      case "button": {
        const textArg = t.args.find((a) => a.name === "text");
        const textJs = textArg ? jsOfExpr(asExpr(textArg.value), ctx) : '""';
        const fields = [`kind: "button"`, `text: _s.show(${textJs})`];
        field(fields, "type");
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "input": {
        const fields: string[] = [`kind: "input"`];
        const bindInfo = extractBindPath(prop("bind"));
        field(fields, "placeholder");
        field(fields, "type");
        field(fields, "id");
        field(fields, "auto-focus", "autoFocus");
        field(fields, "required");
        field(fields, "accept");
        field(fields, "multiple");
        if (bindInfo) {
          fields.push(...bindFields(bindInfo));
          const reading = boundReading(bindInfo, gen);
          if (reading) {
            gen.usedReaders.add(reading);
            fields.push(`parse: ${readerName(reading)}`);
          }
          fields.push(`value: ${boundInputValueJs(reading, prop("type"), bindInfo.read)}`);
        } else {
          field(fields, "value", "value", show);
        }
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "textarea": {
        const fields: string[] = [`kind: "textarea"`];
        const bindInfo = extractBindPath(prop("bind"));
        field(fields, "placeholder");
        field(fields, "id");
        field(fields, "rows");
        if (bindInfo) fields.push(...bindFields(bindInfo), `value: _s.show(${bindInfo.read})`);
        else field(fields, "value", "value", show);
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "check":
      case "switch":
        return toggleJs(name, t, ctx, propsObj);
      case "select": {
        const fields: string[] = [`kind: "select"`];
        const bindInfo = extractBindPath(prop("bind"));
        if (bindInfo) {
          fields.push(...bindFields(bindInfo), `value: ${bindInfo.read}`);
        } else {
          // No bind; allow a `value` for read-only / dispatch-via-reducer selects.
          field(fields, "value");
        }
        fields.push(`options: ${propJs("options") ?? "[]"}`);
        field(fields, "placeholder");
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "radio": {
        const fields: string[] = [`kind: "radio"`];
        const bindInfo = extractBindPath(prop("bind"));
        field(fields, "group");
        if (!bindInfo) field(fields, "selected", "selected", truthy);
        const valueJs = propJs("value");
        if (valueJs !== undefined) {
          fields.push(`value: ${valueJs}`);
          if (bindInfo) {
            fields.push(...bindFields(bindInfo), `selected: _s.eq(${bindInfo.read}, ${valueJs})`);
          }
        }
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "spinner":
        return `({ kind: "spinner", props: ${propsObj} })`;
      case "form": {
        const children = collectChildren(t.args, gen, ctx, enclosingTiles);
        return `({ kind: "form", children: [${children}], props: ${propsObj} })`;
      }
      case "label": {
        const text = contentJs(t, ctx);
        return `({ kind: "label", text: _s.show(${text}), props: ${propsObj} })`;
      }
      case "link": {
        const to = propJs("to") ?? '""';
        const textArg = contentArg(t);
        const textProp = t.props.find((p) => p.name === "text");
        const textExpr = textArg ? asExpr(textArg.value) : textProp ? textProp.value : undefined;
        const text = textExpr ? jsOfExpr(textExpr, ctx) : '""';
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
        const text = contentJs(t, ctx);
        return `({ kind: "markdown", text: _s.show(${text}), props: ${propsObj} })`;
      }
      case "skeleton":
        return `({ kind: "skeleton", props: ${propsObj} })`;
      case "image": {
        const src = contentArg(t);
        const srcJs = src ? jsOfExpr(asExpr(src.value), ctx) : '""';
        return `({ kind: "image", src: _s.show(${srcJs}), props: ${propsObj} })`;
      }
      case "icon": {
        const name = contentArg(t);
        const nameExpr = name ? asExpr(name.value) : null;
        if (nameExpr && nameExpr.kind === "Str") {
          const literal = (nameExpr as Expr & { value: string }).value;
          if (literal) ctx.gen.usedIcons.add(literal);
        }
        const nameJs = nameExpr ? jsOfExpr(nameExpr, ctx) : '""';
        return `({ kind: "icon", name: _s.show(${nameJs}), props: ${propsObj} })`;
      }
      case "code": {
        const text = contentJs(t, ctx);
        const langJs = propJs("lang");
        const lang = langJs === undefined ? "undefined" : show(langJs);
        return `({ kind: "code", text: _s.show(${text}), lang: ${lang}, props: ${propsObj} })`;
      }
      case "video": {
        const fields: string[] = [`kind: "video"`];
        field(fields, "src", "src", show);
        field(fields, "controls", "controls", truthy);
        field(fields, "autoplay", "autoplay", truthy);
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "list": {
        const children = collectChildren(t.args, gen, ctx, enclosingTiles);
        const orderedJs = propJs("ordered");
        const ord = orderedJs === undefined ? "false" : truthy(orderedJs);
        return `({ kind: "list", ordered: ${ord}, children: [${children}], props: ${propsObj} })`;
      }
      case "table-cell": {
        const children = collectChildren(t.args, gen, ctx, enclosingTiles);
        const fields: string[] = [`kind: "table-cell"`, `children: [${children}]`];
        field(fields, "colspan");
        field(fields, "rowspan");
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "modal":
      case "drawer":
      case "popover": {
        const children = collectChildren(t.args, gen, ctx, enclosingTiles);
        const fields: string[] = [`kind: ${JSON.stringify(name)}`, `children: [${children}]`];
        const openJs = propJs("open");
        fields.push(`open: ${openJs === undefined ? "true" : truthy(openJs)}`);
        for (const key of ["title", "side", "placement"]) field(fields, key, key, show);
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "tooltip": {
        const children = collectChildren(t.args, gen, ctx, enclosingTiles);
        const fields: string[] = [`kind: "tooltip"`, `children: [${children}]`];
        field(fields, "text", "text", show);
        field(fields, "placement", "placement", show);
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "toast": {
        const fields: string[] = [`kind: "toast"`];
        field(fields, "kind", "level", show);
        field(fields, "text", "text", show);
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "progress": {
        const fields: string[] = [`kind: "progress"`];
        field(fields, "value");
        field(fields, "max");
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "slider": {
        const fields: string[] = [`kind: "slider"`];
        const bindInfo = extractBindPath(prop("bind"));
        field(fields, "min");
        field(fields, "max");
        field(fields, "step");
        if (bindInfo) fields.push(...bindFields(bindInfo), `value: ${bindInfo.read}`);
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "error": {
        const fieldExpr = prop("field");
        const fieldName = fieldExpr?.kind === "Ref" ? fieldExpr.name : "";
        return `({ kind: "error", field: ${JSON.stringify(fieldName)}, props: ${propsObj} })`;
      }
      case "route-outlet":
        return `({ kind: "route-outlet", children: [], props: ${propsObj} })`;
      case "details": {
        const children = collectChildren(t.args, gen, ctx, enclosingTiles);
        const summary = propJs("summary") ?? '""';
        const fields: string[] = [
          `kind: "details"`,
          `summary: _s.show(${summary})`,
          `children: [${children}]`,
        ];
        field(fields, "open", "open", truthy);
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
      case "editable": {
        const fields: string[] = [`kind: "editable"`];
        const bindInfo = extractBindPath(prop("bind"));
        const textJs = contentJs(t, ctx);
        if (bindInfo) {
          fields.push(...bindFields(bindInfo), `text: _s.show(${bindInfo.read})`);
        } else {
          fields.push(`text: _s.show(${textJs})`);
        }
        field(fields, "id");
        fields.push(`props: ${propsObj}`);
        return `({ ${fields.join(", ")} })`;
      }
    }
    throw new Error(`Unsupported builtin tile "${name}"`);
  };
  return wrap(emitBuiltin());
}

function firstPositional(t: TileExpr & { kind: "TileCall" }): TileArg | undefined {
  return t.args.find((a) => a.name === undefined);
}

function contentJs(t: TileExpr & { kind: "TileCall" }, ctx: EvalCtx): string {
  const arg = contentArg(t);
  return arg ? jsOfExpr(asExpr(arg.value), ctx) : '""';
}

function asExpr(v: Expr | TileExpr): Expr {
  return v as Expr;
}

function collectChildren(
  args: { kind: "TileArg"; name?: string; value: Expr | TileExpr }[],
  gen: GenCtx,
  ctx: EvalCtx,
  enclosingTiles?: EnclosingTiles,
): string {
  const parts: string[] = [];
  for (const a of args) {
    if (a.name) continue; // skip named args at container level
    const v = a.value;
    if (isTileExpr(v)) {
      parts.push(tileExprJs(v, gen, ctx, enclosingTiles));
    } else if ((v as Expr).kind === "Ref") {
      const refName = (v as Expr & { name: string }).name;
      const def = gen.tiles.find((x) => x.name === refName);
      if (def) {
        parts.push(tileExprJs(def.body, gen, ctx, under(enclosingTiles, def.name)));
      } else {
        parts.push("null");
      }
    }
  }
  // Wrap in _children(...) so the runtime can flatten arrays and drop nulls.
  return `..._children(${parts.join(", ")})`;
}
