import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { buildCapsuleLab } from "../tools/capsule-lab.js";
import { captureWarnings } from "./helpers.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "gachakit-lab-"));
after(() => fs.rm(root, { recursive: true, force: true }));

const repo = path.resolve(import.meta.dirname, "..");
const pagesDir = path.join(repo, "test", "fixtures", "capsule-lab", "pages");
const PAGES = (await fs.readdir(pagesDir, { recursive: true })).filter((p) =>
  p.endsWith(".html")
);
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, "");

test("the capsule lab builds every page with no warnings", async () => {
  const { result: out, warnings } = await captureWarnings(() =>
    buildCapsuleLab(root)
  );
  assert.deepEqual(warnings, []);

  for (const page of PAGES) {
    const html = await fs.readFile(path.join(out, page), "utf-8");
    // Drops left on purpose sit inside comments or escaped in <pre>
    assert.doesNotMatch(
      stripComments(html),
      /<drop\b/,
      `${page} has an unexpanded drop`
    );
  }
});

test("the lab uses every capsule at least once", async () => {
  const capsules = await fs.readdir(path.join(repo, "src", "capsules"));
  const pages = await Promise.all(
    PAGES.map((p) => fs.readFile(path.join(pagesDir, p), "utf-8"))
  );
  const used = new Set(
    stripComments(pages.join("\n"))
      .matchAll(/<drop capsule="([^"]+)"/g)
      .map((m) => m[1])
  );
  assert.deepEqual(
    capsules.filter((c) => !used.has(c)),
    []
  );
});
