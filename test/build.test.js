import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import vm from "node:vm";
import { cleanup, makeProject, readOutput } from "./helpers.js";

after(cleanup);

const PAGE = `<html><head><!-- EXTERNAL_RESOURCES --><title>Home</title>
<link rel="stylesheet" href="./styles.css" /><script src="/scripts.js"></script>
</head><body><drop capsule="box"></drop></body></html>`;

const BASE = {
  "src/config.json": JSON.stringify({ meta: { title: "Site" } }),
  "src/pages/index.html": PAGE,
  "src/capsules/box/box.html": "<div class='box'></div>",
  "src/capsules/box/box.css": ".box{color:red}",
  "src/capsules/box/box.js": "const boxed = 1;",
  "src/styles/variables.css": ":root{--font-base: serif;}",
  "src/styles/base.css": "body{margin:0}",
};

test("a project with only pages builds", async () => {
  const { root, engine } = await makeProject({
    "src/pages/index.html":
      "<html><head><title>Bare</title></head><body></body></html>",
  });
  await engine.build();
  assert.match(await readOutput(root, "index.html"), /Bare/);
});

test("a project with no pages fails with a clear message", async () => {
  const { engine } = await makeProject({ "src/config.json": "{}" });
  await assert.rejects(() => engine.build(), /needs one page to build/);
});

test("nested pages keep their directory", async () => {
  const { root, engine } = await makeProject({
    ...BASE,
    "src/pages/notes/index.html":
      "<html><head><title>Notes</title></head><body></body></html>",
  });
  await engine.build();
  assert.match(await readOutput(root, "notes/index.html"), /Notes/);
});

test("bundles hold the global styles in order, then the capsules in use", async () => {
  const { root, engine } = await makeProject({
    ...BASE,
    "src/capsules/unused/unused.html": "<p></p>",
    "src/capsules/unused/unused.css": ".unused{}",
  });
  await engine.build();

  const css = await readOutput(root, "styles.css");
  assert.ok(css.indexOf("variables.css") < css.indexOf("base.css"));
  assert.match(css, /Capsule: box/);
  assert.doesNotMatch(css, /Capsule: unused/);
});

test("the stylesheet order is configurable", async () => {
  const { root, engine } = await makeProject({
    ...BASE,
    "src/config.json": JSON.stringify({
      meta: { title: "Site" },
      styles: { order: ["base.css", "variables.css"] },
    }),
  });
  await engine.build();

  const css = await readOutput(root, "styles.css");
  assert.ok(css.indexOf("base.css") < css.indexOf("variables.css"));
});

test("capsule scripts are wrapped so two capsules cannot collide", async () => {
  const { root, engine } = await makeProject(BASE);
  await engine.build();
  assert.match(
    await readOutput(root, "scripts.js"),
    /\(\(\) => \{\nconst boxed/
  );
});

test("a script without a final semicolon does not run into the next", async () => {
  const { root, engine } = await makeProject({
    ...BASE,
    "src/scripts/a.js": "globalThis.ran = []\nglobalThis.ran.push('a')",
    "src/scripts/b.js": "(() => globalThis.ran.push('b'))()",
    "src/capsules/box/box.js": "globalThis.ran.push('box')",
  });
  await engine.build();
  const context = {};
  vm.runInNewContext(await readOutput(root, "scripts.js"), context);
  assert.deepEqual([...context.ran], ["a", "b", "box"]);
});

test("standalone scripts are copied out of the bundle, and are configurable", async () => {
  const { root, engine } = await makeProject({
    ...BASE,
    "src/config.json": JSON.stringify({
      meta: { title: "Site" },
      scripts: { standalone: ["early.js"] },
    }),
    "src/scripts/early.js": "// early",
    "src/scripts/main.js": "// main",
  });
  await engine.build();

  const bundle = await readOutput(root, "scripts.js");
  assert.match(bundle, /main.js/);
  assert.doesNotMatch(bundle, /early.js/);
  assert.match(await readOutput(root, "scripts/early.js"), /early/);
});

test("bundle links are cache-busted however they are written", async () => {
  const { engine } = await makeProject();
  const html = engine.bustAssetPaths(
    `<link href="./styles.css"><link href='/styles.css'><script src="scripts.js">`,
    "abc123"
  );
  assert.match(html, /href="\.\/styles.css\?v=abc123"/);
  assert.match(html, /href='\/styles.css\?v=abc123'/);
  assert.match(html, /src="scripts.js\?v=abc123"/);
});

test("theme-init is cache-busted by default, as in the page build", async () => {
  const { engine } = await makeProject();
  const html = engine.bustAssetPaths(
    '<script src="/scripts/theme-init.js"></script>',
    "abc123"
  );
  assert.match(html, /src="\/scripts\/theme-init.js\?v=abc123"/);
});

test("without a build hash the links are left alone", async () => {
  const { engine } = await makeProject();
  const input = '<link href="./styles.css">';
  assert.equal(engine.bustAssetPaths(input, undefined), input);
});

test("the build hash covers config.json", async () => {
  const files = {
    ...BASE,
    "src/config.json": JSON.stringify({
      fonts: { primary: { name: "Nunito" } },
      meta: { title: "Site" },
    }),
  };
  const first = await makeProject(files);
  const before = await first.engine.generateHash();

  const second = await makeProject({
    ...files,
    "src/config.json": JSON.stringify({
      fonts: { primary: { name: "Comic Sans MS" } },
      meta: { title: "Site" },
    }),
  });
  assert.notEqual(await second.engine.generateHash(), before);
});

test("the sitemap lists pages, skips 404, and honours clean URLs", async () => {
  const { root, engine } = await makeProject({
    ...BASE,
    "src/config.json": JSON.stringify({
      meta: { title: "Site", siteUrl: "https://e.com", cleanUrls: true },
    }),
    "src/pages/about.html":
      "<html><head><title>About</title></head><body></body></html>",
    "src/pages/404.html":
      "<html><head><title>Gone</title></head><body></body></html>",
  });
  await engine.build();

  const xml = await readOutput(root, "sitemap.xml");
  assert.match(xml, /<loc>https:\/\/e.com\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/e.com\/about<\/loc>/);
  assert.doesNotMatch(xml, /404/);
});

test("static files are copied verbatim", async () => {
  const { root, engine } = await makeProject({
    ...BASE,
    "src/static/robots.txt": "User-agent: *",
    "src/static/.well-known/security.txt": "Contact: mailto:a@b.c",
  });
  await engine.build();

  assert.equal(await readOutput(root, "robots.txt"), "User-agent: *");
  assert.match(await readOutput(root, ".well-known/security.txt"), /Contact/);
});

test("a failing capsule build hook fails the build", async () => {
  const { engine } = await makeProject({
    ...BASE,
    "src/capsules/box/build.js":
      "export function build() { throw new Error('boom'); }",
  });
  await assert.rejects(
    () => engine.build(),
    /Build script for capsule "box" failed: boom/
  );
});

test("a capsule build hook cannot write outside public/", async () => {
  const { engine } = await makeProject({
    ...BASE,
    "src/capsules/box/build.js":
      "export async function build({ writeOutput }) { await writeOutput('../escaped.txt', 'x'); }",
  });
  await assert.rejects(() => engine.build(), /resolves outside public\//);
});

test("a capsule build hook writes into public/", async () => {
  const { root, engine } = await makeProject({
    ...BASE,
    "src/capsules/box/build.js":
      "export async function build({ writeOutput, pages }) { await writeOutput('feed.xml', Object.keys(pages).join(',')); }",
  });
  await engine.build();
  assert.equal(await readOutput(root, "feed.xml"), "index.html");
});

test("config.json is not published to the site", async () => {
  const { root, engine } = await makeProject(BASE);
  await engine.build();
  await assert.rejects(() => fs.stat(path.join(root, "public", "config.json")));
});

test("a missing config falls back to defaults, a malformed one fails", async () => {
  const { engine: withoutConfig } = await makeProject({
    "src/pages/index.html": PAGE,
  });
  assert.equal((await withoutConfig.loadConfig()).meta.title, "GachaKit");

  const { engine: withBadConfig } = await makeProject({
    "src/config.json": "{ oops",
  });
  await assert.rejects(
    () => withBadConfig.loadConfig(),
    /src\/config.json is not valid JSON/
  );
});
