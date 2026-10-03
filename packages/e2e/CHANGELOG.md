# @kumikijs/e2e

## 0.2.0

### Minor Changes

- 8d3595f: A scenario step that drives a control the platform would refuse now fails, naming the control and the reason, instead of passing (#369).

  `fill` on a `disabled` input moved the slot and ran the `ui.input` reducer, because the runner wrote the value and dispatched the event itself — so `disabled` never entered the picture. A scenario asserting a guard held was green having tested nothing.

  All three drivers — both verification tiers and `kumiki smoke` — now ask one rule before a verb drives a control (`controlFault` / `readControl`, beside `dispatchFault`): `disabled` refuses every verb that drives one, `readonly` and an `editable`'s `contenteditable="false"` refuse the typing alone. `hover` is deliberately outside the rule — Chromium fires `mouseenter` on a disabled control, measured rather than assumed. The rule cannot be left to the browser: Chromium refuses a real click on a disabled control but delivers a dispatched one, and dispatching is what a driver does.

  `expect.actionErrorIncludes` is the new key that asserts a refusal, so "this button is disabled and clicking it does nothing" is expressible rather than merely green. It matches the refusal alone, not the whole `actionError` channel, so a step cannot claim one on a selector that matched nothing. `kumiki run`'s trace prints a claimed refusal as `expected refusal:`.

  The rule resolves in both directions: a verb aimed at the `<label>` `check` / `radio` / `switch` render is judged by the `<input>` inside it, and a verb aimed at something inside a disabled control — the spinner a `loading` button renders — is judged by that control, since the dispatched event reaches it.

  `kumiki smoke` asks the same rule, and no longer fires at a control a user could not reach.

### Patch Changes

- Updated dependencies [276089b]
- Updated dependencies [f36269f]
- Updated dependencies [8eca379]
- Updated dependencies [6cae7d8]
- Updated dependencies [72ff1df]
- Updated dependencies [b2b14c4]
- Updated dependencies [a69f7f4]
- Updated dependencies [0a8762c]
- Updated dependencies [13eacc9]
- Updated dependencies [e96eba6]
- Updated dependencies [62cc960]
- Updated dependencies [68b27a1]
- Updated dependencies [2dfc73f]
- Updated dependencies [027cf25]
- Updated dependencies [bf86b16]
- Updated dependencies [3db2d76]
- Updated dependencies [b74e05a]
- Updated dependencies [fe62177]
- Updated dependencies [eb5215c]
- Updated dependencies [9a2965f]
- Updated dependencies [4f7e35b]
- Updated dependencies [1e90ba3]
- Updated dependencies [b53ae7f]
- Updated dependencies [1c1cb23]
- Updated dependencies [9237208]
- Updated dependencies [8820b8e]
- Updated dependencies [e7da073]
- Updated dependencies [fbbec02]
- Updated dependencies [fac7523]
- Updated dependencies [3e8d1ba]
- Updated dependencies [18f2e91]
- Updated dependencies [1bc3e8a]
- Updated dependencies [c858728]
- Updated dependencies [3043987]
- Updated dependencies [6925c32]
- Updated dependencies [8d3595f]
- Updated dependencies [fbbec02]
- Updated dependencies [e709ac7]
- Updated dependencies [8f2d978]
- Updated dependencies [13a5cbb]
- Updated dependencies [6b334a4]
- Updated dependencies [e2b8d2d]
- Updated dependencies [0aff1de]
- Updated dependencies [14522b7]
- Updated dependencies [e0ce4ed]
- Updated dependencies [7ed2e94]
- Updated dependencies [6b861ce]
- Updated dependencies [730690b]
- Updated dependencies [528c9d3]
- Updated dependencies [67a6ea1]
- Updated dependencies [29e24c1]
- Updated dependencies [e2a3cda]
- Updated dependencies [36340c7]
- Updated dependencies [8f7b051]
- Updated dependencies [1ed9ec0]
- Updated dependencies [f2a7d92]
- Updated dependencies [4e52e29]
- Updated dependencies [178199f]
- Updated dependencies [3aae0ea]
- Updated dependencies [b33d62d]
- Updated dependencies [39eb32b]
- Updated dependencies [fbd7685]
- Updated dependencies [5945a3e]
- Updated dependencies [0f4dc74]
- Updated dependencies [5072599]
- Updated dependencies [d029b60]
- Updated dependencies [88effc6]
- Updated dependencies [5907ee2]
- Updated dependencies [b2ee6a6]
- Updated dependencies [2adec5b]
- Updated dependencies [6f38fd8]
- Updated dependencies [1c1cb23]
- Updated dependencies [d0b334d]
- Updated dependencies [0f93dda]
- Updated dependencies [aa8ce0b]
- Updated dependencies [dbae0a7]
- Updated dependencies [dbf5258]
- Updated dependencies [a489ee1]
- Updated dependencies [4cd6c29]
- Updated dependencies [29aa08e]
- Updated dependencies [46d9dca]
- Updated dependencies [4b126f4]
- Updated dependencies [21dc29e]
- Updated dependencies [c1df514]
- Updated dependencies [1b92331]
- Updated dependencies [3573ca7]
- Updated dependencies [d8ff739]
- Updated dependencies [3573ca7]
- Updated dependencies [58d3da3]
- Updated dependencies [db913dc]
- Updated dependencies [8d4eb0c]
- Updated dependencies [891a942]
- Updated dependencies [d3d6611]
- Updated dependencies [d9d29ca]
- Updated dependencies [ead317d]
- Updated dependencies [7cedcce]
- Updated dependencies [ad2c6f8]
- Updated dependencies [43ccd6e]
- Updated dependencies [2546469]
- Updated dependencies [fe8e6a4]
- Updated dependencies [2061f11]
- Updated dependencies [b7e922c]
- Updated dependencies [0a7ae12]
- Updated dependencies [1a3b24c]
- Updated dependencies [da4069f]
- Updated dependencies [fe8e6a4]
- Updated dependencies [f9a999c]
- Updated dependencies [739cd7a]
- Updated dependencies [b9e5ca6]
  - @kumikijs/compiler@0.14.0
  - @kumikijs/runtime@0.14.0

## 0.1.14

### Patch Changes

- Updated dependencies [82cfa6c]
- Updated dependencies [3b1f5e8]
- Updated dependencies [7cce9ce]
- Updated dependencies [301b09a]
- Updated dependencies [3e33233]
- Updated dependencies [f04b1c5]
- Updated dependencies [7a754ad]
- Updated dependencies [c11152b]
- Updated dependencies [d398cbc]
- Updated dependencies [732cb16]
- Updated dependencies [b8bd5d9]
- Updated dependencies [db8e843]
  - @kumikijs/compiler@0.13.0

## 0.1.13

### Patch Changes

- Updated dependencies [46bee64]
- Updated dependencies [5fb6fb6]
- Updated dependencies [3d89383]
- Updated dependencies [687ae40]
- Updated dependencies [46bee64]
- Updated dependencies [49cafdb]
  - @kumikijs/compiler@0.12.0

## 0.1.12

### Patch Changes

- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
  - @kumikijs/compiler@0.11.0

## 0.1.11

### Patch Changes

- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
  - @kumikijs/compiler@0.10.0

## 0.1.10

### Patch Changes

- Updated dependencies [7e589bc]
  - @kumikijs/compiler@0.9.0

## 0.1.9

### Patch Changes

- Updated dependencies [3ee1a9a]
  - @kumikijs/compiler@0.8.0

## 0.1.8

### Patch Changes

- Updated dependencies [afe1b15]
- Updated dependencies [e92f5df]
- Updated dependencies [33fc749]
  - @kumikijs/compiler@0.7.0

## 0.1.7

### Patch Changes

- Updated dependencies [cd1e88a]
  - @kumikijs/compiler@0.6.0

## 0.1.6

### Patch Changes

- Updated dependencies [20c8601]
  - @kumikijs/compiler@0.5.0

## 0.1.5

### Patch Changes

- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
  - @kumikijs/compiler@0.4.0

## 0.1.4

### Patch Changes

- Updated dependencies [81d0791]
  - @kumikijs/compiler@0.3.1

## 0.1.3

### Patch Changes

- Updated dependencies [be38e20]
  - @kumikijs/compiler@0.3.0

## 0.1.2

### Patch Changes

- Updated dependencies [c0c1708]
  - @kumikijs/compiler@0.2.1

## 0.1.1

### Patch Changes

- Updated dependencies [77938ee]
  - @kumikijs/compiler@0.2.0
