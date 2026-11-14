# Changelog

## [4.0.1](https://github.com/HansKristoffer/hanzio/compare/v4.0.0...v4.0.1) (2026-11-14)


### Bug Fixes

* ship CHANGELOG.md in the npm package ([#39](https://github.com/HansKristoffer/hanzio/issues/39)) ([43b2505](https://github.com/HansKristoffer/hanzio/commit/43b2505b96bf1f4c4f1671e8efecc2d6ca56f054))

## [4.0.0](https://github.com/HansKristoffer/hanzio/compare/v3.4.0...v4.0.0) (2026-11-12)


### ⚠ BREAKING CHANGES

* **secrets:** import getViteDefine, viteSecretSetPlugin and readPublicConfig from hanzio/secrets/vite
* **secrets:** the default "Loaded secrets" line is written to stderr
* **secrets:** an Infisical set without a projectId fails when it is declared, even when env overrides supply every key
* **testing:** ModuleMocker.mock throws for an export the module does not have, and gains replace()
* **testing:** mockCallArg throws for a missing call or argument
* **api-wrapper:** POST and PATCH are retried only on 429 unless the endpoint sets `idempotent: true`

### Features

* **api-wrapper:** createMockFetch takes a queue of responses and is assignable to typeof fetch ([c7e50b0](https://github.com/HansKristoffer/hanzio/commit/c7e50b05501b0b8fe7293ac1f0f48f6455572301))
* **api-wrapper:** POST and PATCH are retried only on 429 unless the endpoint sets `idempotent: true` ([c7e50b0](https://github.com/HansKristoffer/hanzio/commit/c7e50b05501b0b8fe7293ac1f0f48f6455572301))
* **crypto:** sealer fallbacks may carry their own secret, and needsReseal tells when to re-seal ([c7e50b0](https://github.com/HansKristoffer/hanzio/commit/c7e50b05501b0b8fe7293ac1f0f48f6455572301))
* **format:** withLocale binds every locale-taking formatter and accepts a string ([c7e50b0](https://github.com/HansKristoffer/hanzio/commit/c7e50b05501b0b8fe7293ac1f0f48f6455572301))
* **i18n:** check and generate catalogs split into one file per area, and a sameValues rule ([c7e50b0](https://github.com/HansKristoffer/hanzio/commit/c7e50b05501b0b8fe7293ac1f0f48f6455572301))
* **redis:** bounded send with commandTimeoutMs, and an offlineQueue option ([c7e50b0](https://github.com/HansKristoffer/hanzio/commit/c7e50b05501b0b8fe7293ac1f0f48f6455572301))
* **secrets:** a custom loader may replace Infisical next to Infisical options ([c7e50b0](https://github.com/HansKristoffer/hanzio/commit/c7e50b05501b0b8fe7293ac1f0f48f6455572301))
* **secrets:** an Infisical set without a projectId fails when it is declared, even when env overrides supply every key ([c7e50b0](https://github.com/HansKristoffer/hanzio/commit/c7e50b05501b0b8fe7293ac1f0f48f6455572301))
* **secrets:** import getViteDefine, viteSecretSetPlugin and readPublicConfig from hanzio/secrets/vite ([c7e50b0](https://github.com/HansKristoffer/hanzio/commit/c7e50b05501b0b8fe7293ac1f0f48f6455572301))
* **secrets:** Infisical errors name the field, env keys or project scope to fix ([c7e50b0](https://github.com/HansKristoffer/hanzio/commit/c7e50b05501b0b8fe7293ac1f0f48f6455572301))
* **secrets:** optional keys, read with optional(key) ([c7e50b0](https://github.com/HansKristoffer/hanzio/commit/c7e50b05501b0b8fe7293ac1f0f48f6455572301))
* **secrets:** the default "Loaded secrets" line is written to stderr ([c7e50b0](https://github.com/HansKristoffer/hanzio/commit/c7e50b05501b0b8fe7293ac1f0f48f6455572301))
* **state:** stateTransitions is optional, and createStateMachine adds sourcesFor and sourcesForAction ([c7e50b0](https://github.com/HansKristoffer/hanzio/commit/c7e50b05501b0b8fe7293ac1f0f48f6455572301))
* **testing:** mockCallArg throws for a missing call or argument ([c7e50b0](https://github.com/HansKristoffer/hanzio/commit/c7e50b05501b0b8fe7293ac1f0f48f6455572301))
* **testing:** ModuleMocker.mock throws for an export the module does not have, and gains replace() ([c7e50b0](https://github.com/HansKristoffer/hanzio/commit/c7e50b05501b0b8fe7293ac1f0f48f6455572301))


### Bug Fixes

* **api-wrapper:** timeoutMs covers the response body, and a retried response's body is cancelled ([c7e50b0](https://github.com/HansKristoffer/hanzio/commit/c7e50b05501b0b8fe7293ac1f0f48f6455572301))
* **promise:** backgroundPromise routes a synchronous throw to onError ([c7e50b0](https://github.com/HansKristoffer/hanzio/commit/c7e50b05501b0b8fe7293ac1f0f48f6455572301))
* **secrets:** one Infisical CLI read at a time, with a lock, a 5 s timeout and a login hint ([c7e50b0](https://github.com/HansKristoffer/hanzio/commit/c7e50b05501b0b8fe7293ac1f0f48f6455572301))
* **typedswitch:** rows with a union-valued key get typed handlers, and type checks run faster ([#38](https://github.com/HansKristoffer/hanzio/issues/38)) ([0e179df](https://github.com/HansKristoffer/hanzio/commit/0e179dff6692556c129842601cc1eb04e9ee8cce))


### Performance Improvements

* **iso:** countryCodes no longer keeps the country table in bundles that do not use it ([c7e50b0](https://github.com/HansKristoffer/hanzio/commit/c7e50b05501b0b8fe7293ac1f0f48f6455572301))

## [3.4.0](https://github.com/HansKristoffer/hanzio/compare/v3.3.0...v3.4.0) (2026-11-03)


### Features

* **secrets:** retry Infisical through short network outages at startup ([#34](https://github.com/HansKristoffer/hanzio/issues/34)) ([5b2ad1c](https://github.com/HansKristoffer/hanzio/commit/5b2ad1cda7ff7d4874a079e66a692eb754dcc30c))
* **typedswitch:** null and undefined cases ([#32](https://github.com/HansKristoffer/hanzio/issues/32)) ([d4565e1](https://github.com/HansKristoffer/hanzio/commit/d4565e14e42f0d886bae11bb01991172591d0952))

## [3.3.0](https://github.com/HansKristoffer/hanzio/compare/v3.2.0...v3.3.0) (2026-10-21)


### Features

* **cli:** default commands, error and help hooks, positional globals and more flag shapes ([#27](https://github.com/HansKristoffer/hanzio/issues/27)) ([366a065](https://github.com/HansKristoffer/hanzio/commit/366a065de821fbbe5494b39471effb58bf6059bd))

## [3.2.0](https://github.com/HansKristoffer/hanzio/compare/v3.1.1...v3.2.0) (2026-10-21)


### Features

* annotated typedSwitch results keep literals, hanzio-i18n runs under Node, formatDate takes Intl options ([#24](https://github.com/HansKristoffer/hanzio/issues/24)) ([9982793](https://github.com/HansKristoffer/hanzio/commit/99827934297de4d2bdd99b0dadc291f0eb954f1b))

## [3.1.1](https://github.com/HansKristoffer/hanzio/compare/v3.1.0...v3.1.1) (2026-10-21)


### Bug Fixes

* **cli:** suggest the built-in completion command on a typo ([#22](https://github.com/HansKristoffer/hanzio/issues/22)) ([a6d749a](https://github.com/HansKristoffer/hanzio/commit/a6d749a097602b15b9c5e886845fc01b37f2977e))

## [3.1.0](https://github.com/HansKristoffer/hanzio/compare/v3.0.0...v3.1.0) (2026-10-20)


### Features

* **i18n:** hanzio-i18n catalog checker, locale and framework setup, date/price/phone formatters and ISO data ([#19](https://github.com/HansKristoffer/hanzio/issues/19)) ([57fdd13](https://github.com/HansKristoffer/hanzio/commit/57fdd13d7efe5dd9662d6540302781f672b5d197))
* **secrets:** read a machine identity file when no client credentials are set ([#17](https://github.com/HansKristoffer/hanzio/issues/17)) ([b6a4735](https://github.com/HansKristoffer/hanzio/commit/b6a47354a0d5c673744c2a2acc0e409957aa6096))

## [3.0.0](https://github.com/HansKristoffer/hanzio/compare/v2.2.0...v3.0.0) (2026-10-11)


### ⚠ BREAKING CHANGES

* **typedswitch:** the typedSwitch Constraint type argument is removed, so annotate the result instead. Case keys that are not values of the switched union are now a type error.

### Features

* **typedswitch:** grouped cases, number/boolean values and stricter case checks ([4f64921](https://github.com/HansKristoffer/hanzio/commit/4f649219b0f25e8535f3b98f8c169c36426a656d))

## [2.2.0](https://github.com/HansKristoffer/hanzio/compare/v2.1.0...v2.2.0) (2026-10-03)


### Features

* **connect:** expose response headers and endpoint checks ([#12](https://github.com/HansKristoffer/hanzio/issues/12)) ([ca7fd5d](https://github.com/HansKristoffer/hanzio/commit/ca7fd5d61e18ddd270f3d1a05f94681a1ae5747f))

## [2.1.0](https://github.com/HansKristoffer/hanzio/compare/v2.0.0...v2.1.0) (2026-10-01)


### Features

* **secrets:** support explicit loading and public build configuration ([#8](https://github.com/HansKristoffer/hanzio/issues/8)) ([4d50937](https://github.com/HansKristoffer/hanzio/commit/4d50937e72403b877d3619d71dbb5c0c013cf17f))

## [2.0.0](https://github.com/HansKristoffer/hanzio/compare/v1.3.0...v2.0.0) (2026-09-28)


### ⚠ BREAKING CHANGES

* expand utility exports and split runtime entrypoints ([#6](https://github.com/HansKristoffer/hanzio/issues/6))

### Features

* expand utility exports and split runtime entrypoints ([#6](https://github.com/HansKristoffer/hanzio/issues/6)) ([ac11863](https://github.com/HansKristoffer/hanzio/commit/ac1186340229875b61a917b8ec588064077012d1))

## [1.3.0](https://github.com/HansKristoffer/hanzio/compare/v1.2.0...v1.3.0) (2026-09-08)


### Features

* release on merge ([86eb330](https://github.com/HansKristoffer/hanzio/commit/86eb3308ef8a44cebc334783a46b8b10e0200364))
