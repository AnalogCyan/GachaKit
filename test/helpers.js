// Scratch projects for the engine tests: a temp root with the files a case needs

import fs from "fs/promises";
import os from "os";
import path from "path";
import { createEngine } from "../lib/engine.js";

const roots = [];

export async function makeProject(files = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gachakit-test-"));
  roots.push(root);

  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(root, ...relPath.split("/"));
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
  }

  return { root, engine: createEngine({ root }) };
}

export async function cleanup() {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
}

export function readOutput(root, relPath) {
  return fs.readFile(path.join(root, "public", ...relPath.split("/")), "utf-8");
}

// Captures console.warn so a test can assert on what the build reported.
// An async run returns a promise and captures until it settles.
export function captureWarnings(run) {
  const original = console.warn;
  const restore = () => {
    console.warn = original;
  };
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(" "));

  let result;
  try {
    result = run();
  } catch (err) {
    restore();
    throw err;
  }
  if (result instanceof Promise) {
    return result
      .then((value) => ({ result: value, warnings }))
      .finally(restore);
  }
  restore();
  return { result, warnings };
}

export function capsule(name, html) {
  return { [`src/capsules/${name}/${name}.html`]: html };
}
