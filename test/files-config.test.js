// Source file discovery and config.json shape

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import {
  captureWarnings,
  cleanup,
  makeProject,
  readOutput,
} from "./helpers.js";

after(cleanup);

const page = (title, body = "") =>
  `<html><head><title>${title}</title></head><body>${body}</body></html>`;

const INDEX = { "src/pages/index.html": page("Home") };

const exists = (root, relPath) =>
  fs.stat(path.join(root, "public", ...relPath.split("/"))).then(
    () => true,
    () => false
  );

test("data and images are copied with their subdirectories", async () => {
  const { root, engine } = await makeProject({
    ...INDEX,
    "src/data/2024/list.json": "[1]",
    "src/images/2024/x.jpg": "jpg",
    "src/images/2024/trip/y.jpg": "jpg2",
  });
  await engine.build();

  assert.equal(await readOutput(root, "data/2024/list.json"), "[1]");
  assert.equal(await readOutput(root, "images/2024/x.jpg"), "jpg");
  assert.equal(await readOutput(root, "images/2024/trip/y.jpg"), "jpg2");
});

test("nested styles and scripts are bundled in sorted path order", async () => {
  const { root, engine } = await makeProject({
    ...INDEX,
    "src/styles/variables.css": ":root{}",
    "src/styles/b.css": ".b{}",
    "src/styles/a/deep.css": ".deep{}",
    "src/styles/c/z.css": ".cz{}",
    "src/scripts/main.js": "const main = 1;",
    "src/scripts/lib/util.js": "const util = 1;",
  });
  await engine.build();

  const css = await readOutput(root, "styles.css");
  const order = ["variables.css", "a/deep.css", "b.css", "c/z.css"].map((f) =>
    css.indexOf(`=== ${f} ===`)
  );
  assert.ok(
    order.every((at) => at !== -1),
    css
  );
  assert.deepEqual(
    order,
    [...order].sort((x, y) => x - y)
  );

  const js = await readOutput(root, "scripts.js");
  assert.match(js, /const util = 1;/);
  assert.ok(js.indexOf("lib/util.js") < js.indexOf("main.js"));
});

test("styles.order and scripts.standalone take nested paths", async () => {
  const { root, engine } = await makeProject({
    "src/config.json": JSON.stringify({
      styles: { order: ["vendor/first.css", "a.css"] },
      scripts: { standalone: ["vendor/early.js"] },
    }),
    "src/pages/index.html": page(
      "Home",
      '<script src="/scripts/vendor/early.js"></script>'
    ),
    "src/styles/a.css": ".a{}",
    "src/styles/vendor/first.css": ".first{}",
    "src/scripts/vendor/early.js": "// early",
    "src/scripts/main.js": "// main",
  });
  await engine.build();

  const css = await readOutput(root, "styles.css");
  assert.ok(css.indexOf("vendor/first.css") < css.indexOf("=== a.css"));
  assert.doesNotMatch(await readOutput(root, "scripts.js"), /early/);
  assert.equal(await readOutput(root, "scripts/vendor/early.js"), "// early");
  assert.match(
    await readOutput(root, "index.html"),
    /src="\/scripts\/vendor\/early\.js\?v=[0-9a-f]{8}"/
  );
});

test("the build hash covers nested bundled files and nothing else", async () => {
  const base = { "src/styles/a/x.css": ".x{}" };
  const hash = async (files) =>
    (await makeProject({ ...base, ...files })).engine.generateHash();
  const before = await hash({});

  assert.notEqual(await hash({ "src/styles/a/x.css": ".y{}" }), before);
  assert.notEqual(await hash({ "src/scripts/lib/u.js": "1" }), before);
  assert.equal(await hash({ "src/styles/notes.js": "1" }), before);
  assert.equal(await hash({ "src/scripts/._u.js": "junk" }), before);
});

test("the build hash names files with forward slashes on every platform", async () => {
  const { engine } = await makeProject({ "src/styles/a/x.css": ".x{}" });
  const expected = crypto
    .createHash("sha1")
    .update("src/styles/a/x.css")
    .update(".x{}")
    .digest("hex")
    .slice(0, 8);
  assert.equal(await engine.generateHash(), expected);
});

test("page URLs are percent-encoded and the sitemap is valid XML", async () => {
  const { root, engine } = await makeProject({
    "src/config.json": JSON.stringify({
      meta: { title: "Site", siteUrl: "https://e.com" },
    }),
    ...INDEX,
    "src/pages/a&b.html": page("AB"),
    "src/pages/my page.html": page("Mine"),
    "src/pages/café/index.html": page("Cafe"),
  });
  await engine.build();

  const xml = await readOutput(root, "sitemap.xml");
  assert.match(xml, /<loc>https:\/\/e\.com\/a%26b\.html<\/loc>/);
  assert.match(xml, /<loc>https:\/\/e\.com\/my%20page\.html<\/loc>/);
  assert.match(xml, /<loc>https:\/\/e\.com\/caf%C3%A9\/<\/loc>/);
  assert.doesNotMatch(xml, /&(?!amp;|lt;|gt;|quot;|#\d+;)/);

  const ab = await readOutput(root, "a&b.html");
  assert.match(ab, /rel="canonical" href="https:\/\/e\.com\/a%26b\.html"/);
  assert.match(ab, /property="og:url" content="https:\/\/e\.com\/a%26b\.html"/);
  assert.match(
    await readOutput(root, "my page.html"),
    /rel="canonical" href="https:\/\/e\.com\/my%20page\.html"/
  );
});

test("the sitemap escapes a site URL with an ampersand", async () => {
  const { root, engine } = await makeProject({
    "src/config.json": JSON.stringify({
      meta: { title: "Site", siteUrl: "https://e.com/?a=1&b=2" },
    }),
    ...INDEX,
  });
  await engine.build();
  assert.match(
    await readOutput(root, "sitemap.xml"),
    /<loc>https:\/\/e\.com\/\?a=1&amp;b=2\/<\/loc>/
  );
});

test("symlinks are followed for capsules, pages and copied files", async () => {
  const { root, engine } = await makeProject({
    "src/pages/index.html": page("Home", '<drop capsule="c"></drop>'),
    "elsewhere/c/c.html": "<b>linked capsule</b>",
    "elsewhere/c/c.css": ".c{}",
    "elsewhere/about.html": page("About"),
    "elsewhere/robots.txt": "User-agent: *",
    "elsewhere/list.json": "[]",
    "elsewhere/x.jpg": "jpg",
    "elsewhere/shared.css": ".shared{}",
  });
  const link = (target, at) =>
    fs.symlink(path.join(root, target), path.join(root, at));
  await fs.mkdir(path.join(root, "src/capsules"));
  await fs.mkdir(path.join(root, "src/static"));
  await fs.mkdir(path.join(root, "src/data"));
  await fs.mkdir(path.join(root, "src/images"));
  await fs.mkdir(path.join(root, "src/styles"));
  await link("elsewhere/c", "src/capsules/c");
  await link("elsewhere/about.html", "src/pages/about.html");
  await link("elsewhere/robots.txt", "src/static/robots.txt");
  await link("elsewhere/list.json", "src/data/list.json");
  await link("elsewhere/x.jpg", "src/images/x.jpg");
  await link("elsewhere/shared.css", "src/styles/shared.css");
  await engine.build();

  assert.match(await readOutput(root, "index.html"), /linked capsule/);
  assert.match(await readOutput(root, "about.html"), /About/);
  assert.equal(await readOutput(root, "robots.txt"), "User-agent: *");
  assert.equal(await readOutput(root, "data/list.json"), "[]");
  assert.equal(await readOutput(root, "images/x.jpg"), "jpg");
  const css = await readOutput(root, "styles.css");
  assert.match(css, /\.shared\{\}/);
  assert.match(css, /\.c\{\}/);
});

test("a dangling symlink is skipped with a warning naming it", async () => {
  const { root, engine } = await makeProject({
    ...INDEX,
    "src/static/robots.txt": "User-agent: *",
  });
  await fs.symlink(
    path.join(root, "missing.html"),
    path.join(root, "src/pages/gone.html")
  );
  await fs.symlink(
    path.join(root, "missing.txt"),
    path.join(root, "src/static/gone.txt")
  );

  const { warnings } = await captureWarnings(() => engine.build());

  const text = warnings.join("\n");
  assert.match(text, /src\/pages\/gone\.html/);
  assert.match(text, /src\/static\/gone\.txt/);
  assert.match(await readOutput(root, "index.html"), /Home/);
  assert.equal(await exists(root, "gone.html"), false);
});

test("a symlink loop in a copied directory is skipped, not followed forever", async () => {
  const { root, engine } = await makeProject({
    ...INDEX,
    "src/static/a/file.txt": "ok",
  });
  await fs.symlink(
    path.join(root, "src/static"),
    path.join(root, "src/static/a/loop")
  );

  const { warnings } = await captureWarnings(() => engine.build());

  assert.equal(await readOutput(root, "a/file.txt"), "ok");
  assert.match(warnings.join("\n"), /src\/static\/a\/loop/);
});

test("AppleDouble and .DS_Store files are skipped everywhere", async () => {
  const { root, engine } = await makeProject({
    ...INDEX,
    "src/pages/._index.html": "\u0000\u0005junk",
    "src/pages/.DS_Store": "junk",
    "src/styles/a.css": ".a{}",
    "src/styles/._a.css": "\u0000\u0005junk",
    "src/scripts/x.js": "const x = 1;",
    "src/scripts/._x.js": "\u0000\u0005junk",
    "src/scripts/.DS_Store": "junk",
    "src/static/robots.txt": "User-agent: *",
    "src/static/._robots.txt": "junk",
    "src/data/list.json": "[]",
    "src/data/._list.json": "junk",
    "src/images/x.jpg": "jpg",
    "src/images/sub/._x.jpg": "junk",
    "src/capsules/._box/._box.html": "junk",
  });
  await engine.build();

  assert.doesNotMatch(await readOutput(root, "scripts.js"), /junk/);
  assert.doesNotMatch(await readOutput(root, "styles.css"), /junk/);
  for (const junk of [
    "._index.html",
    ".DS_Store",
    "._robots.txt",
    "data/._list.json",
    "images/sub/._x.jpg",
  ]) {
    assert.equal(await exists(root, junk), false, junk);
  }
  assert.deepEqual(Object.keys(await engine.loadCapsules()), []);
});

test("a page with an uppercase .HTML extension is built", async () => {
  const { root, engine } = await makeProject({
    "src/config.json": JSON.stringify({
      meta: { title: "Site", siteUrl: "https://e.com", cleanUrls: true },
    }),
    ...INDEX,
    "src/pages/About.HTML": page("About"),
  });
  await engine.build();

  assert.match(await readOutput(root, "About.HTML"), /About/);
  assert.match(
    await readOutput(root, "sitemap.xml"),
    /<loc>https:\/\/e\.com\/About<\/loc>/
  );
});

test("a byte order mark is stripped from config, pages and capsules", async () => {
  const BOM = "\uFEFF";
  const { root, engine } = await makeProject({
    "src/config.json": BOM + JSON.stringify({ meta: { title: "Site" } }),
    "src/pages/index.html": BOM + page("Home", '<drop capsule="box"></drop>'),
    "src/capsules/box/box.html": BOM + "<i>box</i>",
    "src/capsules/box/box.css": BOM + ".box{}",
    "src/capsules/box/box.js": BOM + "const box = 1;",
  });
  await engine.build();

  for (const file of ["index.html", "styles.css", "scripts.js"]) {
    assert.doesNotMatch(await readOutput(root, file), /\uFEFF/, file);
  }
  assert.match(await readOutput(root, "index.html"), /^<html>/);
});

test("styles.order warns on a missing name and bundles a repeat once", async () => {
  const { root, engine } = await makeProject({
    "src/config.json": JSON.stringify({
      styles: { order: ["a.css", "nope.css", "a.css"] },
    }),
    ...INDEX,
    "src/styles/a.css": ".a{}",
  });

  const { warnings } = await captureWarnings(() => engine.build());

  assert.match(warnings.join("\n"), /styles\.order.*nope\.css/);
  const css = await readOutput(root, "styles.css");
  assert.equal(css.match(/\.a\{\}/g).length, 1);
});

test("the default style order does not warn about starter files", async () => {
  const { engine } = await makeProject({
    ...INDEX,
    "src/styles/variables.css": ":root{}",
  });
  const { warnings } = await captureWarnings(() => engine.build());
  assert.doesNotMatch(warnings.join("\n"), /styles\.order/);
});

for (const [name, config, message] of [
  [
    "relMe as a string",
    { indieweb: { relMe: "https://a.b" } },
    /indieweb\.relMe must be a list, not a string/,
  ],
  ["fonts as a string", { fonts: "x" }, /fonts must be an object/],
  [
    "externalResources as a list",
    { externalResources: [] },
    /externalResources must be an object, not a list/,
  ],
  ["meta as a number", { meta: 5 }, /meta must be an object, not a number/],
  [
    "a null feed",
    { indieweb: { feeds: [null, {}] } },
    /indieweb\.feeds\[0\] must be an object, not null/,
  ],
  [
    "styles.order as a string",
    { styles: { order: "x" } },
    /styles\.order must be a list/,
  ],
  [
    "a font that is not an object",
    { fonts: { primary: "Nunito" } },
    /fonts\.primary must be an object/,
  ],
  [
    "a numeric title",
    { meta: { title: 5 } },
    /meta\.title must be a string, not a number/,
  ],
  ["a list at the top", [], /src\/config\.json must be an object/],
]) {
  test(`config.json with ${name} fails with a clear message`, async () => {
    const { engine } = await makeProject({
      ...INDEX,
      "src/config.json": JSON.stringify(config),
    });
    await assert.rejects(() => engine.build(), message);
  });
}

test("the starter config passes validation", async () => {
  const starter = await fs.readFile(
    new URL("../src/config.json", import.meta.url),
    "utf-8"
  );
  const { engine } = await makeProject({ "src/config.json": starter });
  await engine.loadConfig();
});

test("capsule file names must match the drop exactly, and the error says so", async () => {
  const { engine } = await makeProject({
    "src/pages/index.html": page("Home", '<drop capsule="Box"></drop>'),
    "src/capsules/Box/box.html": "<i>box</i>",
  });
  await assert.rejects(
    () => engine.build(),
    /Capsule "Box" not found.*box\.html.*Box\.html/
  );
});

test("a capsule name differing only in case is pointed out", async () => {
  const { engine } = await makeProject({
    "src/pages/index.html": page("Home", '<drop capsule="box"></drop>'),
    "src/capsules/Box/Box.html": "<i>box</i>",
  });
  await assert.rejects(() => engine.build(), /Capsule "box" not found.*"Box"/);
});

test("a public/ symlink survives the build and loses stale files", async () => {
  const { root, engine } = await makeProject({
    ...INDEX,
    "out/stale.html": "old",
  });
  await fs.symlink(path.join(root, "out"), path.join(root, "public"));
  await engine.build();

  assert.ok((await fs.lstat(path.join(root, "public"))).isSymbolicLink());
  assert.match(await readOutput(root, "index.html"), /Home/);
  await assert.rejects(() => fs.stat(path.join(root, "out", "stale.html")));
});
