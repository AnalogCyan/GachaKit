// One case per bug found in audit, so none of them come back

import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  capsule,
  captureWarnings,
  cleanup,
  makeProject,
  readOutput,
} from "./helpers.js";

after(cleanup);

async function expand(html, capsules) {
  const { engine } = await makeProject(capsules);
  const loaded = await engine.loadCapsules();
  return engine.expandAllDrops(html, loaded, "test.html", new Set());
}

const page = (head) => `<html><head>${head}</head><body></body></html>`;

test("a $ in config text is not read as a replacement pattern", async () => {
  const { engine } = await makeProject();
  const html = engine.injectResources(page("<title>T</title>"), "", {
    meta: { title: "T", description: "Save $5 $& more", author: "a$`b" },
  });
  assert.match(html, /content="Save \$5 \$&amp; more"/);
  assert.match(html, /content="a\$`b"/);
  assert.equal(html.match(/<\/head>/g).length, 1);
});

test("a $ in the font name survives into the CSS variables", async () => {
  const { engine } = await makeProject({
    "src/styles/variables.css": ":root{--font-base: serif;}",
  });
  const css = await engine.renderVariablesCSS({
    fonts: { primary: { name: "A$&B" } },
  });
  assert.match(css, /--font-base: "A\$&B"/);
});

test("a quote in the page title cannot break the og:title attribute", async () => {
  const { engine } = await makeProject();
  const html = engine.injectResources(page('<title>He said "hi"</title>'), "", {
    meta: { title: "Site" },
  });
  assert.match(
    html,
    /<meta property="og:title" content="He said &quot;hi&quot;" \/>/
  );
});

test("og tags are detected wherever the property attribute sits", async () => {
  const { engine } = await makeProject();
  const html = engine.injectResources(
    page('<title>T</title><meta content="Mine" property="og:title" />'),
    "",
    { meta: { title: "Site" } }
  );
  assert.equal(html.match(/property="og:title"/g).length, 1);
});

test("an uppercase DROP tag expands like any other", async () => {
  const html = await expand(
    '<DROP capsule="box"></DROP>',
    capsule("box", "<div>ok</div>")
  );
  assert.equal(html, "<div>ok</div>");
});

test("a closing tag with trailing space still closes the drop", async () => {
  const html = await expand(
    '<drop capsule="box">in</drop >',
    capsule("box", "<div>{{slot}}</div>")
  );
  assert.equal(html, "<div>in</div>");
});

test("a capsule that drops itself fails instead of shipping the tag", async () => {
  await assert.rejects(
    () =>
      expand(
        '<drop capsule="loop"></drop>',
        capsule("loop", '<drop capsule="loop"></drop>')
      ),
    /made no progress/
  );
});

test("a capsule that drops itself twice fails on size, not on a V8 error", async () => {
  await assert.rejects(
    () =>
      expand(
        '<drop capsule="fan"></drop>',
        capsule(
          "fan",
          '<i><drop capsule="fan"></drop><drop capsule="fan"></drop></i>'
        )
      ),
    /doubles the page every pass/
  );
});

test("drops inside comments, pre, code, script and style are left as text", async () => {
  const input =
    '<!-- <drop capsule="box"></drop> -->' +
    '<pre><drop capsule="box"></drop></pre>' +
    '<code><drop capsule="box"></drop></code>' +
    "<script>var x = \"<drop capsule='box'></drop>\";</script>" +
    "<style>/* <drop capsule='box'></drop> */</style>";
  const html = await expand(input, capsule("box", "<b>E</b>"));
  assert.equal(html, input);
  assert.doesNotMatch(html, /<b>E<\/b>/);
});

test("an entity in a data value is not escaped a second time", async () => {
  const html = await expand(
    '<drop capsule="box" data-t="Tom &amp; Jerry"></drop>',
    capsule("box", "<p>{{t}}</p>")
  );
  assert.equal(html, "<p>Tom &amp; Jerry</p>");
});

test("a placeholder the author wrote inside a slot is left alone", async () => {
  const html = await expand(
    '<drop capsule="box">{{literal}}</drop>',
    capsule("box", "<i>{{slot}}</i>")
  );
  assert.equal(html, "<i>{{literal}}</i>");
});

test("a data value cannot reach placeholders in the slot", async () => {
  const html = await expand(
    '<drop capsule="box" data-t="LEAKED">{{t}}</drop>',
    capsule("box", "<i>{{slot}}</i>")
  );
  assert.equal(html, "<i>{{t}}</i>");
});

test("{{ slot }} with spaces is a slot", async () => {
  const html = await expand(
    '<drop capsule="box">in</drop>',
    capsule("box", "<i>{{ slot }}</i>")
  );
  assert.equal(html, "<i>in</i>");
});

test("an unset placeholder drops a single-quoted attribute too", async () => {
  const html = await expand(
    '<drop capsule="box"></drop>',
    capsule("box", "<div title='{{t}}'>x</div>")
  );
  assert.equal(html, "<div>x</div>");
});

test("an empty capsule file is a capsule, not a missing one", async () => {
  const html = await expand(
    '<drop capsule="css-only"></drop>',
    capsule("css-only", "")
  );
  assert.equal(html, "");
});

test("errors name the page, without the pass counter", async () => {
  await assert.rejects(
    () => expand('<drop capsule="nope"></drop>', capsule("box", "<i></i>")),
    /not found on page test\.html$/
  );
});

test("standalone scripts are cache-busted like the bundles", async () => {
  const { engine } = await makeProject();
  const html = engine.bustAssetPaths(
    '<script src="./scripts/theme-init.js"></script>',
    "abc123",
    ["theme-init.js"]
  );
  assert.match(html, /src="\.\/scripts\/theme-init\.js\?v=abc123"/);
});

test("extra stylesheets are bundled alphabetically", async () => {
  const { root, engine } = await makeProject({
    "src/pages/index.html":
      "<html><head><title>T</title></head><body></body></html>",
    "src/styles/variables.css": ":root{}",
    "src/styles/zebra.css": ".z{}",
    "src/styles/alpha.css": ".a{}",
    "src/styles/mid.css": ".m{}",
  });
  await engine.build();

  const css = await readOutput(root, "styles.css");
  assert.ok(css.indexOf("alpha.css") < css.indexOf("mid.css"));
  assert.ok(css.indexOf("mid.css") < css.indexOf("zebra.css"));
});

test("a static file that overwrites generated output says so", async () => {
  const { root, engine } = await makeProject({
    "src/pages/index.html":
      "<html><head><title>T</title></head><body></body></html>",
    "src/styles/variables.css": ":root{}",
    "src/static/styles.css": "/* mine */",
  });

  const { warnings } = await captureWarnings(() => engine.build());

  assert.match(warnings.join("\n"), /styles\.css overwrites a file/);
  assert.equal(await readOutput(root, "styles.css"), "/* mine */");
});

test("the build hash notices a renamed file, not just an edited one", async () => {
  const first = await makeProject({ "src/styles/a.css": ".x{}" });
  const second = await makeProject({ "src/styles/b.css": ".x{}" });
  assert.notEqual(
    await second.engine.generateHash(),
    await first.engine.generateHash()
  );
});

test("the resources placeholder is replaced with the configured externals", async () => {
  const { root, engine } = await makeProject({
    "src/config.json": JSON.stringify({
      meta: { title: "T" },
      fonts: { primary: { name: "Nunito", url: "https://f.com/css?a=1&b=2" } },
      externalResources: {
        icons: {
          type: "stylesheet",
          url: "https://cdn.jsdelivr.net/icons.css",
        },
      },
    }),
    "src/pages/index.html":
      "<html><head><!-- EXTERNAL_RESOURCES --><title>T</title></head><body></body></html>",
  });
  await engine.build();

  const html = await readOutput(root, "index.html");
  assert.match(
    html,
    /href="https:\/\/f.com\/css\?a=1&amp;b=2" rel="stylesheet"/
  );
  assert.match(html, /href="https:\/\/cdn.jsdelivr.net\/icons.css"/);
  assert.doesNotMatch(html, /EXTERNAL_RESOURCES/);
});

test("the configured font lands in the CSS variables", async () => {
  const { root, engine } = await makeProject({
    "src/config.json": JSON.stringify({
      meta: { title: "T" },
      fonts: { primary: { name: "Nunito" } },
    }),
    "src/pages/index.html":
      "<html><head><title>T</title></head><body></body></html>",
    "src/styles/variables.css": ":root{\n  --font-base: serif;\n}",
  });
  await engine.build();
  assert.match(await readOutput(root, "styles.css"), /--font-base: "Nunito"/);
});

test("a rebuild clears output that is no longer generated", async () => {
  const { root, engine } = await makeProject({
    "src/pages/index.html":
      "<html><head><title>T</title></head><body></body></html>",
    "src/pages/gone.html":
      "<html><head><title>G</title></head><body></body></html>",
  });
  await engine.build();
  await readOutput(root, "gone.html");

  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await fs.rm(path.join(root, "src", "pages", "gone.html"));
  await engine.build();

  await assert.rejects(() => readOutput(root, "gone.html"));
});

test("an unused capsule's script stays out of the bundle", async () => {
  const { root, engine } = await makeProject({
    "src/pages/index.html":
      '<html><head><title>T</title></head><body><drop capsule="used"></drop></body></html>',
    "src/capsules/used/used.html": "<i></i>",
    "src/capsules/used/used.js": "const used = 1;",
    "src/capsules/spare/spare.html": "<b></b>",
    "src/capsules/spare/spare.js": "const spare = 1;",
  });
  await engine.build();

  const bundle = await readOutput(root, "scripts.js");
  assert.match(bundle, /const used = 1;/);
  assert.doesNotMatch(bundle, /const spare = 1;/);
});

test(".DS_Store is not published", async () => {
  const { root, engine } = await makeProject({
    "src/pages/index.html":
      "<html><head><title>T</title></head><body></body></html>",
    "src/static/robots.txt": "User-agent: *",
    "src/static/.DS_Store": "junk",
    "src/static/media/.DS_Store": "junk",
    "src/data/photos.json": "[]",
    "src/data/.DS_Store": "junk",
    "src/images/shot.jpg": "binary",
    "src/images/.DS_Store": "junk",
  });
  await engine.build();

  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await assert.rejects(() => fs.stat(path.join(root, "public", ".DS_Store")));
  await assert.rejects(() =>
    fs.stat(path.join(root, "public", "media", ".DS_Store"))
  );
  await assert.rejects(() =>
    fs.stat(path.join(root, "public", "data", ".DS_Store"))
  );
  await assert.rejects(() =>
    fs.stat(path.join(root, "public", "images", ".DS_Store"))
  );
  assert.equal(await readOutput(root, "robots.txt"), "User-agent: *");
  assert.equal(await readOutput(root, "data/photos.json"), "[]");
  assert.equal(await readOutput(root, "images/shot.jpg"), "binary");
});

test("a data value cannot break out of a single-quoted attribute", async () => {
  const html = await expand(
    `<drop capsule="pic" data-img="a.png' onerror='alert(1)"></drop>`,
    capsule("pic", "<img src='{{img}}' alt='' />")
  );
  assert.doesNotMatch(html, /onerror='alert/);
  assert.match(html, /src='a\.png&#39; onerror=&#39;alert\(1\)'/);
});

test("a title with an apostrophe is escaped into og:title", async () => {
  const { engine } = await makeProject();
  const out = engine.injectResources(page("<title>Cyan's Blog</title>"), "", {
    meta: { title: "Site" },
  });
  assert.match(out, /property="og:title" content="Cyan&#39;s Blog"/);
});
