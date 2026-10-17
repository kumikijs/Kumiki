import { isPositiveInt } from "@kumikijs/runtime/positive-int";
import type { MotionDef, ThemeValue } from "../ast.ts";
import type { KumikiError } from "./context.ts";

const MOTION_KEYFRAME_PROPS = new Set(["opacity", "translate-x", "translate-y", "scale", "rotate"]);

const MOTION_EASINGS = new Set(["linear", "ease", "ease-in", "ease-out", "ease-in-out"]);

const MOTION_DURATION_TOKENS = new Set(["fast", "normal", "slow"]);

const MOTION_DIRECTIONS = new Set(["normal", "reverse", "alternate", "alternate-reverse"]);

const MOTION_TIMING_KEYS = new Set(["duration", "easing", "iteration", "direction"]);

type MotionBody = { [k: string]: ThemeValue };

export function checkMotion(def: MotionDef, errors: KumikiError[]): void {
  const body = def.body as MotionBody;
  const keyframes = body.keyframes;
  if (typeof keyframes !== "object" || Array.isArray(keyframes)) {
    errors.push({
      code: "E0403",
      kind: "motion-malformed",
      message: `motion "${def.name}" must declare a "keyframes" record`,
      pos: def.pos,
    });
    return;
  }
  const stops = keyframes as MotionBody;
  for (const required of ["from", "to"]) {
    const stop = stops[required];
    if (typeof stop !== "object" || Array.isArray(stop)) {
      errors.push({
        code: "E0403",
        kind: "motion-malformed",
        message: `motion "${def.name}" keyframes must include a "${required}" record`,
        pos: def.pos,
      });
      return;
    }
  }
  for (const stopName of Object.keys(stops)) {
    if (stopName !== "from" && stopName !== "to") {
      errors.push({
        code: "E0403",
        kind: "motion-malformed",
        message: `motion "${def.name}" keyframes support only "from" / "to" (got "${stopName}")`,
        pos: def.pos,
      });
      continue;
    }
    const stop = stops[stopName] as MotionBody;
    for (const [prop, val] of Object.entries(stop)) {
      if (!MOTION_KEYFRAME_PROPS.has(prop)) {
        errors.push({
          code: "E0401",
          kind: "motion-unknown-property",
          message: `motion "${def.name}": unknown keyframe property "${prop}" (allowed: ${[...MOTION_KEYFRAME_PROPS].join(", ")})`,
          pos: def.pos,
        });
      } else if (typeof val !== "number") {
        errors.push({
          code: "E0401",
          kind: "motion-unknown-property",
          message: `motion "${def.name}": keyframe property "${prop}" must be a number`,
          pos: def.pos,
        });
      }
    }
  }
  for (const key of Object.keys(body)) {
    if (key === "keyframes") continue;
    if (!MOTION_TIMING_KEYS.has(key)) {
      errors.push({
        code: "E0402",
        kind: "motion-invalid-timing",
        message: `motion "${def.name}": unknown field "${key}" (allowed: keyframes, ${[...MOTION_TIMING_KEYS].join(", ")})`,
        pos: def.pos,
      });
    }
  }
  const dur = body.duration;
  if (dur !== undefined && !(isPositiveInt(dur) || MOTION_DURATION_TOKENS.has(String(dur)))) {
    errors.push({
      code: "E0402",
      kind: "motion-invalid-timing",
      message: `motion "${def.name}": duration must be a positive Int (ms) or one of fast/normal/slow`,
      pos: def.pos,
    });
  }
  const eas = body.easing;
  if (eas !== undefined && !MOTION_EASINGS.has(String(eas))) {
    errors.push({
      code: "E0402",
      kind: "motion-invalid-timing",
      message: `motion "${def.name}": easing must be one of ${[...MOTION_EASINGS].join(", ")}`,
      pos: def.pos,
    });
  }
  const iter = body.iteration;
  if (iter !== undefined && !(isPositiveInt(iter) || iter === "infinite")) {
    errors.push({
      code: "E0402",
      kind: "motion-invalid-timing",
      message: `motion "${def.name}": iteration must be a positive Int or "infinite"`,
      pos: def.pos,
    });
  }
  const dir = body.direction;
  if (dir !== undefined && !MOTION_DIRECTIONS.has(String(dir))) {
    errors.push({
      code: "E0402",
      kind: "motion-invalid-timing",
      message: `motion "${def.name}": direction must be one of ${[...MOTION_DIRECTIONS].join(", ")}`,
      pos: def.pos,
    });
  }
}
