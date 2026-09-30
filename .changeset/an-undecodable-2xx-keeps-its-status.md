---
"@kumikijs/runtime": patch
---

Report a 2xx whose body does not decode with its real status, and do not retry it

`res.json()` ran inside the same `try` as `fetch`, so a parse error on a
successful response landed in the connection-error catch and came back as
`{status: 0, message: "SyntaxError: …", body: ""}`. The retry loop reads
`status: 0` as a connection error, so a `retry=` POST that the server had
accepted (201, answered with an HTML page or an empty body) was sent again on
every attempt, which duplicated the order.

The body is now read as text and parsed separately. A parse failure is an
`HttpError` with the response's status, a `message` starting `decode failed:`,
and the text in `body` (http.md §6.1.4). It is neither a 5xx nor status 0, so
it is not retried (§6.5). A rejected fetch is still `status: 0` and still
retried, and so is a 5xx.
