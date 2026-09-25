# Contributing

Thanks for looking. GachaKit is small on purpose, and the bar for new dependencies is high.

## Getting set up

```bash
npm install
npm run build     # writes public/
npm run dev       # build, then serve public/
```

## Before opening a pull request

```bash
npm run lint
npx prettier --check .
npm test
```

CI runs those three, builds, then installs the packed tarball into a consumer project and builds that. All of it has to pass.

## What a change should look like

- **Engine changes need a test.** `test/` uses Node's built-in runner and builds scratch projects in a temp directory. Add the case that fails before your fix.
- **Keep the file header convention.** One line at the top of each file saying what it does, described in the README.
- **Capsules are self-contained.** Markup, styles and scripts live in the capsule folder, class names are specific to the capsule, and anything a user needs to know goes in that capsule's README.
- **Comments explain what the code cannot.** Skip the ones that restate the line below.
- Prettier settings are checked in. Do not fight them.

## Reporting a bug

Include the page or capsule markup that triggers it and what the build produced. A failing test case is even better.
