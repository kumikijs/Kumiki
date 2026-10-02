---
"@kumikijs/runtime": patch
---

`Time.parse` reads ISO 8601 `YYYY-MM-DD` with an optional time and zone, and refuses everything else, including a date that is not on the calendar

`Time.parse("2026-02-30")` was `Some` of March 2nd, and `"2026-13-01"` was
January 1st of the next year. The text went to the platform's parser, which
normalises an out-of-range field instead of refusing it, reads some non-ISO
text with a legacy parser (`"0050-01-01 10:00"` was 1950), and accepts
formats such as `"2026/02/30"` or `"Aug 14 2026"` that differ between engines.

`Time.parse` now reads the text itself, as stdlib.md §2.2.8 states:
`YYYY-MM-DD`, then optionally `T`, `t` or a space and `HH:MM`, `:SS` and a
fraction, then optionally `Z`, `z` or `±HH:MM`. The date has to be on the
calendar (leap years included) and the year is the one written. Without a
zone the text is local time, as a date-only string already was; with one it
is that instant. Anything else is `None`: a date off the calendar in any of
these forms, the extended-year form `+002026-08-14`, a non-ISO date, and text
with blanks around it (`" 2026-02-28"` was UTC midnight, not the local one).
