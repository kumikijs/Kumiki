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
`/`, whichever side carries it. A base with a path is a prefix:
`https://api.example.com/v1` with `/users` fetches
`https://api.example.com/v1/users`. An empty url, or one starting with `?` or
`#`, is still appended to the base as written, and with no `base-url` every url
is fetched as written. §6.3.1 states the rule, and example 190 makes each kind
of request through the real handler in `smoke`.
