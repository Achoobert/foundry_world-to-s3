# World to S3

Foundry VTT v14 module. Copies every image a world uses from `worlds/...` to your S3 bucket, names each file after where it is used, and points all documents at the new S3 URL. After that you can delete old worlds without losing their art.

## What it does

- Looks at every world document (journals and pages, scenes and their tiles/tokens/notes, actors and their items, items, tables, playlists, cards, macros, users) and every world compendium. Unlocked module compendiums too (setting).
- Finds image paths that start with `worlds/`, in plain fields and inside HTML (`<img src>`). This includes images from **other** worlds. `modules/` and `systems/` paths are left alone.
- Uploads each file once to `{folder}/{source world id}/`, default `assets/world_uploads/`. A file from `worlds/up-blackwater/...` goes to `assets/world_uploads/up-blackwater/`.
- Names the file `{document}_{sub document}_{original filename}`:
  - journal page: `Chaper_Four_China_china_art_9kOuVd2AFT020q6V-pages-D9jG...-image-j3akDwW7e8sZRtfw.png`
  - scene: `Shanghai_Docks_bg.png`
  - compendium: `{pack label}_{document}_..._{original}`
  - A file used in many places is named after the first one found.
- Writes a manifest JSON next to the uploads and a "World to S3 log" journal listing every move.
- Does not delete the local files.

## Use

1. Set up S3 in Foundry (`Config/aws.json`).
2. Back up the world.
3. Enable the module, go to Settings → Configure Settings → World to S3 → Open.
4. Press **Scan** and read the report. Press **Run**.

Running again is safe: anything already on S3 is no longer a `worlds/` path, so it is skipped.

If a file with the same name is already in the S3 folder (another world uploaded it from a shared compendium or journal), it is not uploaded again. Documents are pointed at the existing URL.

## Dev

```sh
cp fvtt.config.example.js fvtt.config.js   # fill in
npm install
npm run watch        # copies into {userDataPath}/Data/modules/world-to-s3
npm run test:e2e     # Cypress runs the Quench batches in testWorldName
```

Quench tests use a fake uploader, so they never touch S3.
