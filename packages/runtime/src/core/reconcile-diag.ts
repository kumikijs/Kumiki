import { neverEqualCause, ownFieldPairs, tileTouchedId } from "./tile-equality.ts";
import type {
  DiagnosticSite,
  MountOptions,
  ReconcileFallback,
  RuntimeDiagnostic,
  TileNode,
} from "./types.ts";

export type ReconcileDiag = {
  fallback: (fallback: ReconcileFallback, node: TileNode) => void;
  neverEqual: (oldNode: TileNode, newNode: TileNode) => void;
};

export function makeReconcileDiag(
  report: (d: RuntimeDiagnostic) => void,
  options: MountOptions,
): ReconcileDiag {
  const hostKinds = options.hostTileKinds?.length ? new Set(options.hostTileKinds) : undefined;
  const authored = (node: TileNode): string | undefined => {
    const name = (node as { props?: Record<string, unknown> }).props?._tile;
    return typeof name === "string" ? name : undefined;
  };
  const emit = (d: RuntimeDiagnostic): void => {
    try {
      report(d);
    } catch {
      // A throwing sink must not break the render it observes.
    }
  };
  const scan = (
    oldNode: TileNode,
    newNode: TileNode,
    hazard: (
      site: DiagnosticSite,
      field: string,
      oldValue: unknown,
      newValue: unknown,
    ) => RuntimeDiagnostic | undefined,
  ): void => {
    if (!hostKinds?.has(newNode.kind)) return;
    try {
      const site: DiagnosticSite = {
        tileKind: newNode.kind,
        id: tileTouchedId(newNode),
        tile: authored(newNode),
      };
      for (const [field, oldValue, newValue] of ownFieldPairs(oldNode, newNode)) {
        const d = hazard(site, field, oldValue, newValue);
        if (d) emit(d);
      }
    } catch {
      // A node the scan cannot read yields no diagnostic rather than a failed render.
    }
  };
  return {
    fallback(fallback, node) {
      emit({
        kind: "reconcile-fallback",
        tileKind: node.kind,
        id: tileTouchedId(node),
        tile: authored(node),
        ...fallback,
      });
    },
    neverEqual(oldNode, newNode) {
      scan(oldNode, newNode, (site, field, oldValue, newValue) => {
        const cause = neverEqualCause(oldValue, newValue);
        return cause ? { ...site, kind: "never-equal-prop", field, cause } : undefined;
      });
    },
  };
}
