import assert from "node:assert/strict";
import test, { after } from "node:test";
import { capsule, cleanup, makeProject } from "./helpers.js";

after(cleanup);

async function expand(html, capsules, files = {}) {
  const { engine } = await makeProject({ ...capsules, ...files });
  const loaded = await engine.loadCapsules();
  return engine.expandAllDrops(html, loaded, "test.html", new Set());
}

test("a data attribute may contain a closing angle bracket", async () => {
  const html = await expand(
    '<drop capsule="box" data-title="a > b"></drop>',
    capsule("box", "<div>{{title}}</div>")
  );
  assert.equal(html, "<div>a &gt; b</div>");
});

test("slot content keeps its own drops for the next pass", async () => {
  const html = await expand(
    '<drop capsule="box"><drop capsule="inner"></drop></drop>',
    {
      ...capsule("box", "<div>{{slot}}</div>"),
      ...capsule("inner", "<b>i</b>"),
    }
  );
  assert.equal(html, "<div><b>i</b></div>");
});

test("a drop with no children clears the slot", async () => {
  const html = await expand(
    '<drop capsule="box"></drop>',
    capsule("box", "<div>{{slot}}</div>")
  );
  assert.equal(html, "<div></div>");
});

test("a self-closing drop expands", async () => {
  const html = await expand(
    '<drop capsule="box" />',
    capsule("box", "<div>ok</div>")
  );
  assert.equal(html, "<div>ok</div>");
});

test("an empty data value renders as empty, not as a dropped attribute", async () => {
  const html = await expand(
    '<drop capsule="box" data-title=""></drop>',
    capsule("box", '<div title="{{title}}">x</div>')
  );
  assert.equal(html, '<div title="">x</div>');
});

test("a placeholder with no value drops its whole attribute", async () => {
  const html = await expand(
    '<drop capsule="box"></drop>',
    capsule("box", '<div title="{{title}}">x</div>')
  );
  assert.equal(html, "<div>x</div>");
});

test("data values are escaped so they cannot break out of the markup", async () => {
  const html = await expand(
    `<drop capsule="box" data-title='" onload="alert(1)'></drop>`,
    capsule("box", '<div title="{{title}}"></div>')
  );
  assert.equal(html, '<div title="&quot; onload=&quot;alert(1)"></div>');
});

test("text that merely starts with <drop is left alone", async () => {
  const html = await expand(
    "<dropdown>menu</dropdown>",
    capsule("box", "<div></div>")
  );
  assert.equal(html, "<dropdown>menu</dropdown>");
});

test("a missing capsule fails the build", async () => {
  await assert.rejects(
    () => expand('<drop capsule="nope"></drop>', capsule("box", "<div></div>")),
    /Capsule "nope" not found on page test.html/
  );
});

test("an unclosed drop fails the build", async () => {
  await assert.rejects(
    () => expand('<drop capsule="box">', capsule("box", "<div>{{slot}}</div>")),
    /Unclosed <drop> tag on page test.html/
  );
});

test("circular capsules fail rather than silently shipping drop tags", async () => {
  await assert.rejects(
    () =>
      expand('<drop capsule="a"></drop>', {
        ...capsule("a", '<drop capsule="b"></drop>'),
        ...capsule("b", '<drop capsule="a"></drop>'),
      }),
    /circular capsule references/
  );
});

test("expansion reports every capsule it used, nested ones included", async () => {
  const { engine } = await makeProject({
    ...capsule("outer", '<div><drop capsule="inner"></drop></div>'),
    ...capsule("inner", "<b>i</b>"),
  });
  const capsules = await engine.loadCapsules();
  const used = new Set();
  await engine.expandAllDrops(
    '<drop capsule="outer"></drop>',
    capsules,
    "test.html",
    used
  );
  assert.deepEqual([...used].sort(), ["inner", "outer"]);
});
