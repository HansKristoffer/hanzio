# Changelog

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
