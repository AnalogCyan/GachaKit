import assert from "node:assert/strict";
import test, { after } from "node:test";
import { captureWarnings, cleanup, makeProject } from "./helpers.js";

after(cleanup);

const page = (head) => `<html><head>${head}</head><body></body></html>`;

async function inject(html, config, pageName = "index.html") {
  const { engine } = await makeProject();
  return engine.injectResources(html, "", config, pageName);
}

test("a page keeps its own title", async () => {
  const html = await inject(page("<title>About</title>"), {
    meta: { title: "Site" },
  });
  assert.match(html, /<title>About<\/title>/);
  assert.doesNotMatch(html, /<title>Site<\/title>/);
});

test("an empty title is filled from config", async () => {
  const html = await inject(page("<title></title>"), {
    meta: { title: "Site" },
  });
  assert.match(html, /<title>Site<\/title>/);
});

test("a page with no title gets one", async () => {
  const html = await inject(page(""), { meta: { title: "Site" } });
  assert.match(html, /<title>Site<\/title>/);
});

test("description is escaped instead of breaking the tag", async () => {
  const html = await inject(page(""), {
    meta: { title: "Site", description: 'He said "hi"' },
  });
  assert.match(
    html,
    /<meta name="description" content="He said &quot;hi&quot;" \/>/
  );
});

test("an existing description is kept whatever the attribute order", async () => {
  const html = await inject(page('<meta content="old" name="description">'), {
    meta: { title: "Site", description: "new" },
  });
  assert.equal(html.match(/name="description"/g).length, 1);
  assert.match(html, /<meta content="old" name="description">/);
  assert.doesNotMatch(html, /content="new"/);
});

test("a valueless description tag still receives the configured value", async () => {
  const html = await inject(page('<meta name="description" />'), {
    meta: { title: "Site", description: "filled" },
  });
  assert.equal(html.match(/name="description"/g).length, 1);
  assert.match(html, /content="filled"/);
});

test("a page without a head is left alone, with a warning", async () => {
  const { engine } = await makeProject();
  const input = "<html><body>no head</body></html>";
  const { result, warnings } = captureWarnings(() =>
    engine.injectResources(input, "", { meta: { title: "Site" } }, "odd.html")
  );
  assert.equal(result, input);
  assert.match(warnings.join("\n"), /No <\/head> on page odd.html/);
});

test("og:title follows the page's own title", async () => {
  const html = await inject(page("<title>About</title>"), {
    meta: { title: "Site" },
  });
  assert.match(html, /<meta property="og:title" content="About" \/>/);
});

test("a page with its own og tags is left alone", async () => {
  const html = await inject(
    page('<title>About</title><meta property="og:title" content="Mine" />'),
    { meta: { title: "Site", description: "d" } }
  );
  assert.equal(html.match(/property="og:title"/g).length, 1);
  assert.match(html, /content="Mine"/);
});

test("canonical and og:url use clean URLs when configured", async () => {
  const html = await inject(
    page("<title>About</title>"),
    { meta: { title: "Site", siteUrl: "https://e.com", cleanUrls: true } },
    "about.html"
  );
  assert.match(html, /<link rel="canonical" href="https:\/\/e.com\/about" \/>/);
  assert.match(
    html,
    /<meta property="og:url" content="https:\/\/e.com\/about" \/>/
  );
});

test("a nested index page is canonical at its directory", async () => {
  const html = await inject(
    page("<title>Notes</title>"),
    { meta: { title: "Site", siteUrl: "https://e.com" } },
    "notes/index.html"
  );
  assert.match(
    html,
    /<link rel="canonical" href="https:\/\/e.com\/notes\/" \/>/
  );
});

test("404 gets neither a canonical nor an og:url", async () => {
  const html = await inject(
    page("<title>Gone</title>"),
    { meta: { title: "Site", siteUrl: "https://e.com" } },
    "404.html"
  );
  assert.doesNotMatch(html, /rel="canonical"/);
  assert.doesNotMatch(html, /og:url/);
});

test("IndieWeb links come from config", async () => {
  const html = await inject(page("<title>Home</title>"), {
    meta: { title: "Site", siteUrl: "https://e.com" },
    indieweb: {
      relMe: ["https://github.com/me"],
      webmention: "https://wm.io/e.com/webmention",
      feed: "/feed/",
      feeds: [{ type: "application/rss+xml", title: "RSS", href: "/rss.xml" }],
    },
  });
  assert.match(
    html,
    /<link rel="alternate" type="application\/rss\+xml" title="RSS" href="https:\/\/e.com\/rss.xml" \/>/
  );
  assert.match(html, /<link rel="feed" href="https:\/\/e.com\/feed\/" \/>/);
  assert.match(
    html,
    /<link rel="webmention" href="https:\/\/wm.io\/e.com\/webmention" \/>/
  );
  assert.match(html, /<link rel="me" href="https:\/\/github.com\/me" \/>/);
});

test("one preconnect per origin, taken from the configured URLs", async () => {
  const { engine } = await makeProject();
  const withFonts = engine.generateResourcesHTML({
    fonts: {
      a: { name: "A", url: "https://f.com/a" },
      b: { name: "B", url: "https://f.com/b" },
    },
  });
  assert.equal(
    withFonts.match(/rel="preconnect" href="https:\/\/f.com"/g).length,
    1
  );
  assert.doesNotMatch(withFonts, /googleapis|gstatic|cdn.jsdelivr.net/);

  const google = engine.generateResourcesHTML({
    fonts: { a: { name: "A", url: "https://fonts.googleapis.com/css2?x" } },
    externalResources: {
      icons: { type: "stylesheet", url: "https://unpkg.com/icons.css" },
      local: { type: "stylesheet", url: "/local.css" },
    },
  });
  assert.match(google, /preconnect" href="https:\/\/fonts.googleapis.com" \/>/);
  assert.match(
    google,
    /preconnect" href="https:\/\/fonts.gstatic.com" crossorigin/
  );
  assert.match(google, /preconnect" href="https:\/\/unpkg.com" crossorigin/);
  assert.equal(google.match(/rel="preconnect"/g).length, 3);

  const empty = engine.generateResourcesHTML({
    fonts: {},
    externalResources: {},
  });
  assert.equal(empty, "");
});

test("resource URLs are escaped", async () => {
  const { engine } = await makeProject();
  const html = engine.generateResourcesHTML({
    fonts: { primary: { name: "N", url: "https://f.com/css?a=1&b=2" } },
  });
  assert.match(html, /href="https:\/\/f.com\/css\?a=1&amp;b=2"/);
});

test("an external resource with an unknown type is skipped with a warning", async () => {
  const { engine } = await makeProject();
  const { result, warnings } = captureWarnings(() =>
    engine.generateResourcesHTML({
      externalResources: {
        icons: { type: "style", url: "https://cdn.example/icons.css" },
      },
    })
  );
  assert.doesNotMatch(result, /icons.css|preconnect/);
  assert.match(warnings.join("\n"), /externalResources.icons.*"stylesheet"/);
});
