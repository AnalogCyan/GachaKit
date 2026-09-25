import assert from "node:assert/strict";
import test, { after } from "node:test";
import { capsule, cleanup, makeProject } from "./helpers.js";

after(cleanup);

async function expand(html, capsules, files = {}) {
  const { engine } = await makeProject({ ...capsules, ...files });
  const loaded = await engine.loadCapsules();
  return engine.expandAllDrops(html, loaded, "test.html", new Set());
}

test("a </drop> inside code in a slot does not close the drop", async () => {
  const html = await expand(
    '<drop capsule="w"><code>&lt;/drop&gt; literal </drop> text</code></drop>',
    capsule("w", "<div class=w>{{slot}}</div>")
  );
  assert.equal(
    html,
    "<div class=w><code>&lt;/drop&gt; literal </drop> text</code></div>"
  );
});

test("a <drop inside a comment in a slot is not counted as nested", async () => {
  const html = await expand(
    '<drop capsule="w"><!-- <drop capsule="w"> --></drop>',
    capsule("w", "<div>{{slot}}</div>")
  );
  assert.equal(html, '<div><!-- <drop capsule="w"> --></div>');
});

test("a custom element named like code is not a protected region", async () => {
  const html = await expand(
    '<code-block>x</code-block><drop capsule="w"></drop><p>mid</p><code>c</code>',
    capsule("w", "<div>w</div>")
  );
  assert.equal(
    html,
    "<code-block>x</code-block><div>w</div><p>mid</p><code>c</code>"
  );
});

test("custom elements named like pre, script and style are not protected", async () => {
  for (const tag of ["pre", "script", "style"]) {
    const html = await expand(
      `<${tag}-x>x</${tag}-x><drop capsule="w"></drop><${tag}>c</${tag}>`,
      capsule("w", "<div>w</div>")
    );
    assert.equal(html, `<${tag}-x>x</${tag}-x><div>w</div><${tag}>c</${tag}>`);
  }
});

test("unquoted attribute values on a drop are read", async () => {
  const html = await expand(
    "<drop capsule=box data-count=3 data-label=a&amp;b></drop>",
    capsule("box", '<i data-n="{{count}}">{{label}}</i>')
  );
  assert.equal(html, '<i data-n="3">a&amp;b</i>');
});

test("an unquoted capsule name works on a self-closing drop", async () => {
  const html = await expand("<drop capsule=box/>", capsule("box", "<i>ok</i>"));
  assert.equal(html, "<i>ok</i>");
});

test("a stray </drop> fails the build and names the page", async () => {
  await assert.rejects(
    () => expand("<p>a</p></drop>", capsule("box", "<i></i>")),
    /Stray <\/drop> with no opening <drop> on page test\.html/
  );
  await assert.rejects(
    () =>
      expand('<drop capsule="box"></drop></drop>', capsule("box", "<i></i>")),
    /Stray <\/drop>/
  );
});

test("a </drop> inside code is not stray", async () => {
  const html = await expand(
    "<code>&lt;drop&gt;...</drop></code>",
    capsule("box", "<i></i>")
  );
  assert.equal(html, "<code>&lt;drop&gt;...</drop></code>");
});

test("a data value is inserted literally, never as a placeholder", async () => {
  const html = await expand(
    '<drop capsule="a" data-t="{{slot}}"><b>X</b></drop>',
    capsule("a", '<i title="{{t}}">{{slot}}</i>')
  );
  assert.equal(html, '<i title="{{slot}}"><b>X</b></i>');
});

test("an unset placeholder in capsule script or style empties, keeping the code valid", async () => {
  const html = await expand(
    '<drop capsule="s"></drop>',
    capsule(
      "s",
      '<div title="{{val}}"><script>let v="{{val}}";</script><style>a{content:"{{val}}"}</style></div>'
    )
  );
  assert.equal(
    html,
    '<div><script>let v="";</script><style>a{content:""}</style></div>'
  );
});

test("an unset placeholder attribute on a script tag itself is dropped", async () => {
  const html = await expand(
    '<drop capsule="s"></drop>',
    capsule("s", '<script src="{{src}}">let v="{{src}}";</script>')
  );
  assert.equal(html, '<script>let v="";</script>');
});

test("a capsule folder without its html file says so", async () => {
  await assert.rejects(
    () =>
      expand(
        '<drop capsule="x"></drop>',
        {},
        { "src/capsules/x/x.css": "i{}" }
      ),
    /src\/capsules\/x\/ has no x\.html, needed on page test\.html/
  );
});

test("drop attribute parsing stays linear", async () => {
  const start = performance.now();
  await expand(
    `<drop capsule="box" ${"data-".repeat(30000)}></drop>`,
    capsule("box", "<i></i>")
  );
  assert.ok(performance.now() - start < 1000);
});

test("unset placeholder stripping stays linear on long whitespace", async () => {
  const start = performance.now();
  await expand(
    '<drop capsule="box" data-t="a"></drop>',
    capsule("box", `<div${" ".repeat(30000)}title="{{t}}">x</div>`)
  );
  assert.ok(performance.now() - start < 1000);
});

test("markup inside a drop's own attribute values opens no protected region", async () => {
  const b = capsule("b", "<i>{{slot}}</i>");
  assert.equal(
    await expand('<drop capsule="b" data-x="<code>">s</drop><code>y</code>', b),
    "<i>s</i><code>y</code>"
  );
  assert.equal(
    await expand('<drop capsule="b" data-x="<!--">s</drop> -->', b),
    "<i>s</i> -->"
  );
});

test("a </drop> inside another tag's attribute value is text", async () => {
  const w = capsule("w", "<div>{{slot}}</div>");
  assert.equal(
    await expand('<p><a title="</drop>">x</a></p>', w),
    '<p><a title="</drop>">x</a></p>'
  );
  assert.equal(
    await expand('<drop capsule="w"><a title="</drop>">x</a></drop>', w),
    '<div><a title="</drop>">x</a></div>'
  );
});

test("a comment mentioning script does not shield later unset attributes", async () => {
  const html = await expand(
    '<drop capsule="c"></drop>',
    capsule("c", '<!-- no <script> here --><a href="{{u}}">x</a>')
  );
  assert.equal(html, "<!-- no <script> here --><a>x</a>");
});

test("a quote inside an unquoted attribute value does not hide a later drop", async () => {
  const w = capsule("w", "<b>{{slot}}</b>");
  const self = await expand(
    `<img alt=Tom's src=a.png><p>It's <drop capsule="w"/></p>`,
    w
  );
  assert.equal(self, `<img alt=Tom's src=a.png><p>It's <b></b></p>`);
  const paired = await expand(
    `<img alt=Tom's src=a.png><p><drop capsule="w">x</drop></p>`,
    w
  );
  assert.match(paired, /<b>x<\/b>/);
});

test("markup in a drop's own data value opens no protected region", async () => {
  const b = capsule("b", "<i>{{slot}}</i>");
  assert.equal(
    await expand('<drop capsule="b" data-x="<code>">s</drop><code>y</code>', b),
    "<i>s</i><code>y</code>"
  );
  assert.equal(
    await expand('<drop capsule="b" data-x="<!--">s</drop> -->', b),
    "<i>s</i> -->"
  );
});

test("a </drop> inside an ordinary attribute value is not stray", async () => {
  assert.equal(
    await expand('<a title="</drop>">t</a>', {}),
    '<a title="</drop>">t</a>'
  );
});

test("unset stripping reads tags the way HTML does", async () => {
  assert.equal(
    await expand(
      '<drop capsule="c"></drop>',
      capsule("c", '<script data-a="x>y" src="{{u}}">1</script>')
    ),
    '<script data-a="x>y">1</script>'
  );
  assert.equal(
    await expand(
      '<drop capsule="c"></drop>',
      capsule("c", '<!-- no <script> here --><a href="{{u}}">x</a>')
    ),
    "<!-- no <script> here --><a>x</a>"
  );
});

test("unclosed openers in a capsule do not make unset stripping slow", async () => {
  const started = performance.now();
  await expand(
    '<drop capsule="s"></drop>',
    capsule("s", "<script ".repeat(20000) + '<a href="{{u}}">')
  );
  assert.ok(performance.now() - started < 1000);
});

test("an unset unquoted placeholder drops its attribute without eating the next", async () => {
  const html = await expand(
    '<drop capsule="s"></drop>',
    capsule("s", '<div data-x={{x}} class="keep"></div>')
  );
  assert.equal(html, '<div class="keep"></div>');
});

test("unset placeholders drop attributes whose names have digits, _ or :", async () => {
  const html = await expand(
    '<drop capsule="s"></drop>',
    capsule("s", '<svg data-n1="{{n}}" a_b="{{n}}" xlink:href="{{n}}"></svg>')
  );
  assert.equal(html, "<svg></svg>");
});

test("data attribute names match placeholders whatever their case", async () => {
  const html = await expand(
    '<drop capsule="s" data-Title="Hi" data-other-key="2"></drop>',
    capsule("s", '<p title="{{title}}" data-k="{{Other-Key}}"></p>')
  );
  assert.equal(html, '<p title="Hi" data-k="2"></p>');
});

test("an unset placeholder at the start of an unquoted value only empties", async () => {
  const html = await expand(
    '<drop capsule="s"></drop>',
    capsule("s", '<img src={{base}}/img.png alt=""><a href={{u}}/about>x</a>')
  );
  assert.equal(html, '<img src=/img.png alt=""><a href=/about>x</a>');
});

test("unset stripping never reaches inside another attribute's value", async () => {
  const html = await expand(
    '<drop capsule="s"></drop>',
    capsule(
      "s",
      `<button onclick="let b = '{{label}}'; go(b)" title="a b={{x}} c" data-y="{{y}}">x</button>`
    )
  );
  assert.equal(
    html,
    `<button onclick="let b = ''; go(b)" title="a b= c">x</button>`
  );
});

test("the slot placeholder matches whatever its case", async () => {
  const html = await expand(
    '<drop capsule="s"><b>in</b></drop>',
    capsule("s", "<div>{{Slot}}</div>")
  );
  assert.equal(html, "<div><b>in</b></div>");
});

test("an unset unquoted placeholder before /> keeps the tag self-closing", async () => {
  const html = await expand(
    '<drop capsule="s"></drop>',
    capsule("s", "<svg><path d={{d}}/></svg><img src={{u}}/>")
  );
  assert.equal(html, "<svg><path /></svg><img />");
});

test("a quoted unset placeholder before a slash only empties", async () => {
  const html = await expand(
    '<drop capsule="s"></drop>',
    capsule("s", `<a href="{{base}}/">h</a><a class=x href='{{base}}/'>i</a>`)
  );
  assert.equal(html, `<a href="/">h</a><a class=x href='/'>i</a>`);
});

test("the kept slash stays apart from the attribute before it", async () => {
  const html = await expand(
    '<drop capsule="s"></drop>',
    capsule("s", "<img alt=x src={{u}}/>")
  );
  assert.equal(html, "<img alt=x />");
});

test("only HTML whitespace separates attributes, not U+00A0", async () => {
  const nbsp = String.fromCharCode(0xa0);
  const html = await expand(
    `<drop capsule="s" data-a="1${nbsp}data-b=2"></drop>`,
    capsule("s", `<img src={{u}}${nbsp}alt=x title={{a}}>`)
  );
  // one attribute each, as a browser reads them
  assert.equal(html, `<img src=${nbsp}alt=x title=1${nbsp}data-b=2>`);
});
