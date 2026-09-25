# Security Policy

## Supported Versions

GachaKit is developed on `main`. Fixes land there and go out in the next tagged
release; older tags are not patched.

## Reporting a Vulnerability

Report privately rather than opening an issue:

- Email <security@thayn.me>
- Or open a [private advisory](https://github.com/AnalogCyan/GachaKit/security/advisories/new)

Include the version or commit, what an attacker can do, and a page or capsule
that reproduces it. Expect a first reply within a week.

## Scope

GachaKit is a build tool: it reads `src/` and writes static files to `public/`.
The interesting failures are ones where build inputs escape into places they
should not.

In scope:

- A page, capsule or `config.json` value that injects markup or script into the
  built HTML rather than being escaped as text
- A capsule build hook writing outside `public/`
- A path in `src/` that reads or writes files outside the project root

Out of scope:

- Anything a site author can already do by writing the HTML directly. Pages and
  capsules are trusted input, so a capsule that embeds a `<script>` on purpose is
  working as intended
- The sample site under `src/`, which is demo content
- Vulnerabilities in devDependencies that do not affect a build
