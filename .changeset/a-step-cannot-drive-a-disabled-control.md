---
"@kumikijs/runtime": minor
"@kumikijs/e2e": minor
"@kumikijs/mcp": patch
---

A scenario step that drives a control the platform would refuse now fails, naming the control and the reason, instead of passing (#369).

`fill` on a `disabled` input moved the slot and ran the `ui.input` reducer, because the runner wrote the value and dispatched the event itself — so `disabled` never entered the picture. A scenario asserting a guard held was green having tested nothing.

Both verification tiers now ask one rule before a verb drives a control (`controlFault` / `readControl`, beside `dispatchFault`): `disabled` refuses every verb that drives one, `readonly` and an `editable`'s `contenteditable="false"` refuse the typing alone. `hover` is deliberately outside the rule — Chromium fires `mouseenter` on a disabled control, measured rather than assumed.

`expect.actionErrorIncludes` is the new key that asserts a refusal, so "this button is disabled and clicking it does nothing" is expressible rather than merely green.
