import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createEngine } from "../lib/engine.js";
import {
  captureWarnings,
  cleanup,
  makeProject,
  readOutput,
} from "./helpers.js";

after(cleanup);

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const PAGE = `<html><head><title>Home</title></head><body><drop capsule="box"></drop></body></html>`;

const BASE = {
  "src/pages/index.html": PAGE,
  "src/capsules/box/box.html": "<div class='box'></div>",
  "src/styles/variables.css": ":root{}",
};

function hook(body) {
  return { "src/capsules/box/build.js": body };
}

// Runs this repo's build.js against a scratch project, as `npm run build` would
async function runBuildScript(files) {
  const { root } = await makeProject({
    ...files,
    "package.json": JSON.stringify({ type: "module" }),
  });
  await fs.mkdir(path.join(root, "lib"));
  await fs.copyFile(path.join(REPO, "build.js"), path.join(root, "build.js"));
  await fs.copyFile(
    path.join(REPO, "lib", "engine.js"),
    path.join(root, "lib", "engine.js")
  );
  const run = spawnSync(process.execPath, ["build.js"], {
    cwd: root,
    encoding: "utf-8",
    timeout: 20000,
  });
  return { root, ...run };
}

test("a relative root still lets hooks write into public/", async () => {
  const { root } = await makeProject({
    ...BASE,
    ...hook(
      "export async function build({ writeOutput }) { await writeOutput('x.txt', 'ok'); }"
    ),
  });
  const engine = createEngine({ root: path.relative(process.cwd(), root) });
  assert.equal(engine.paths.root, root);
  await engine.build();
  assert.equal(await readOutput(root, "x.txt"), "ok");
});

test("writeOutput refuses a sibling that shares the public prefix", async () => {
  const { engine } = await makeProject({
    ...BASE,
    ...hook(
      "export async function build({ writeOutput }) { await writeOutput('../public-other/x.txt', 'x'); }"
    ),
  });
  await assert.rejects(() => engine.build(), /resolves outside public\//);
});

test("an absolute og:image is kept as is", async () => {
  const { engine } = await makeProject();
  const page = "<html><head><title>T</title></head><body></body></html>";
  const tagFor = (image) =>
    /og:image" content="([^"]*)"/.exec(
      engine.injectSocialTags(
        page,
        { meta: { title: "T", siteUrl: "https://ex.com/", image } },
        "index.html"
      )
    )[1];

  assert.equal(tagFor("https://cdn.x/og.png"), "https://cdn.x/og.png");
  assert.equal(tagFor("HTTP://cdn.x/og.png"), "HTTP://cdn.x/og.png");
  assert.equal(tagFor("//cdn.x/og.png"), "//cdn.x/og.png");
  assert.equal(tagFor("./images/og.png"), "https://ex.com/images/og.png");
  assert.equal(tagFor("/images/og.png"), "https://ex.com/images/og.png");
});

test("the engine names the hook a build is waiting on", async () => {
  const { engine } = await makeProject({
    ...BASE,
    ...hook(
      "export let release; export function build() { return new Promise((r) => { release = r; }); }"
    ),
  });
  const building = engine.build();
  while (engine.runningHook === null) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(engine.runningHook, "box");
  const mod = await import(
    pathToFileURL(path.join(engine.paths.capsules, "box", "build.js")).href
  );
  mod.release();
  await building;
  assert.equal(engine.runningHook, null);
});

test("build.js fails when a hook never settles, naming the capsule", async () => {
  const run = await runBuildScript({
    ...BASE,
    ...hook("export function build() { return new Promise(() => {}); }"),
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /capsule "box"/);
  assert.match(run.stderr, /never settled/);
});

test("build.js reports an ordinary build error without a stack", async () => {
  const run = await runBuildScript({
    "src/pages/index.html":
      "<html><head></head><body><drop capsule='nope'></drop></body></html>",
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Capsule "nope" not found on page index\.html/);
  assert.doesNotMatch(run.stderr, /^\s+at /m);
});

test("build.js keeps the stack for an unexpected error", async () => {
  const run = await runBuildScript({
    ...BASE,
    ...hook("export function build() { null.boom(); }"),
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /^\s+at /m);
});

test("build.js exits cleanly after a good build", async () => {
  const run = await runBuildScript(BASE);
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stderr, /never/);
});

test("a build.js with only a default export says build must be named", async () => {
  const { engine } = await makeProject({
    ...BASE,
    ...hook("export default function build() {}"),
  });
  const { warnings } = await captureWarnings(() => engine.build());
  assert.match(
    warnings.join("\n"),
    /capsule "box".*a named export "build" is required/i
  );
});

test("hooks see pages in sorted order", async () => {
  const drops = '<drop capsule="box"></drop>'.repeat(3000);
  const { engine } = await makeProject({
    ...BASE,
    "src/pages/a.html": `<html><head></head><body>${drops}</body></html>`,
    "src/pages/m/b.html": PAGE,
    "src/pages/z.html": PAGE,
    ...hook(
      "export async function build({ pages, writeOutput }) { await writeOutput('order.txt', Object.keys(pages).join(',')); }"
    ),
  });
  await engine.build();
  const order = await readOutput(engine.paths.root, "order.txt");
  assert.equal(order, "a.html,index.html,m/b.html,z.html");
});

test("a later step overwriting hook output says so", async () => {
  const { root, engine } = await makeProject({
    ...BASE,
    "src/config.json": JSON.stringify({
      meta: { title: "T", siteUrl: "https://ex.com" },
    }),
    "src/static/robots.txt": "static",
    ...hook(`export async function build({ writeOutput }) {
      await writeOutput('styles.css', 'hook');
      await writeOutput('sitemap.xml', 'hook');
      await writeOutput('robots.txt', 'hook');
      await writeOutput('feed.xml', 'hook');
    }`),
  });
  const { warnings } = await captureWarnings(() => engine.build());
  const text = warnings.join("\n");
  assert.match(text, /styles\.css.*capsule "box"/);
  assert.match(text, /sitemap\.xml.*capsule "box"/);
  assert.match(text, /robots\.txt overwrites/);
  assert.doesNotMatch(text, /feed\.xml/);
  assert.equal(await readOutput(root, "feed.xml"), "hook");
});

test("a page that fails to expand leaves the last build in place", async () => {
  const { root, engine } = await makeProject(BASE);
  await engine.build();
  await fs.writeFile(
    path.join(root, "src/pages/index.html"),
    "<html><head></head><body><drop capsule='box'></body></html>"
  );
  await assert.rejects(() => engine.build(), /Unclosed <drop>/);
  assert.match(await readOutput(root, "index.html"), /class='box'/);
  await fs.access(path.join(root, "public", "styles.css"));
});

test("captureWarnings waits for an async function", async () => {
  const { result, warnings } = await captureWarnings(async () => {
    await new Promise((r) => setTimeout(r, 1));
    console.warn("late");
    return 7;
  });
  assert.equal(result, 7);
  assert.deepEqual(warnings, ["late"]);
});

test("a protocol-relative IndieWeb href is not prefixed with siteUrl", async () => {
  const { engine } = await makeProject();
  const html = engine.injectResources(
    "<html><head><title>T</title></head><body></body></html>",
    "",
    {
      meta: { title: "T", siteUrl: "https://ex.com" },
      indieweb: { feed: "//cdn.example/feed", feeds: [{ href: "/rss.xml" }] },
    },
    "index.html"
  );
  assert.match(html, /rel="feed" href="\/\/cdn\.example\/feed"/);
  assert.match(html, /rel="alternate" href="https:\/\/ex\.com\/rss\.xml"/);
});
