import assert from "node:assert/strict";
import test, { after } from "node:test";
import { cleanup, makeProject, readOutput } from "./helpers.js";

after(cleanup);

const page = (head, body = "") =>
  `<html><head>${head}</head><body>${body}</body></html>`;

async function inject(html, config, pageName = "index.html") {
  const { engine } = await makeProject();
  return engine.injectResources(html, "", config, pageName);
}

const count = (html, pattern) => (html.match(pattern) || []).length;

test("a canonical with href first is the page's own", async () => {
  const html = await inject(
    page('<link href="https://ex.com/own" rel="canonical">'),
    { meta: { title: "Site", siteUrl: "https://e.com" } }
  );
  assert.equal(count(html, /canonical/g), 1);
  assert.match(html, /https:\/\/ex.com\/own/);
});

test("an unquoted, uppercase canonical is the page's own", async () => {
  const html = await inject(page("<LINK HREF=/own REL=Canonical>"), {
    meta: { title: "Site", siteUrl: "https://e.com" },
  });
  assert.equal(count(html, /canonical/gi), 1);
});

test("a title with attributes is the page's own", async () => {
  const html = await inject(page('<title id="t">Mine</title>'), {
    meta: { title: "Site" },
  });
  assert.equal(count(html, /<title/g), 1);
  assert.match(html, /<meta property="og:title" content="Mine" \/>/);
});

test("an empty title with attributes is filled and keeps them", async () => {
  const html = await inject(page('<title id="t"></title>'), {
    meta: { title: "Site" },
  });
  assert.match(html, /<title id="t">Site<\/title>/);
  assert.equal(count(html, /<title/g), 1);
});

test("an SVG title in the body is not the page title", async () => {
  const html = await inject(page("", "<svg><title>Icon</title></svg>"), {
    meta: { title: "Site" },
  });
  const head = html.slice(0, html.indexOf("</head>"));
  assert.match(head, /<title>Site<\/title>/);
  assert.match(html, /<meta property="og:title" content="Site" \/>/);
  assert.match(html, /<svg><title>Icon<\/title><\/svg>/);
});

test("a page's own description and author win over config", async () => {
  const html = await inject(
    page(
      '<meta name="description" content="mine"><meta content="me" name="author">'
    ),
    { meta: { title: "Site", description: "site", author: "cfg" } }
  );
  assert.equal(count(html, /name="description"/g), 1);
  assert.equal(count(html, /name="author"/g), 1);
  assert.match(html, /<meta name="description" content="mine">/);
  assert.match(html, /<meta content="me" name="author">/);
  assert.doesNotMatch(html, /content="site"|content="cfg"/);
  assert.match(html, /<meta property="og:description" content="mine" \/>/);
});

test("an empty description or author is filled from config", async () => {
  const html = await inject(
    page('<meta name="description" content=""><meta name=author content=" ">'),
    { meta: { title: "Site", description: "site", author: "cfg" } }
  );
  assert.match(html, /<meta name="description" content="site" \/>/);
  assert.match(html, /<meta name="author" content="cfg" \/>/);
  assert.equal(count(html, /name="?description/g), 1);
  assert.equal(count(html, /name="?author/g), 1);
});

test("a commented-out og tag does not suppress the social tags", async () => {
  const html = await inject(
    page('<title>T</title><!-- <meta property="og:title" content="old"> -->'),
    { meta: { title: "Site" } }
  );
  assert.match(html, /<meta property="og:title" content="T" \/>/);
});

test("commented-out canonical, title and description do not count", async () => {
  const html = await inject(
    page(
      '<!-- <link rel="canonical" href="/old"> <title>Old</title> <meta name="description" content="old"> -->'
    ),
    {
      meta: { title: "Site", description: "new", siteUrl: "https://e.com" },
    }
  );
  assert.match(html, /<link rel="canonical" href="https:\/\/e.com\/" \/>/);
  assert.match(html, /<title>Site<\/title>/);
  assert.match(html, /<meta name="description" content="new" \/>/);
  assert.match(html, /<meta property="og:title" content="Site" \/>/);
  assert.match(html, /<!-- <link rel="canonical" href="\/old">/);
});

test("a <!-- in a head script or style is text, not a comment", async () => {
  const head = `
    <script>const s = "<!--";</script>
    <style>/* <!-- */</style>
  `;
  const html = await inject(page(head), {
    meta: { title: "Site", siteUrl: "https://e.com" },
  });
  assert.match(html, /<title>Site<\/title>/);
  assert.match(html, /<meta property="og:title" content="Site" \/>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/e.com\/" \/>/);
  assert.ok(html.includes(head));
});

test("an unquoted og property counts as present", async () => {
  const html = await inject(
    page("<title>T</title><meta property=og:title content=Mine>"),
    { meta: { title: "Site", description: "d" } }
  );
  assert.equal(count(html, /og:title/g), 1);
  assert.doesNotMatch(html, /og:type/);
});

test("a font name cannot close its comment", async () => {
  const { engine } = await makeProject();
  const html = engine.generateResourcesHTML({
    fonts: { primary: { name: "A --> <b>x</b>", url: "https://f.com/a" } },
  });
  assert.doesNotMatch(html, /<b>/);
  assert.equal(count(html, /<!--/g), count(html, /-->/g));
});

test("an external resource key cannot close its comment", async () => {
  const { engine } = await makeProject();
  const html = engine.generateResourcesHTML({
    externalResources: {
      "k --> <b>x</b>": { type: "script", url: "https://cdn.jsdelivr.net/a" },
      "j --!> <i>y</i>": {
        type: "stylesheet",
        url: "https://cdn.jsdelivr.net/b",
      },
    },
  });
  assert.doesNotMatch(html, /<b>|<i>/);
  assert.equal(count(html, /<!--/g), count(html, /-->/g));
});

test("a quote or backslash in the font name stays inside the CSS string", async () => {
  const { engine } = await makeProject({
    "src/styles/variables.css": ":root{--font-base: serif;}",
  });
  const css = await engine.renderVariablesCSS({
    fonts: { primary: { name: 'A"B\\C\nD' } },
  });
  assert.match(css, /--font-base: "A\\"B\\\\C\\a D", system-ui/);
});

test("siteUrl is escaped in canonical, og:url and the sitemap", async () => {
  const siteUrl = 'https://e.com/?a="x"&b=<y>';
  const html = await inject(page("<title>T</title>"), {
    meta: { title: "Site", siteUrl },
  });
  const escaped = "https://e.com/?a=&quot;x&quot;&amp;b=&lt;y&gt;/";
  assert.ok(html.includes(`<link rel="canonical" href="${escaped}" />`));
  assert.ok(html.includes(`<meta property="og:url" content="${escaped}" />`));

  const { root, engine } = await makeProject({
    "src/config.json": JSON.stringify({ meta: { title: "T", siteUrl } }),
    "src/pages/index.html": page("<title>T</title>"),
  });
  await engine.build();
  const xml = await readOutput(root, "sitemap.xml");
  assert.ok(xml.includes(`<loc>${escaped}</loc>`));
});

test("head checks stay linear on unterminated tags", async () => {
  const config = {
    meta: {
      title: "Site",
      description: "d",
      author: "a",
      siteUrl: "https://e.com",
    },
  };
  for (const run of [
    "<meta ",
    "<link ",
    "<title ",
    "<!--",
    "<title>",
    "<script ",
    "<script>",
  ]) {
    const html = page(run.repeat(120_000 / run.length));
    const start = performance.now();
    await inject(html, config);
    const ms = performance.now() - start;
    // about 40 ms alone; the old quadratic regexes took seconds, and the
    // suite runs files in parallel
    assert.ok(ms < 1000, `${JSON.stringify(run)} run took ${Math.round(ms)}ms`);
  }
});

test("injected head lines are indented and carry no trailing whitespace", async () => {
  const { root, engine } = await makeProject({
    "src/config.json": JSON.stringify({
      fonts: { primary: { name: "N", url: "https://f.com/n" } },
      meta: {
        title: "Site",
        description: "d",
        author: "a",
        image: "og.png",
        siteUrl: "https://e.com",
      },
    }),
    "src/pages/index.html": `<!doctype html>
<html>
  <head>
    <title>Home</title>

    <!-- EXTERNAL_RESOURCES -->

    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body></body>
</html>
`,
  });
  await engine.build();
  const html = await readOutput(root, "index.html");
  const lines = html.split("\n");
  assert.deepEqual(
    lines.filter((line) => /\s$/.test(line)),
    []
  );
  const head = lines.slice(
    lines.indexOf("  <head>") + 1,
    lines.indexOf("  </head>")
  );
  assert.ok(head.length > 10);
  for (const line of head.filter(Boolean)) {
    assert.match(line, /^ {4}</, `bad indent: ${JSON.stringify(line)}`);
  }
});

test("a one-line head gets its tags on their own lines", async () => {
  const html = await inject(page("<title>T</title>"), {
    meta: { title: "Site", description: "d" },
  });
  assert.deepEqual(
    html.split("\n").filter((line) => /\s$/.test(line)),
    []
  );
  assert.match(html, /\n {2}<meta name="description" content="d" \/>\n/);
});

test("a <!-- that is not a comment does not hide </head>", async () => {
  const config = { meta: { title: "Site", siteUrl: "https://e.com" } };
  for (const head of [
    '<meta name="keywords" content="<!--">',
    "<title>a <!-- b</title>",
    '<script>const s = "<!--";</script>',
  ]) {
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      const html = await inject(page(head), config);
      assert.match(html, /property="og:title"/, head);
      assert.match(html, /rel="canonical"/, head);
    } finally {
      console.warn = original;
    }
    assert.deepEqual(warnings, [], head);
  }
});
