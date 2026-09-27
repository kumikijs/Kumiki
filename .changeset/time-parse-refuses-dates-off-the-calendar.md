---
"@kumikijs/runtime": patch
---

`Time.parse` refuses a date that is not on the calendar, and text with blanks around it

`Time.parse("2026-02-30")` was `Some` of March 2nd, and `"2026-13-01"` was
January 1st of the next year. The platform's date constructor normalises an
out-of-range field instead of refusing it, and `Date.parse` does the same to
a datetime (`"2026-02-30T10:00"`). stdlib.md §2.4.3 says a text that names no
instant is `None`, and a date that is not on the calendar names none.

The month and day of a leading `YYYY-MM-DD` are now checked against the
calendar (leap years included) before anything reads them. `"2026-02-28"` is
still local midnight of that day. The reading is also exact now, like
`Int.parse`: `" 2026-02-28"` was UTC midnight (the platform's reading, not the
local one) and is now `None`. A year below 100 is that year, not 19xx.
