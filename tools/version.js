// The build's version, 0.YYYYMMDD.N: the UTC day of HEAD's commit, and N
// counting main's commits that day. A commit keeps its version however
// often it is rebuilt, so CI can tag the same number Netlify deploys.
// Anything but a clean build of main is 0.0.0-dev.
//
//   node tools/version.js              prints the version
//   node tools/version.js <dir>        also writes <dir>/version.json

import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEV_VERSION = "0.0.0-dev";

export function getVersion({ cwd = process.cwd(), env = process.env } = {}) {
  try {
    return versionFromGit(cwd, env);
  } catch (err) {
    // No git or no repository: still build, but claim nothing
    console.warn(`Version unknown, building as dev: ${err.message}`);
    return { version: DEV_VERSION, commit: env.COMMIT_REF || "unknown" };
  }
}

function versionFromGit(cwd, env) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, TZ: "UTC" },
    }).trim();

  const commit = git("rev-parse", "HEAD");
  // Netlify and Actions check out a detached HEAD and name the branch here
  const branch =
    env.BRANCH ||
    env.GITHUB_REF_NAME ||
    git("rev-parse", "--abbrev-ref", "HEAD");
  const clean = git("status", "--porcelain", "--untracked-files=no") === "";
  const production = !env.CONTEXT || env.CONTEXT === "production";
  // A shallow clone would undercount the day's commits
  const shallow = git("rev-parse", "--is-shallow-repository") === "true";

  if (branch !== "main" || !clean || !production || shallow) {
    return { version: DEV_VERSION, commit };
  }

  const days = git(
    "log",
    "--first-parent",
    "--format=%cd",
    "--date=format-local:%Y%m%d",
    "HEAD"
  ).split("\n");
  let n = 0;
  while (n < days.length && days[n] === days[0]) n++;
  return { version: `0.${days[0]}.${n}`, commit };
}

export async function writeVersionFile(dir, options) {
  const info = getVersion(options);
  await writeFile(
    path.join(dir, "version.json"),
    JSON.stringify(info, null, 2) + "\n"
  );
  return info;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  const { version, commit } = dir ? await writeVersionFile(dir) : getVersion();
  console.log(dir ? `Version ${version}+${commit.slice(0, 8)}` : version);
}
