import type {
  AppAnalyticsConfig,
  AppDef,
  AppHttpConfig,
  AppIndexedDbConfig,
  AppIndexedDbStore,
  AppMetaConfig,
  DuplicateName,
  Expr,
  NamedRef,
  Pos,
} from "../ast.ts";
import { TileParser } from "./tiles.ts";
import { ParseError } from "./token-stream.ts";

export class AppParser extends TileParser {
  protected parseApp(): AppDef {
    const start = this.eat("kw", "app");
    const name = this.eat("ident").value;
    let caps: string[] = [];
    let routes: { path: string; tile: string; tilePos?: Pos; pathPos: Pos }[] = [];
    let init: Expr[] = [];
    let theme: NamedRef | undefined;
    let http: AppHttpConfig | undefined;
    let indexedDb: AppIndexedDbConfig | undefined;
    let meta: AppMetaConfig | undefined;
    let analytics: AppAnalyticsConfig | undefined;

    const duplicateClauses: DuplicateName[] = [];
    const seenClauses = new Set<string>();
    const configSources: Expr[] = [];

    while (!this.isAppEnd()) {
      const ident = this.eat("ident");
      const k = ident.value;
      if (seenClauses.has(k)) duplicateClauses.push({ name: k, pos: ident.pos });
      seenClauses.add(k);
      this.eat("op", "=");
      if (k === "caps") caps = this.parseQualifiedList();
      else if (k === "routes") routes = this.parseRouteMap();
      else if (k === "init") init = this.parseInitList();
      else if (k === "theme") {
        const tok = this.eat("ident");
        theme = { name: tok.value, pos: tok.pos };
      } else if (k === "http") http = this.parseAppHttp(ident.pos, configSources);
      else if (k === "indexed-db") indexedDb = this.parseAppIndexedDb(ident.pos, configSources);
      else if (k === "meta") meta = this.parseAppMeta(ident.pos, configSources);
      else if (k === "analytics") analytics = this.parseAppAnalytics(ident.pos, configSources);
      else {
        throw new ParseError(`Unknown app field "${k}"`, ident.pos);
      }
    }

    const def: AppDef = { kind: "AppDef", name, caps, routes, init, pos: start.pos };
    if (duplicateClauses.length > 0) def.duplicateClauses = duplicateClauses;
    if (configSources.length > 0) def.configSources = configSources;
    if (theme) def.theme = theme;
    if (http) def.http = http;
    if (indexedDb) def.indexedDb = indexedDb;
    if (meta) def.meta = meta;
    if (analytics) def.analytics = analytics;
    return def;
  }

  private parseAppMeta(pos: Pos, sources: Expr[]): AppMetaConfig {
    const rec = this.parseExpr();
    sources.push(rec);
    if (rec.kind !== "RecordLit") {
      throw new ParseError(`app.meta must be a record literal`, pos);
    }
    const cfg: AppMetaConfig = { pos };
    for (const f of rec.fields) {
      const v = f.value;
      if (v.kind !== "Str") {
        throw new ParseError(`app.meta.${f.name} must be a string literal`, v.pos);
      }
      switch (f.name) {
        case "title":
          cfg.title = v.value;
          break;
        case "description":
          cfg.description = v.value;
          break;
        case "og-image":
          cfg.ogImage = v.value;
          break;
        case "favicon":
          cfg.favicon = v.value;
          break;
        default:
          throw new ParseError(`Unknown app.meta field "${f.name}"`, v.pos);
      }
    }
    return cfg;
  }

  private parseAppAnalytics(pos: Pos, sources: Expr[]): AppAnalyticsConfig {
    const rec = this.parseExpr();
    sources.push(rec);
    if (rec.kind !== "RecordLit") {
      throw new ParseError(`app.analytics must be a record literal`, pos);
    }
    let provider: "console" | "noop" | undefined;
    let appId: string | undefined;
    for (const f of rec.fields) {
      const v = f.value;
      if (f.name === "provider") {
        if (v.kind !== "Str" || (v.value !== "console" && v.value !== "noop")) {
          throw new ParseError(`app.analytics.provider must be "console" or "noop"`, v.pos);
        }
        provider = v.value;
      } else if (f.name === "app-id") {
        if (v.kind !== "Str") {
          throw new ParseError(`app.analytics.app-id must be a string literal`, v.pos);
        }
        appId = v.value;
      } else {
        throw new ParseError(`Unknown app.analytics field "${f.name}"`, v.pos);
      }
    }
    if (provider === undefined) {
      throw new ParseError(`app.analytics requires a "provider" field`, pos);
    }
    const cfg: AppAnalyticsConfig = { provider, pos };
    if (appId !== undefined) cfg.appId = appId;
    return cfg;
  }

  private parseAppIndexedDb(pos: Pos, sources: Expr[]): AppIndexedDbConfig {
    const rec = this.parseExpr();
    sources.push(rec);
    if (rec.kind !== "RecordLit") {
      throw new ParseError(`app.indexed-db must be a record literal`, pos);
    }
    let dbName: string | undefined;
    let version: number | undefined;
    const stores: AppIndexedDbStore[] = [];
    for (const f of rec.fields) {
      if (f.name === "name") {
        if (f.value.kind !== "Str") {
          throw new ParseError(`app.indexed-db.name must be a string literal`, f.value.pos);
        }
        dbName = f.value.value;
      } else if (f.name === "version") {
        if (f.value.kind !== "Num") {
          throw new ParseError(`app.indexed-db.version must be a numeric literal`, f.value.pos);
        }
        version = f.value.value;
      } else if (f.name === "stores") {
        if (f.value.kind !== "ListLit") {
          throw new ParseError(`app.indexed-db.stores must be a list literal`, f.value.pos);
        }
        for (const item of f.value.items) {
          stores.push(this.parseIndexedDbStore(item));
        }
      } else {
        throw new ParseError(`Unknown app.indexed-db field "${f.name}"`, pos);
      }
    }
    if (dbName === undefined) {
      throw new ParseError(`app.indexed-db requires a "name" field`, pos);
    }
    if (version === undefined) {
      throw new ParseError(`app.indexed-db requires a "version" field`, pos);
    }
    if (stores.length === 0) {
      throw new ParseError(`app.indexed-db requires at least one store`, pos);
    }
    return { name: dbName, version, stores, pos };
  }

  protected parseIndexedDbStore(expr: Expr): AppIndexedDbStore {
    if (expr.kind !== "RecordLit") {
      throw new ParseError(`indexed-db store must be a record literal`, expr.pos);
    }
    let name: string | undefined;
    let key: string | undefined;
    let indexes: string[] | undefined;
    for (const f of expr.fields) {
      if (f.name === "name") {
        if (f.value.kind !== "Str") {
          throw new ParseError(`indexed-db store "name" must be a string literal`, f.value.pos);
        }
        name = f.value.value;
      } else if (f.name === "key") {
        if (f.value.kind !== "Str") {
          throw new ParseError(`indexed-db store "key" must be a string literal`, f.value.pos);
        }
        key = f.value.value;
      } else if (f.name === "indexes") {
        if (f.value.kind !== "ListLit") {
          throw new ParseError(`indexed-db store "indexes" must be a list literal`, f.value.pos);
        }
        indexes = f.value.items.map((it) => {
          if (it.kind !== "Str") {
            throw new ParseError(`indexed-db store index must be a string literal`, it.pos);
          }
          return it.value;
        });
      } else {
        throw new ParseError(`Unknown indexed-db store field "${f.name}"`, expr.pos);
      }
    }
    if (name === undefined) {
      throw new ParseError(`indexed-db store requires a "name" field`, expr.pos);
    }
    if (key === undefined) {
      throw new ParseError(`indexed-db store requires a "key" field`, expr.pos);
    }
    const store: AppIndexedDbStore = { name, key };
    if (indexes) store.indexes = indexes;
    return store;
  }

  protected parseAppHttp(pos: Pos, sources: Expr[]): AppHttpConfig {
    const rec = this.parseExpr();
    sources.push(rec);
    if (rec.kind !== "RecordLit") {
      throw new ParseError(`app.http must be a record literal`, pos);
    }
    const cfg: AppHttpConfig = { pos };
    for (const f of rec.fields) {
      switch (f.name) {
        case "base-url":
          cfg.baseUrl = f.value;
          break;
        case "headers":
          cfg.headers = f.value;
          break;
        case "on-401":
          cfg.on401 = this.appHttpReducerRef(f.name, f.value);
          break;
        case "on-403":
          cfg.on403 = this.appHttpReducerRef(f.name, f.value);
          break;
        case "on-5xx":
          cfg.on5xx = this.appHttpReducerRef(f.name, f.value);
          break;
        case "timeout":
          cfg.timeout = f.value;
          break;
        case "credentials":
          cfg.credentials = f.value;
          break;
        default:
          throw new ParseError(`Unknown app.http field "${f.name}"`, pos);
      }
    }
    return cfg;
  }

  protected appHttpReducerRef(field: string, value: Expr): NamedRef {
    if (value.kind !== "Ref") {
      throw new ParseError(`app.http.${field} must be a reducer name (bare identifier)`, value.pos);
    }
    return { name: value.name, pos: value.pos };
  }

  protected isAppEnd(): boolean {
    const t = this.peek();
    if (t.kind === "eof") return true;
    if (t.kind === "kw") return true;
    if (t.kind === "ident" && (t.value === "theme" || t.value === "motion")) {
      return this.matchTAt(1, "ident") && this.matchTAt(2, "op", "=");
    }
    return false;
  }

  protected parseQualifiedList(): string[] {
    this.eat("op", "[");
    const out: string[] = [];
    if (!this.matchOp("]")) {
      out.push(this.readQualifiedName());
      while (this.matchOp(",")) {
        this.next();
        out.push(this.readQualifiedName());
      }
    }
    this.eat("op", "]");
    return out;
  }

  protected readQualifiedName(): string {
    let name = this.eat("ident").value;
    while (this.matchOp(".")) {
      this.next();
      name += `.${this.eatName().value}`;
    }
    return name;
  }

  protected parseRouteMap(): { path: string; tile: string; tilePos?: Pos; pathPos: Pos }[] {
    this.eat("op", "{");
    const routes: { path: string; tile: string; tilePos?: Pos; pathPos: Pos }[] = [];
    if (!this.matchOp("}")) {
      routes.push(this.parseRouteEntry());
      while (this.matchOp(",")) {
        this.next();
        routes.push(this.parseRouteEntry());
      }
    }
    this.eat("op", "}");
    return routes;
  }

  protected parseRouteEntry(): { path: string; tile: string; tilePos?: Pos; pathPos: Pos } {
    const pathTok = this.eat("str");
    const path = pathTok.value;
    if (this.matchOp("->>")) {
      this.next();
      // redirect target as string. Represent it as a tile name.
      const target = this.eat("str").value;
      return { path, tile: `>>${target}`, pathPos: pathTok.pos };
    }
    this.eat("op", "->");
    const tok = this.eat("ident");
    return { path, tile: tok.value, tilePos: tok.pos, pathPos: pathTok.pos };
  }

  protected parseInitList(): Expr[] {
    this.eat("op", "[");
    const out: Expr[] = [];
    if (!this.matchOp("]")) {
      out.push(this.parseExpr());
      while (this.matchOp(",")) {
        this.next();
        out.push(this.parseExpr());
      }
    }
    this.eat("op", "]");
    return out;
  }
}
