---
"@kumikijs/runtime": patch
---

An episode logger that throws as it records a request's `effect-end` no longer leaves that request's episode open, which held back every later episode an `onEpisode` hook was due

The throw is reported as before, and the request's `.ok` / `.err` reducers still
do not run. Once its `panic` step is on the episode that claimed the request,
that episode records an `effect-cancel` for the effect and commits, so
`onEpisode` goes on handing over the episodes begun after it, in order. This
holds whether a host's logger threw before the built-in one recorded the step,
the built-in logger's own clock threw as it stamped it, or a host's logger threw
after the built-in one had recorded it; in that last case the episode keeps its
`effect-end` and commits with no `effect-cancel`. A throw as that episode
commits, from `onCommit` or `onEpisode`, is reported too, with no episode.
