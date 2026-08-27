# @kumikijs/compiler

Kumiki compiler — lexer, parser, typechecker, and code generator. Part of [Kumiki](https://github.com/kumikijs/Kumiki), an AI-first web framework language.

## Install

```sh
npm i @kumikijs/compiler
```

## Usage

```ts
import { check, compile, lex, parse } from "@kumikijs/compiler";

// Type-check a .kumiki source (returns diagnostics)
const diagnostics = check(source);

// Compile a source into a runnable HTML app
const result = compile(source);
```

To inline the runtime bundle from disk in a Node environment, use the `./node` subpath:

```ts
import { compile } from "@kumikijs/compiler";
import { nodeRuntimeBundleReader } from "@kumikijs/compiler/node";

const result = compile(source, { bundle: true, readRuntimeBundle: nodeRuntimeBundleReader });
```

## License

Apache-2.0
