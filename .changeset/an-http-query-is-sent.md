---
"@kumikijs/runtime": patch
---

Send an HTTP effect's `query` as the URL's query string

http.md §6.1.2 puts `query: Map(Text, Text)` in every HTTP request, and the
spec's own expansion example carries `query: {}`. The built-in handler fetched
`base-url + url` and never read it, so `map-request={url: "/search", query:
{"q": $1}}` requested `/search` — `check` and `build` said ok, the headers from
the same record were sent, and the server answered an unfiltered request.

Each entry is now URL-encoded and appended to `url`, after any query string it
already carries and before a fragment: `{url: "/search?x=1", query: {"q":
"a b&c"}}` requests `/search?x=1&q=a+b%26c`. An empty `query` leaves the url as
written. Example 127 makes the request through the real handler in `smoke`,
against a fixture that answers only the encoded URL.

This holds for every `http.*` method, not only `http.get`: a `query` on an
`http.post` effect was dropped the same way and is now sent, and the spec's
`http-post` signature now lists `query` (put / patch / delete share its shape).
