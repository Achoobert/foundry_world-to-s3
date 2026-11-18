// Copy the module into Foundry's user data folder. --watch keeps copying on save.
import { cpSync, mkdirSync, watch } from "node:fs";
import { join, resolve } from "node:path";
import developmentOptions from "../fvtt.config.js";

const root = resolve(import.meta.dirname, "..");
const { userDataPath } = developmentOptions;
if (!userDataPath || userDataPath.includes("YOUR_USERNAME")) {
  console.error("Set userDataPath in fvtt.config.js (copy fvtt.config.example.js).");
  process.exit(1);
}
const dest = join(userDataPath, "Data", "modules", "world-to-s3");
const items = ["module.json", "scripts", "README.md"];

function copy() {
  mkdirSync(dest, { recursive: true });
  for (const item of items) cpSync(join(root, item), join(dest, item), { recursive: true });
  console.log(`Copied to ${dest}`);
}

copy();
if (process.argv.includes("--watch")) {
  for (const item of items) watch(join(root, item), { recursive: true }, copy);
}
