import { migrate, planFor } from "./migrate.js";
import { buildName, findLocalPaths, rewrite, sourceWorld } from "./scan.js";

const ORIGINAL = "9kOuVd2AFT020q6V-pages-D9jGEmjdHJB4WRUg-image-j3akDwW7e8sZRtfw.png";

export function registerTests(quench) {
  quench.registerBatch(
    "world-to-s3.scan",
    (context) => {
      const { describe, it, assert } = context;

      describe("findLocalPaths", () => {
        it("finds plain fields and HTML img src", () => {
          const found = findLocalPaths({
            img: "worlds/masks/assets/actors/a.png",
            text: '<p><img src="worlds/masks/assets/pages/b%20c.webp" width="2"><img src="/worlds/other/d.jpg"></p>',
          });
          assert.deepEqual(
            [...found].sort(),
            ["worlds/masks/assets/actors/a.png", "worlds/masks/assets/pages/b c.webp", "worlds/other/d.jpg"].sort(),
          );
        });

        it("ignores modules, systems, remote URLs and non-images", () => {
          const found = findLocalPaths({
            a: "modules/m/a.png",
            b: "systems/s/b.png",
            c: '<img src="https://bucket.s3.amazonaws.com/worlds/x/c.png">',
            d: "worlds/x/notes.txt",
          });
          assert.equal(found.size, 0);
        });

        it("keeps spaces in a whole-field path", () => {
          const found = findLocalPaths({ src: "worlds/up-blackwater/assets/My Map.jpg" });
          assert.deepEqual([...found], ["worlds/up-blackwater/assets/My Map.jpg"]);
        });
      });

      describe("rewrite", () => {
        it("swaps only mapped paths", () => {
          const map = new Map([["worlds/w/a b.png", "https://s3/a.png"]]);
          const out = rewrite(
            { x: '<img src="worlds/w/a%20b.png"><img src="worlds/w/z.png">', y: "worlds/w/a b.png" },
            map,
          );
          assert.equal(out.x, '<img src="https://s3/a.png"><img src="worlds/w/z.png">');
          assert.equal(out.y, "https://s3/a.png");
        });
      });

      describe("buildName", () => {
        it("joins doc names with the full original filename", () => {
          assert.equal(
            buildName(["Chaper Four China", "china_art"], `worlds/masks/assets/pages/${ORIGINAL}`),
            `Chaper_Four_China_china_art_${ORIGINAL}`,
          );
        });

        it("caps length without cutting the original filename", () => {
          const name = buildName(["x".repeat(400)], `worlds/w/${ORIGINAL}`);
          assert.isAtMost(name.length, 200);
          assert.isTrue(name.endsWith(ORIGINAL));
        });

        it("folder comes from the source world", () => {
          assert.equal(sourceWorld("worlds/up-blackwater/assets/a.png"), "up-blackwater");
        });
      });
    },
    { displayName: "World to S3: path helpers" },
  );

  quench.registerBatch(
    "world-to-s3.migrate",
    (context) => {
      const { describe, it, assert, before, after } = context;
      const world = game.world.id;
      const created = [];

      describe("migrate with a fake uploader", () => {
        let journal, scene;

        before(async () => {
          journal = await JournalEntry.create({
            name: "W2S3 Test Journal",
            pages: [
              { name: "Art Page", type: "image", src: `worlds/${world}/assets/pages/${ORIGINAL}` },
              {
                name: "Text Page",
                type: "text",
                text: { content: `<p><img src="worlds/other-world/assets/pages/x.webp"></p>` },
              },
            ],
          });
          scene = await Scene.create({
            name: "W2S3 Test Scene",
            background: { src: `worlds/${world}/assets/scenes/bg.png` },
            thumb: `worlds/${world}/assets/scenes/thumb.webp`,
            tiles: [{ texture: { src: `worlds/${world}/assets/tiles/t.png` }, width: 100, height: 100 }],
          });
          created.push(journal, scene);
        });

        after(async () => {
          for (const doc of created) await doc.delete();
        });

        it("uploads each file once, named and foldered as planned, and relinks docs", async () => {
          const plan = planFor([journal, scene]);
          assert.equal(plan.files.size, 4);

          const calls = [];
          const upload = async (path, name, folder) => {
            calls.push({ path, name, folder });
            return `https://fake-bucket.s3/${folder}/${name}`;
          };
          const result = await migrate(plan, { upload, list: async () => new Map(), writeLog: false });
          assert.equal(result.failed.length, 0);
          assert.equal(result.reused.length, 0);
          assert.equal(calls.length, 4);

          const art = calls.find((c) => c.path.endsWith(ORIGINAL));
          assert.equal(art.name, `W2S3_Test_Journal_Art_Page_${ORIGINAL}`);
          assert.equal(art.folder, `assets/world_uploads/${world}`);

          const other = calls.find((c) => c.path.includes("other-world"));
          assert.equal(other.folder, "assets/world_uploads/other-world");
          assert.equal(other.name, "W2S3_Test_Journal_Text_Page_x.webp");

          const page = journal.pages.getName("Art Page");
          assert.equal(page.src, `https://fake-bucket.s3/${art.folder}/${art.name}`);
          assert.include(
            journal.pages.getName("Text Page").text.content,
            "https://fake-bucket.s3/assets/world_uploads/other-world/",
          );
          assert.equal(
            scene.background.src,
            `https://fake-bucket.s3/assets/world_uploads/${world}/W2S3_Test_Scene_bg.png`,
          );
          assert.equal(
            scene.tiles.contents[0].texture.src,
            `https://fake-bucket.s3/assets/world_uploads/${world}/W2S3_Test_Scene_t.png`,
          );
          assert.isFalse(calls.some((c) => c.path.includes("thumb")));
          assert.equal(scene.thumb, `worlds/${world}/assets/scenes/thumb.webp`);
        });

        it("a second scan finds nothing left to move", () => {
          assert.equal(planFor([journal, scene]).files.size, 0);
        });
      });

      describe("migrate when the file is already on S3", () => {
        let journal;

        before(async () => {
          journal = await JournalEntry.create({
            name: "W2S3 Shared Journal",
            pages: [
              { name: "Shared", type: "image", src: "worlds/other-world/assets/shared.png" },
              { name: "New", type: "image", src: "worlds/other-world/assets/new.png" },
            ],
          });
        });

        after(async () => {
          await journal?.delete();
        });

        it("skips the upload and links the existing URL", async () => {
          const plan = planFor([journal]);
          const existingUrl =
            "https://fake-bucket.s3/assets/world_uploads/other-world/W2S3_Shared_Journal_Shared_shared.png";
          const listed = [];
          const list = async (folder) => {
            listed.push(folder);
            return new Map([["W2S3_Shared_Journal_Shared_shared.png", existingUrl]]);
          };
          const calls = [];
          const upload = async (path, name, folder) => {
            calls.push(name);
            return `https://fake-bucket.s3/${folder}/${name}`;
          };
          const result = await migrate(plan, { upload, list, writeLog: false });

          assert.deepEqual(calls, ["W2S3_Shared_Journal_New_new.png"]);
          assert.deepEqual(result.reused, ["worlds/other-world/assets/shared.png"]);
          assert.deepEqual(listed, ["assets/world_uploads/other-world"]);
          assert.equal(journal.pages.getName("Shared").src, existingUrl);
          assert.equal(
            journal.pages.getName("New").src,
            "https://fake-bucket.s3/assets/world_uploads/other-world/W2S3_Shared_Journal_New_new.png",
          );
        });
      });
    },
    { displayName: "World to S3: migrate (stubbed upload)" },
  );
}
