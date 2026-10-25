#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const testDir = join(rootDir, "tests");
const files = readdirSync(testDir)
  .filter((name) => /\.test\.(?:ts|mjs)$/u.test(name))
  .sort()
  .map((name) => relative(rootDir, join(testDir, name)));

if (files.length === 0) {
  console.error("No Node test files were found.");
  process.exit(1);
}

console.log(`Discovered ${files.length} Node test files.`);
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], {
  cwd: rootDir,
  stdio: "inherit",
  shell: false,
});
if (result.error !== undefined) {
  console.error(`Node tests could not start: ${result.error.message}`);
  process.exit(1);
}
process.exitCode = result.status === 0 ? 0 : 1;
