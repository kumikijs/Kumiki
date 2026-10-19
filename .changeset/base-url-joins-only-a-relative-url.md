---
"@kumikijs/runtime": patch
---

Join `app.http.base-url` to a relative url with one `/`, and leave an absolute url alone

http.md §6.3.1 calls `base-url` the base for relative URLs, but the built-in
handler fetched `base-url + url` for every request. Under
`base-url: "https://api.example.com/"`, `url: "https://cdn.other.org/item.json"`
requested `https://api.example.com/https://cdn.other.org/item.json` and
`url: "/items/1"` requested `https://api.example.com//items/1`; without the
trailing `/`, `url: "items/1"` requested `https://api.example.comitems/1`.

Now an absolute url (one with a scheme such as `https:`, or a leading `//`) is
fetched as written, and any other url is joined to the base with exactly one
`/`, whether either side, both or neither carries it. A base with a path is a
prefix: `https://api.example.com/v1` with `/users` fetches
`https://api.example.com/v1/users`. An empty url, or one starting with `?` or
`#`, is still appended to the base as written, as is any url under a base that
carries a `?` or a `#` (`https://api.example.com/search?q=` with `term` still
fetches `…/search?q=term`). With no `base-url` every url is fetched as written.
A url that is not text is joined as its text, so the request is still made.

One program that worked before now goes elsewhere: a url whose first segment
looks like a scheme (`users:search`) is now absolute; write `/users:search`.

§6.3.1 states the rule. Example 190 makes three of these requests through the
real handler in `smoke`: one with a leading `/`, one without, and an `https:`
url.

Under a `base-url`, `app.http`'s `headers` and `credentials` now go only with a
request to the base's origin. An absolute url on another origin
(`https://cdn.other.org/item.json`) is sent with neither: no global
`Authorization`, and the default `same-origin` credentials. A request that
needs a header there names it in its own `headers`. With no `base-url` nothing
changes.
