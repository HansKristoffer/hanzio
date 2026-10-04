# hanzio

hanzio is a small TypeScript-first utility library published to npm. The root
`hanzio` entry holds dependency-free helpers (arrays, strings, promises, cache,
state, dates, URLs, colors, errors, guards). Anything that needs Zod, the
network, or a specific runtime lives on its own subpath export, such as
`hanzio/zod`, `hanzio/api-wrapper` or `hanzio/secrets`.

## What we never compromise on

1. **The root entry is free.** No dependencies, no Node or Bun built-ins, and it
   runs unchanged in Bun, Node, Workers, React Native and the browser. Biome
   enforces this for every module re-exported from `src/index.ts`.
2. **Zod is an optional peer.** Subpaths that need it import `zod`, so they
   share the consumer's Zod instance. Never bundle it, and never let the root
   entry load it.
3. **Tree-shakeable ESM.** `sideEffects: false` is a promise: importing a module
   must not do work at load time.
4. **Types are the product.** Consumers pick hanzio for inference: literal key
   unions, narrowed discriminated unions, `Result` with an `ok` discriminant. A
   helper that returns `any` or loses a literal type is a regression.

## A note from the maintainer

Small APIs, boring code. Fight scope creep: a helper earns its place when real
application code keeps rewriting it, not because it would be nice to have. Do
not keep complexity just because it already exists. Prefer one obvious function
over an options bag that covers every case.

These are good defaults, not hard rules. My preferences in the conversation
override anything here. If a rule fights the task in front of you, say so
loudly and ask before breaking it.

## Words we use

- **you** means the agent reading this file and changing hanzio.
- **we** and **the maintainer** mean Kristoffer, the person you are talking to.
- **consumer** means an application that installs hanzio from npm.
- **root entry** means `hanzio` (`src/index.ts`). **subpath** means any other
  entry in `package.json#exports`.
- **module** means one folder under `src/`, with its `index.ts`, tests, and
  optionally a `README.md`.

## The three ways to hurt yourself

1. **Leaking into the root entry.** Importing `zod`, `node:*` or any package, or
   relatively importing a subpath module, from code the root entry re-exports.
   Every consumer then pays for it, and Workers and browsers break. Biome
   rejects these imports. Move the code to a subpath instead of silencing it.
2. **Breaking the public API quietly.** Renaming, removing, or changing the
   behavior or inferred type of an export is a major release. Use `feat!:` and
   add a line to "Migrating to X" in `README.md`.
3. **Editing release state by hand.** Release Please owns `version`,
   `CHANGELOG.md` and `.release-please-manifest.json`. The PR title decides the
   release. See [docs/releasing.md](docs/releasing.md).

## Hit every surface

The most common defect here is an export that works from source but is missing
from the published package. When you add, rename or remove a subpath, walk this
list and say which entries applied:

- `package.json#exports`, with all four conditions (`types`, `bun`, `import`,
  `default`).
- The `build:js` entry list in `package.json#scripts`.
- `expectedExports` in `scripts/verify-exports.mjs`.
- The imports table in `README.md`, and the module's own `README.md`.
- A colocated `*.test.ts`.
- `src/index.ts` and its header comment, if the module moves between root and
  subpath.

When you add a helper to an existing module, update that module's README
section. Add it to `README.md` only if it belongs to the root entry.

## Verifying

- Smallest proof that the change works: `bun test src/<module>`,
  `bun run typecheck`, and `bunx biome check <changed files>`.
- Run `bun run test:exports` and `bun run verify:package` only when you touched
  exports, the build, or the `files` list. CI runs the full suite.
- Test observable behavior and inferred types, not implementation details.
  Type tests put `// @ts-expect-error` lines inside an uncalled function, as in
  `src/api-wrapper/types.test.ts`.

## Pull requests

- Never open a PR unless I ask.
- Conventional title in plain language, for example
  `fix(array): sortBy keeps nullish values last`. `fix`/`perf` release a patch,
  `feat` a minor, `feat!` a major, and everything else does not release.
- Body: the problem in a sentence or two, how you fixed it, and how you
  verified it. End with the model and harness that did the work.

## Documentation

- `README.md` covers install, the imports table, migration notes, and the root
  entry's helpers. Each `src/<module>/README.md` is that subpath's API
  reference. It ships to npm, so write it for consumers.
- `src/api-wrapper/SKILL.md` is an agent guide for consumers building API
  clients. It ships to npm. It does not describe how to change hanzio itself.
- `docs/` holds maintainer procedures, such as releasing.
- Show usage with a short example. Do not list every option the types already
  show, and do not narrate the implementation.
- When behavior changes, rewrite the affected text. Do not append a second
  account of it.
- Do not commit plans, research notes or scratch files. `.plans/` is gitignored
  as a safety net.

## Where code lives

- `src/<module>/` holds one module: its `index.ts` is the public surface, with
  helpers in sibling files and tests in `*.test.ts` next to them.
- `src/index.ts` is the root entry and only re-exports root modules.
- `scripts/` verifies the packed tarball (exports, secrets runtime, consumer
  install) and publishes it.
- `.github/workflows/` runs CI on every PR and releases on merge.

## Taste

- Inferred types over annotations. `any` is the enemy; reach for generics and
  `const` type parameters first.
- Invalid arguments throw with a message that names the bad value.
- Do not mutate inputs. Sorting and grouping helpers return new arrays.
- Comments say how a function is used and why. They do not narrate each line.
- Formatting follows Biome: tabs, single quotes, no semicolons, no trailing
  commas.
