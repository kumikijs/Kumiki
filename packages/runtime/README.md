# @kumikijs/runtime

Kumiki DOM runtime — mounts compiled Kumiki apps, dispatches effects, and manages the signal graph. Part of [Kumiki](https://github.com/kumikijs/Kumiki).

You normally do not import this directly: the compiler embeds the runtime into generated apps. It is published so generated apps and tooling can resolve it.

## Install

```sh
npm i @kumikijs/runtime
```

## Exports

- `@kumikijs/runtime` — the runtime API (`mount`, `runScenario`, `smoke`, …).
- `@kumikijs/runtime/bundle` — the prebuilt, self-contained runtime bundle as a single unminified file, embedded verbatim into generated apps (smoke/run/test and the playground).
- `@kumikijs/runtime/bundle.min` — the same bundle, minified, for hosts that want the full runtime as one file.
- `@kumikijs/runtime/modules/*` — the granular feature modules (minified ESM): `core`, `stdlib`, `testkit`, `router`, `effects-{storage,http,toast,decode,indexed,confirm}`, `tiles-{layout,collection,overlay,media,status}`, one module per text tile `tiles-text-{text,heading,label,link,code,icon,markdown}`, and one per input tile `tiles-input-{button,input,textarea,select,check,radio,switch,slider,editable,form}` plus their shared `tiles-input-shared`. `kumiki build` ships only the ones a compiled app imports, so an app that never routes or renders tables carries no router/table code.

## License

Apache-2.0
