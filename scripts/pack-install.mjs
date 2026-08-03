// One-shot update path (M5): packs the current checkout as a real npm tarball and reinstalls it
// globally, mirroring testFlow-tests' `refresh-tflw`. Never touches the npm registry — the
// tarball is packed and installed locally, then discarded. This is an alternative to the symlink
// install documented in the README/CLAUDE.md: a real global install (files copied into npm's
// global store) rather than a link back into this checkout, so it survives the checkout moving —
// handy after a `git pull` when you just want the globally-installed `wikilink-graph` refreshed.
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wikilink-graph-pack-"));

try {
  console.log(`Packing wikilink-graph from ${ROOT} ...`);
  const packOutput = execSync(`npm pack --pack-destination "${tmpDir}"`, {
    cwd: ROOT,
    encoding: "utf8",
  });
  const tarballName = packOutput.trim().split("\n").pop();
  const tarballPath = path.join(tmpDir, tarballName);
  console.log(`Packed ${tarballName}`);

  console.log("Installing globally...");
  execSync(`npm install -g "${tarballPath}"`, { stdio: "inherit" });

  console.log(`Done. wikilink-graph installed globally from ${tarballName}.`);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
