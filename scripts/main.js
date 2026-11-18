import { WorldToS3App } from "./app.js";
import { MODULE_ID } from "./migrate.js";
import { registerTests } from "./tests.js";

Hooks.once("init", () => {
  game.settings.registerMenu(MODULE_ID, "menu", {
    name: "World to S3",
    label: "Open",
    hint: "Copy world images to S3 and relink them.",
    icon: "fa-solid fa-cloud-arrow-up",
    type: WorldToS3App,
    restricted: true,
  });
  game.settings.register(MODULE_ID, "bucket", {
    name: "S3 bucket",
    hint: "Blank = first bucket in Foundry's S3 config.",
    scope: "world",
    config: true,
    type: String,
    default: "",
  });
  game.settings.register(MODULE_ID, "prefix", {
    name: "S3 folder",
    hint: "Files go to {folder}/{source world id}/.",
    scope: "world",
    config: true,
    type: String,
    default: "assets/world_uploads",
  });
  game.settings.register(MODULE_ID, "includeModulePacks", {
    name: "Include unlocked module compendiums",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
});

Hooks.on("quenchReady", registerTests);
