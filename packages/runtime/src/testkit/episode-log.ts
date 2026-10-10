import type { EnvRead, PanicCategory, PanicCauseLink } from "../core.ts";

export type EpisodeReducerStep = {
  kind: "reducer";
  name: string;
  "slot-diffs"?: { name: string; before?: unknown; after: unknown }[];
  emits?: string[];
  /** What the body read from the environment. Absent in older logs. */
  "env-reads"?: EnvRead[];
  ts?: number;
};

type EpisodeEffectEndStep = {
  kind: "effect-end";
  name: string;
  result: "ok" | "err";
  value: unknown;
  ts?: number;
};

export type EpisodeStepLite =
  | EpisodeReducerStep
  | { kind: "effect-start"; name: string; args?: unknown; ts?: number }
  | EpisodeEffectEndStep
  | { kind: "signal-update"; "dirty-slots"?: string[]; "binds-updated"?: string[]; ts?: number }
  | {
      kind: "panic";
      message: string;
      location?: string;
      /** The reducer that threw, when the throw came from a reducer body. */
      name?: string;
      /** What that body read from the environment before it threw. */
      "env-reads"?: EnvRead[];
      /** Root-cause devtools trail — optional so older logs still parse. */
      stack?: string;
      cause?: PanicCauseLink[];
      category?: PanicCategory;
      ts?: number;
    };

export type EpisodeLogEntry = {
  id: string;
  trigger: { kind: string; target?: string; payload?: unknown; ts?: number };
  steps: EpisodeStepLite[];
  status: "completed" | "panic" | "cancelled" | "ongoing";
};

export type EpisodeMockPolicy =
  | { policy: "from-log" }
  | { policy: "ignore" }
  | { policy: "fixed"; outcome: "ok" | "err"; value: unknown };
