---
"@kumikijs/runtime": patch
---

A submit button with a click reducer submits its form in a browser

The button renderer cancelled every click it had a handler for, and
cancelling a submit button's click cancels its activation: as soon as a
`ui.click` reducer (or a lifted one, or `onClick=`) targeted a
`type="submit"` button, its form never submitted — by click or by Enter —
while the scenario tier, whose clicks were not cancelable, passed. The click
is no longer cancelled (forms.md §5.2.2: the click reducer and the submit are
independent; `type="button"` is what keeps a button from submitting), and the
scenario and smoke tiers now dispatch cancelable clicks, as a user's click is.
That includes a button inside a form that writes no `type`: it is `submit` by
the HTML default, so its click reducer now runs and the form submits. The
issue tracker example's Cancel button now says `type="button"`, as §5.2.2 asks
of a button in a form that is not meant to submit it.
