import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DEV_VERSION, getVersion } from "../tools/version.js";

async function repo() {
  const cwd = await mkdtemp(path.join(tmpdir(), "version-test-"));
  const git = (args, date) =>
    execFileSync("git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
        ...(date && { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }),
      },
    });
  git(["init", "-q", "-b", "main"]);
  const commit = (date) =>
    git(["commit", "-q", "--allow-empty", "-m", "c"], date);
  return { cwd, git, commit };
}

const env = {};

test("counts main's commits on HEAD's UTC day", async (t) => {
  const { cwd, commit } = await repo();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  commit("2026-11-11T23:30:00Z");
  commit("2026-11-12T01:00:00Z");
  assert.equal(getVersion({ cwd, env }).version, "0.20261112.1");
  // 23:30 on the 12th in UTC-5 is the 13th in UTC
  commit("2026-11-12T10:00:00Z");
  commit("2026-11-12T23:30:00-05:00");
  assert.equal(getVersion({ cwd, env }).version, "0.20261113.1");
  commit("2026-11-13T06:00:00Z");
  assert.equal(getVersion({ cwd, env }).version, "0.20261113.2");
});

test("anything but a clean production build of main is dev", async (t) => {
  const { cwd, git, commit } = await repo();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(path.join(cwd, "f"), "a");
  git(["add", "f"]);
  commit("2026-11-12T01:00:00Z");
  const head = getVersion({ cwd, env });
  assert.equal(head.version, "0.20261112.1");
  assert.match(head.commit, /^[0-9a-f]{40}$/);

  assert.equal(
    getVersion({ cwd, env: { CONTEXT: "deploy-preview" } }).version,
    DEV_VERSION
  );
  assert.equal(
    getVersion({ cwd, env: { BRANCH: "feat/x" } }).version,
    DEV_VERSION
  );
  assert.equal(
    getVersion({ cwd, env: { CONTEXT: "production", BRANCH: "main" } }).version,
    "0.20261112.1"
  );
  await writeFile(path.join(cwd, "f"), "b");
  assert.equal(getVersion({ cwd, env }).version, DEV_VERSION);
});

test("a folder without git builds as dev", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "version-test-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  t.mock.method(console, "warn", () => {});
  assert.deepEqual(getVersion({ cwd, env: { COMMIT_REF: "abc" } }), {
    version: DEV_VERSION,
    commit: "abc",
  });
});
