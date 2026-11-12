<p align="center">
  <img src="https://raw.githubusercontent.com/AnalogCyan/GachaKit/main/src/static/media/logo.svg" alt="" width="128" />
</p>

<h1 align="center">GachaKit</h1>

> [!WARNING]
> **GachaKit is in beta.** It works, but it's still being refined; expect things to change between releases and some rough edges. Feedback, bug reports, and fixes welcome.

**GachaKit** is a static site generator that dispenses modular UI Capsules into your layout like little drops of joy.

Plain HTML, CSS and JavaScript with a small Node build step in front. The engine has no runtime dependencies. A capsule is a folder with its own markup, styles and script; a page pulls it in with a `<drop>` tag, and every page that drops it updates on the next build. The starter set is styled Liquid Glass x Material Expressive.

**You don't have to use GachaKit like I do.** This is my own opinionated setup, shared as it is. Keep the engine and throw out every capsule, or keep the capsules and change every token. Remix it into whatever suits _your_ web dev needs.

## Quick start

Needs Node 24 or newer.

```bash
git clone https://github.com/AnalogCyan/GachaKit.git
cd GachaKit
npm install
npm run dev
```

That builds the starter site into `public/` and serves it. Edit `src/pages/index.html`, run `npm run build`, reload.

```
src/
├── pages/        # One .html per page. The only required folder
├── capsules/     # Reusable components
├── styles/       # Global CSS, bundled into styles.css
├── scripts/      # Global JS, bundled into scripts.js
├── data/         # Copied to public/data
├── images/       # Copied to public/images
├── static/       # Copied verbatim
└── config.json   # Fonts, externals, metadata
```

## How it works

A page drops capsules in. `data-*` attributes fill `{{key}}` placeholders in the capsule's markup, and wrapped content lands at `{{slot}}`:

```html
<drop capsule="gradient-background" data-animated="true"></drop>
<drop capsule="header">
  <li class="nav-pill__item">
    <a href="/" class="nav-pill__link" data-nav="home">Home</a>
  </li>
</drop>
<drop capsule="footer" />
```

Slots take full HTML and may contain drops of their own. A placeholder with no matching attribute drops the attribute when it is the whole value, and is emptied otherwise. Values are escaped. Drops inside comments, `<script>`, `<style>`, `<pre>` and `<code>` are left as text. A missing capsule, an unclosed drop, a stray `</drop>`, or a capsule that drops itself fails the build.

A build expands every drop, adds the fonts, meta, social and IndieWeb tags from `config.json` to each page's `<head>`, runs any capsule build hooks, bundles the global styles and scripts plus those of the capsules in use, copies `data/`, `images/` and `static/`, and writes `sitemap.xml` when `meta.siteUrl` is set. Bundle links get `?v=<hash>` for cache busting. Pages may sit in subdirectories.

A page template looks like this. The `<!-- EXTERNAL_RESOURCES -->` comment is where fonts and externals land.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Built with GachaKit</title>
    <script src="/scripts/theme-init.js"></script>
    <!-- EXTERNAL_RESOURCES -->
    <link rel="stylesheet" href="/styles.css" />
    <script src="/scripts.js" defer></script>
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    <drop capsule="gradient-background" data-animated="true"></drop>
    <drop capsule="page-header" data-nav-page="home">
      <li class="nav-pill__item">
        <a href="/" class="nav-pill__link" data-nav="home">Home</a>
      </li>
    </drop>
    <main class="container" id="main">
      <h1>Built with GachaKit</h1>
    </main>
    <drop capsule="footer"><p>Made with GachaKit</p></drop>
  </body>
</html>
```

## Using GachaKit from your own site

The package is the engine only. Copy the capsules and styles you want into your own `src/`.

```bash
npm install github:AnalogCyan/GachaKit#v0.1.0
```

```js
// build.js in your own site
import { createEngine } from "gachakit";

const gk = createEngine({ root: process.cwd() });
await gk.build();
```

### Composing the steps yourself

Call the steps `build()` runs, and add your own between them. This is the full list.

```js
const gk = createEngine({ root: process.cwd() });
const config = await gk.loadConfig();
config.buildHash = await gk.generateHash();

await gk.cleanPublic();
const capsules = await gk.loadCapsules();
const used = new Set();
const { pagesMap } = await gk.buildPages(capsules, config, used);
await gk.runCapsuleBuildScripts(capsules, pagesMap, config);

await yourOwnBlogStep(capsules, config, used); // whatever your site needs

await gk.bundleStyles(
  capsules,
  used,
  await gk.renderVariablesCSS(config),
  config
);
await gk.bundleScripts(used, capsules, config);
await gk.copyDataFiles();
await gk.copyImageFiles();
await gk.writeSitemap(config, Object.keys(pagesMap));
await gk.copyStaticFiles();
```

`used` is the set of capsules your pages dropped, so the bundles include only those. For HTML your own step produces, `gk.expandAllDrops`, `gk.injectResources` and `gk.bustAssetPaths` do what the page build does. `injectResources` adds every head tag, given the HTML from `gk.generateResourcesHTML(config)`. `gk.paths` has the resolved directories.

### Capsule build hooks

A capsule may ship a `build.js`. Its `build` export runs after pages are expanded and before bundling, whether or not a page used the capsule. `pages` maps page paths to built HTML, `capsuleConfig` is `config.capsules.<name>`, and `writeOutput` writes under `public/` only. A hook that throws fails the build.

```js
// src/capsules/feed/build.js
export async function build({
  capsuleName,
  capsuleConfig,
  pages,
  writeOutput,
}) {
  const list = Object.keys(pages)
    .map((page) => `<li>${page}</li>`)
    .join("");
  await writeOutput("feed.html", `<ul>${list}</ul>`);
}
```

## Capsules

Each has a README with its slots and attributes. The starter's icons are [Remix Icon](https://remixicon.com), loaded through `externalResources`.

| Capsule                                                             | What it is                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------ |
| [`button-array`](src/capsules/button-array/README.md)               | Connected-pill button rows. CSS only                         |
| [`buttons`](src/capsules/buttons/README.md)                         | 88x31 web badge wall                                         |
| [`card-list`](src/capsules/card-list/README.md)                     | Glass card stacks that lift on hover. CSS only               |
| [`footer`](src/capsules/footer/README.md)                           | Site footer, content via slot                                |
| [`gradient-background`](src/capsules/gradient-background/README.md) | Drifting gradient with grain overlay                         |
| [`header`](src/capsules/header/README.md)                           | Nav pill with theme toggle and mobile menu                   |
| [`page-header`](src/capsules/page-header/README.md)                 | Header landmark that centers the nav pill                    |
| [`photo-card`](src/capsules/photo-card/README.md)                   | Polaroid photo cards with a detail modal and fullscreen view |

A capsule lives in `src/capsules/<name>/` as `<name>.html`, `<name>.css`, an optional `<name>.js`, an optional `build.js` and a README. Capsule CSS is concatenated as written, so keep class names specific to the capsule; capsule JS is wrapped in its own scope. Each file opens with one line saying what it does, nothing more.

## Configuration

`src/config.json`:

```json
{
  "fonts": { "primary": { "name": "Nunito", "url": "https://..." } },
  "externalResources": {
    "remixIcons": { "url": "https://...", "type": "stylesheet" }
  },
  "meta": {
    "title": "GachaKit",
    "description": "...",
    "author": "Cyan",
    "image": "./media/og-image.png",
    "siteUrl": "",
    "cleanUrls": false
  },
  "styles": { "order": ["variables.css", "reset.css", "base.css"] },
  "scripts": { "standalone": ["theme-init.js"] },
  "indieweb": {
    "relMe": ["https://github.com/you"],
    "webmention": "https://webmention.io/example.com/webmention",
    "pingback": "https://webmention.io/example.com/xmlrpc",
    "feed": "/blog/",
    "feeds": [
      { "type": "application/rss+xml", "title": "RSS", "href": "/feed.xml" }
    ]
  }
}
```

- `fonts.primary.name` becomes the `--font-base` token. `externalResources` entries become `<link>` or `<script>` tags by `type`, `"stylesheet"` or `"script"`
- `meta.title`, `description` and `author` fill a page's tags only when the page has none. `image` goes on every page
- `meta.siteUrl` turns on the sitemap, the canonical link and absolute `og:url`; empty, those are skipped. `meta.cleanUrls` drops `.html` from them for hosts that serve `about.html` at `/about`
- `styles.order` sets bundle order; the rest of `src/styles/` follows alphabetically. `scripts.standalone` names scripts copied to `public/scripts/` instead of bundled, for anything that must run before the bundle
- `indieweb` adds `rel="me"`, `rel="webmention"`, `rel="pingback"`, `rel="feed"` and `rel="alternate"` links. Empty fields are skipped. Feeds themselves are yours to generate; `404.html` gets no canonical

## Design language

Tokens live in `src/styles/variables.css` and use `light-dark()` (Chrome and Edge 123, Firefox 120, Safari 17.5), so one value serves both themes: `--text`, `--text-muted`, `--page-bg`, `--bg-main`, `--accent`, `--accent-secondary`, the `--glass-*` set, `--radius-sm` to `--radius-xl`, `--shadow-soft` to `--shadow-xl`, and the `--container-*` bounds the header sizes the column within. `reset.css` is Modern Normalize plus Josh's Reset; `base.css` holds typography, `.glass`, `.button` and the skip link; `home.css` is the landing page only.

The look: layered gradients over `var(--bg-main)` with `backdrop-filter: blur(18px) saturate(160%)`, soft shadows, big radii, a grain overlay at `opacity: 0.04`, sliding pill indicators, Nunito at `1rem` / `1.7`.

Influences:

- Apple's Liquid Glass
- Google's Material Expressive
- Analog nostalgia and soft-glass futurism
- Experimental UI like [Juxtopposed](https://www.youtube.com/@juxtopposed)

Motion uses `cubic-bezier(0.22, 1, 0.36, 1)` for arrivals, 200 to 500ms, transform and opacity only. The photo modal's flight and fullscreen view are the exceptions. Everything stops under `prefers-reduced-motion`; the gradient keeps its blur and only stops drifting.

## Accessibility

Skip links on the starter pages, `aria-current` on the active nav link, a mobile menu that closes on Escape, a photo modal and fullscreen view that are labelled dialogs with focus trapped and returned, `:focus-visible` outlines, light-theme accents that pass WCAG AA, and `prefers-reduced-motion` honoured throughout.

## Tests and CI

```bash
npm test          # node --test "test/*.test.js"
npm run lint
npx prettier --check .
```

CI runs those, builds, then packs the package and builds a consumer project from the tarball.

The starter site on Netlify writes `/version.json` with its version and commit (`tools/version.js`, not part of the package). A clean build of main is `0.YYYYMMDD.N`, from the UTC day of the commit and N counting main's commits that day, and a CI workflow tags it `site/v0.YYYYMMDD.N`; anything else is `0.0.0-dev`. The package itself keeps SemVer.

## License

Code is [GNU AGPL v3](LICENSE), which also covers sites built with GachaKit that are deployed publicly. Sample copy under `src/` is [CC BY-SA 4.0](LICENSE-CONTENT). The sample photos in `src/images/` are NASA photographs in the public domain. Remix Icon (Apache 2.0) and Nunito (SIL OFL 1.1) load from CDNs.

Built with softness, structure, and a hint of shimmer.
Cyan
