import * as fs from "node:fs";
import { directDeps, load, type Store } from "../store.ts";
import { messageOf } from "../text.ts";
import { computeHash } from "./hash.ts";

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(ms: number): string {
  let s = "";
  let n = ms;
  for (let i = 0; i < 10; i++) {
    s = ULID_ALPHABET[n % 32] + s;
    n = Math.floor(n / 32);
  }
  return s;
}

export function newId(prefix: string): string {
  const ts = encodeTime(Date.now());
  let rand = "";
  for (let i = 0; i < 16; i++) rand += ULID_ALPHABET[Math.floor(Math.random() * 32)];
  return `${prefix}_${ts}${rand}`;
}

export type OpLogEntry = {
  op: string;
  layer: string;
  name: string;
  body?: string;
  newName?: string;
  cascade?: boolean;
  /** Every definition a cascade deleted, the requested one first. */
  removed?: string[];
  bodies?: DefSpec[];
  with?: DefSpec[];
  prev?: string;
  patch?: unknown;
  author: string;
  ts: number;
  "op-id": string;
  "parent-ops": string[];
  "depends-on": string[];
};

export type RawOp = {
  op: string;
  layer: string;
  name: string;
  body?: string;
  newName?: string;
  cascade?: boolean;
  removed?: string[];
  bodies?: DefSpec[];
  with?: DefSpec[];
  prev?: string;
  patch?: unknown;
};

/** One definition as an `add` writes it: its layer, its name and its body. */
export type DefSpec = { layer: string; name: string; body: string };

export function opLogPath(path: string): string {
  return `${path}.kumiki-ops.jsonl`;
}

export function authorOf(): string {
  return process.env.KUMIKI_AUTHOR || "agent:local";
}

export function readOpLog(path: string): OpLogEntry[] {
  return readOpLogFile(path).entries;
}

type OpLogRead = {
  entries: OpLogEntry[];
  /** `null` when there is no log. */
  end: OpLogEnd | null;
};

/** Where the op log's complete lines end. */
type OpLogEnd = {
  /** Their length in bytes. */
  size: number;
  /** A skipped last line follows them. */
  torn: boolean;
  /** The last of them has no newline after it. */
  unterminated: boolean;
};

function readOpLogFile(path: string): OpLogRead {
  const p = opLogPath(path);
  if (!fs.existsSync(p)) return { entries: [], end: null };
  // Sizes are counted in the bytes, not the decoded text: a byte that is not
  // valid UTF-8 decodes to U+FFFD, which takes three.
  const bytes = fs.readFileSync(p);
  const lines = bytes.toString("utf8").split(/\r?\n/);
  const entries: OpLogEntry[] = [];
  let torn = false;
  for (const [i, line] of lines.entries()) {
    if (!line.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch (e) {
      // Warned at once, not by `process.emitWarning`, which waits a tick: a
      // verb that then fails exits before the warning is printed.
      if (i === lines.length - 1) {
        console.warn(
          `warning: ${p}:${i + 1}: skipped the last line, which is not valid JSON and has no newline after it; the next op logged replaces it`,
        );
        torn = true;
        continue;
      }
      throw new Error(`${p}:${i + 1}: not valid JSON (${messageOf(e)})`);
    }
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`${p}:${i + 1}: not an op object`);
    }
    const op = entry as OpLogEntry;
    const problem = opShapeProblem(op);
    if (problem !== undefined) throw new Error(`${p}:${i + 1}: ${problem}`);
    entries.push(op);
  }
  const size = torn ? bytes.lastIndexOf("\n") + 1 : bytes.length;
  return {
    entries,
    end: { size, torn, unterminated: size > 0 && bytes[size - 1] !== 0x0a },
  };
}

export function opShapeProblem(op: RawOp): string | undefined {
  const own = `${op.layer}.${op.name}`;
  if (op.with !== undefined) {
    if (op.op !== "add") return "`with` is only valid on `add`";
    const problem = defSpecsProblem(op.with, "with");
    if (problem !== undefined) return problem;
  }
  if (op.bodies !== undefined) {
    if (op.op !== "remove") return "`bodies` is only valid on `remove`";
    const problem = defSpecsProblem(op.bodies, "bodies");
    if (problem !== undefined) return problem;
    const [first] = op.bodies;
    if (first === undefined || `${first.layer}.${first.name}` !== own) {
      return `\`bodies\` must start with the op's own definition ${own}`;
    }
  }
  if (op.prev !== undefined) {
    if (op.op !== "replace" && op.op !== "edit")
      return "`prev` is only valid on `replace` and `edit`";
    const prev: unknown = op.prev;
    if (typeof prev !== "string") return "`prev` must be a string";
  }
  if (op.removed !== undefined) {
    if (op.op !== "remove" || op.cascade !== true) {
      return "`removed` is only valid on a cascade `remove`";
    }
    const removed: unknown = op.removed;
    if (!Array.isArray(removed) || !removed.every((q) => typeof q === "string")) {
      return "`removed` must be an array of qualified names";
    }
    if (removed[0] !== own) return `\`removed\` must start with the op's own definition ${own}`;
  }
  return undefined;
}

function defSpecsProblem(value: unknown, field: string): string | undefined {
  if (!Array.isArray(value)) return `\`${field}\` must be an array`;
  for (const [i, d] of value.entries()) {
    if (typeof d !== "object" || d === null) return `\`${field}\`[${i}] must be an object`;
    for (const key of ["layer", "name", "body"] as const) {
      if (typeof (d as Record<string, unknown>)[key] !== "string") {
        return `\`${field}\`[${i}].${key} must be a string`;
      }
    }
  }
  return undefined;
}

function computeDependsOn(path: string, layer: string, name: string, body: string): string[] {
  try {
    const store = load(path);
    const qname = `${layer}.${name}`;
    const deps = store.byQName.has(qname)
      ? directDeps(store, qname)
      : depsFromBody(store, body, name);
    const memo = new Map<string, string>();
    return deps
      .map((q) => {
        const entry = store.byQName.get(q);
        if (!entry) return null;
        return `${entry.layer}:${entry.name}@h:${computeHash(store, q, memo)}`;
      })
      .filter((s): s is string => s !== null)
      .sort();
  } catch {
    return [];
  }
}

function depsFromBody(store: Store, body: string, selfName: string): string[] {
  const refs = new Set<string>();
  for (const m of body.matchAll(/[a-zA-Z_][a-zA-Z0-9_-]*/g)) {
    const tok = m[0];
    if (!tok || tok === selfName) continue;
    for (const other of store.defs) {
      if (other.name === tok) refs.add(`${other.layer}.${other.name}`);
    }
  }
  return [...refs].sort();
}

export function logOp(path: string, op: RawOp): string {
  const id = newId("op");
  const log = readOpLogFile(path);
  const parent = log.entries.at(-1)?.["op-id"];
  const dependsOn = op.body !== undefined ? computeDependsOn(path, op.layer, op.name, op.body) : [];
  const entry: OpLogEntry = {
    op: op.op,
    layer: op.layer,
    name: op.name,
    ...(op.body !== undefined ? { body: op.body } : {}),
    ...(op.newName !== undefined ? { newName: op.newName } : {}),
    ...(op.cascade !== undefined ? { cascade: op.cascade } : {}),
    ...(op.removed !== undefined ? { removed: op.removed } : {}),
    ...(op.bodies !== undefined ? { bodies: op.bodies } : {}),
    ...(op.with !== undefined ? { with: op.with } : {}),
    ...(op.prev !== undefined ? { prev: op.prev } : {}),
    ...(op.patch !== undefined ? { patch: op.patch } : {}),
    author: authorOf(),
    ts: Date.now(),
    "op-id": id,
    "parent-ops": parent ? [parent] : [],
    "depends-on": dependsOn,
  };
  appendLine(opLogPath(path), JSON.stringify(entry), log.end);
  return id;
}

/** A failed append that left the op log other than it was. */
export class OpLogChanged extends Error {
  /** Cutting the log back failed too, so its last line may hold part of the op. */
  readonly mayHoldOp: boolean;

  constructor(message: string, mayHoldOp: boolean, options: ErrorOptions) {
    super(message, options);
    this.mayHoldOp = mayHoldOp;
  }
}

/** Appends after the log's complete lines, so the new line never runs on from a torn or unterminated one. */
function appendLine(file: string, line: string, end: OpLogEnd | null): void {
  if (end?.torn) fs.truncateSync(file, end.size);
  try {
    fs.appendFileSync(file, `${end?.unterminated ? "\n" : ""}${line}\n`);
  } catch (e) {
    try {
      if (end === null) fs.rmSync(file, { force: true });
      else fs.truncateSync(file, end.size);
    } catch (r) {
      const cut =
        end === null ? `removing ${file}` : `cutting ${file} back to its complete entries`;
      throw new OpLogChanged(
        `${messageOf(e)}; ${cut} failed too (${messageOf(r)}), so its last line may hold part of this op`,
        true,
        { cause: e },
      );
    }
    if (end?.torn) {
      throw new OpLogChanged(
        `${messageOf(e)}; ${file} holds its complete entries, and its skipped last line was cut off`,
        false,
        { cause: e },
      );
    }
    throw e;
  }
}
