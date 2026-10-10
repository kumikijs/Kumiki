import type {
  AppShape,
  CapabilityProvider,
  MountedApp,
  ReducerSpec,
  TileNode,
} from "@kumikijs/runtime";
import { vi } from "vitest";

export type User = { id: string; name: string };

export const GUEST: User = { id: "guest", name: "guest" };

/** An `http.get` provider that answers every request with `user`. */
export const userProvider = (user: User = { id: "u_1", name: "Yui" }) =>
  vi.fn<CapabilityProvider>(async () => ({ kind: "ok", value: user }));

/**
 * Loads a `user` at init through the host's `http.get` provider and counts clicks on `+`;
 * `draft` is volatile. `reducers` join `userLoaded` and `inc`.
 */
export function userApp(reducers: ReducerSpec[] = []): AppShape {
  const app: AppShape = {
    slots: {
      user: { value: GUEST },
      count: { value: 0 },
      draft: { value: "", volatile: true },
    },
    caps: ["http.get"],
    effects: {
      loadUser: {
        name: "loadUser",
        cap: "http.get",
        invoke: async (input, caps) => {
          const provider = caps.provider("http.get");
          if (!provider) return { kind: "err", value: "no provider" };
          return await provider(input, caps);
        },
      },
    },
    init: [{ effect: "loadUser", args: [{ url: "/api/me" }] }],
    reducers: [
      {
        name: "userLoaded",
        event: { kind: "effect", effect: "loadUser", outcome: "ok" },
        apply: (_live, payload) => ({ slots: { user: payload.$1 as User }, emits: [] }),
      },
      {
        name: "inc",
        selector: { tile: "IncBtn" },
        event: { kind: "ui", ev: "click" },
        apply: (live) => ({ slots: { count: (live.count as number) + 1 }, emits: [] }),
      },
      ...reducers,
    ],
    root: (): TileNode => ({
      kind: "column",
      children: [
        { kind: "heading", text: `Hi ${((app.live?.user as User) ?? { name: "?" }).name}` },
        { kind: "text", text: `count: ${app.live?.count ?? 0}` },
        {
          kind: "button",
          text: "+",
          props: { onClick: () => (app as MountedApp)._dispatch?.("inc", {}) },
        },
      ],
    }),
  };
  return app;
}
