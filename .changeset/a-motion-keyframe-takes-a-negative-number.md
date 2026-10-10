---
"@kumikijs/compiler": patch
---

A `motion` keyframe (and any `theme` value) can be a negative number.

```kumiki fragment
motion SlideFromLeft = {
    keyframes: {from: {translate-x: -24, opacity: 0}, to: {translate-x: 0, opacity: 1}}
}
```

was a parse error whose message said the value was not a number:

```
$ kumiki check app.kumiki
Error: Parse error at 2:37: Theme values must be string, number, or nested record
```

The lexer emits a `-` as its own operator, and the record reader behind `theme`
and `motion` bodies took only a bare number token, so `translate-x: -24` and
`rotate: -90` could not be written. The only other spelling, `"-24"`, is refused
by the motion checker as not a number (E0401). A slide in from the left or the
top, or a counter-clockwise turn, had no spelling at all.

The language spec makes the sign part of a number literal, and the record reader now
puts it back through the same rule the retry and duration positions use. Now:

```
$ kumiki check app.kumiki
ok
```

and the keyframe the runtime builds for `from` is
`opacity: 0; transform: translateX(-24px)`; `rotate: -90` gives
`rotate(-90deg)`. A `-` before anything but a number (`-`, `-"4px"`, `-{…}`) is
still the same parse error. A negative `duration` or `iteration` now reaches the
motion checker instead of the parser, and is E0402, as `0` already was.
