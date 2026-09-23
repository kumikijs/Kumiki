---
"@kumikijs/runtime": minor
"@kumikijs/e2e": minor
"@kumikijs/mcp": patch
"@kumikijs/cli": patch
---

A scenario step that drives a control the platform would refuse now fails, naming the control and the reason, instead of passing (#369).

`fill` on a `disabled` input moved the slot and ran the `ui.input` reducer, because the runner wrote the value and dispatched the event itself — so `disabled` never entered the picture. A scenario asserting a guard held was green having tested nothing.

All three drivers — both verification tiers and `kumiki smoke` — now ask one rule before a verb drives a control (`controlFault` / `readControl`, beside `dispatchFault`): `disabled` refuses every verb that drives one, `readonly` and an `editable`'s `contenteditable="false"` refuse the typing alone. `hover` is deliberately outside the rule — Chromium fires `mouseenter` on a disabled control, measured rather than assumed. The rule cannot be left to the browser: Chromium refuses a real click on a disabled control but delivers a dispatched one, and dispatching is what a driver does.

`expect.actionErrorIncludes` is the new key that asserts a refusal, so "this button is disabled and clicking it does nothing" is expressible rather than merely green. It matches the refusal alone, not the whole `actionError` channel, so a step cannot claim one on a selector that matched nothing. `kumiki run`'s trace prints a claimed refusal as `expected refusal:`.

`kumiki smoke` asks the same rule, and no longer fires at a control a user could not reach.
