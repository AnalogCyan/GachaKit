# Changelog

Notable changes to GachaKit. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] - 2026-09-25

First release, a beta.

### Added

- The build engine, `lib/engine.js`: `<drop>` expansion with slots and `data-*` placeholders, nested pages, cache-busted bundles, head injection for fonts, meta, social and IndieWeb tags, a sitemap, and capsule build hooks
- `config.json` blocks: `fonts`, `externalResources`, `meta` with `siteUrl` and `cleanUrls`, `styles.order`, `scripts.standalone`, `indieweb`
- Eight capsules: `button-array`, `buttons`, `card-list`, `footer`, `gradient-background`, `header`, `page-header`, `photo-card`
- A starter site, design tokens using `light-dark()`, and NASA public-domain sample photos
- `createEngine({ root })`, so another site can install the package and compose the build steps itself
- A test suite on `node --test`, and CI that lints, tests, builds, and installs the packed tarball into a consumer project
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` and `SECURITY.md`

[Unreleased]: https://github.com/AnalogCyan/GachaKit/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/AnalogCyan/GachaKit/releases/tag/v0.1.0
