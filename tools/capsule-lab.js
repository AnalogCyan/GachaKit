// Builds the capsule lab: the pages in test/fixtures/capsule-lab, rendered
// with this repo's capsules, styles, scripts and images.
// Usage: node tools/capsule-lab.js   (builds into .capsule-lab/)

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine } from "../lib/engine.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(repo, "test", "fixtures", "capsule-lab");
const shared = [
  "capsules",
  "styles",
  "scripts",
  "images",
  "static/media/logo.svg",
];

export async function buildCapsuleLab(root) {
  const src = path.join(root, "src");
  await fs.rm(src, { recursive: true, force: true });
  await fs.cp(fixture, src, { recursive: true });
  for (const part of shared) {
    await fs.cp(path.join(repo, "src", part), path.join(src, part), {
      recursive: true,
    });
  }
  await createEngine({ root }).build();
  return path.join(root, "public");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildCapsuleLab(path.join(repo, ".capsule-lab")).then(
    (dir) => console.log(`Capsule lab built in ${dir}`),
    (err) => {
      console.error(err);
      process.exitCode = 1;
    }
  );
}
