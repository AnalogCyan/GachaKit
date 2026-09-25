// Assembles the static site from modular capsules into public/
// Bound to this repo's own folder. A site that installs GachaKit calls
// createEngine({ root }) itself rather than running this file.

import path from "path";
import { fileURLToPath } from "url";
import { BuildError, createEngine } from "./lib/engine.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const engine = createEngine({ root });
let settled = false;

// A hook whose promise never settles lets the event loop drain with the
// build half done, which would otherwise exit 0
process.on("beforeExit", () => {
  if (settled) return;
  // the stderr write below can be async and fire beforeExit again
  settled = true;
  const hook = engine.runningHook;
  console.error(
    hook
      ? `❌ The build hook for capsule "${hook}" never settled. The build did not finish.`
      : "❌ The build never settled and did not finish."
  );
  process.exitCode = 1;
});

engine
  .build()
  .then(() => {
    settled = true;
  })
  .catch((err) => {
    settled = true;
    console.error(err instanceof BuildError ? `❌ ${err.message}` : err);
    process.exitCode = 1;
  });
