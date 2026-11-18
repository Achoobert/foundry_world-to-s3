import { buildName, findLocalPaths, rewrite, sourceWorld } from "./scan.js";

export const MODULE_ID = "world-to-s3";

// Document types with no images worth moving, or whose updates are risky.
const SKIP_TYPES = new Set(["Setting", "FogExploration", "Combat"]);

// Fields never moved. Scene `thumb` is a thumbnail Foundry generates; it is left as is.
const SKIP_FIELDS = ["thumb"];

/** Bucket and key prefix from settings, with fallbacks. */
export function getTarget() {
  const bucket = game.settings.get(MODULE_ID, "bucket") || game.data.files.s3?.buckets?.[0] || null;
  const prefix = game.settings.get(MODULE_ID, "prefix").replace(/^\/+|\/+$/g, "");
  return { bucket, prefix };
}

/** Field names of embedded collections, e.g. {JournalEntryPage: "pages"} -> ["pages"]. */
function embeddedFields(doc) {
  return Object.values(doc.constructor.metadata?.embedded ?? {});
}

/**
 * Walk one document and its embedded children. Records each doc that holds local paths,
 * and the first usage of each path (that usage names the file).
 */
function scanDoc(doc, parts, plan) {
  if (doc.getFlag?.(MODULE_ID, "log")) return;
  const fields = embeddedFields(doc);
  const own = doc.toObject();
  for (const f of [...fields, ...SKIP_FIELDS]) delete own[f];
  const paths = findLocalPaths(own);
  if (paths.size) {
    plan.docs.push({ doc, own, label: parts.join(" / ") });
    for (const p of paths) {
      const entry = plan.files.get(p);
      if (entry) entry.usages.push(parts.join(" / "));
      else plan.files.set(p, { name: buildName(parts, p), usages: [parts.join(" / ")] });
    }
  }
  for (const f of fields) {
    // Most embedded fields are collections; a few (Token.delta) hold one document.
    const value = doc[f];
    const children = value?.contents ?? (value instanceof foundry.abstract.Document ? [value] : []);
    for (const child of children) {
      scanDoc(child, child.name ? [...parts, child.name] : parts, plan);
    }
  }
}

function emptyPlan() {
  return { files: new Map(), docs: [], skippedPacks: [], unlockPacks: [], missing: [] };
}

/** Plan for just these documents, no disk check. Used by tests so they never touch real docs. */
export function planFor(docs) {
  const plan = emptyPlan();
  for (const doc of docs) scanDoc(doc, [doc.name ?? doc.id], plan);
  return plan;
}

/** Scan world collections and compendiums. Returns a plan; nothing is changed. */
export async function scan({ includeModulePacks = true } = {}) {
  const plan = emptyPlan();

  for (const collection of game.collections) {
    if (SKIP_TYPES.has(collection.documentName)) continue;
    for (const doc of collection) scanDoc(doc, [doc.name ?? doc.id], plan);
  }

  for (const pack of game.packs) {
    if (SKIP_TYPES.has(pack.documentName)) continue;
    const isWorld = pack.metadata.packageType === "world";
    if (!isWorld && (!includeModulePacks || pack.locked)) {
      if (includeModulePacks) plan.skippedPacks.push(pack.collection);
      continue;
    }
    if (pack.locked) plan.unlockPacks.push(pack);
    const docs = await pack.getDocuments();
    for (const doc of docs) scanDoc(doc, [pack.metadata.label, doc.name ?? doc.id], plan);
  }

  await runPool([...plan.files.keys()], 8, async (path) => {
    const res = await fetch(`/${encodePath(path)}`, { method: "HEAD" }).catch(() => null);
    if (!res?.ok) plan.missing.push(path);
  });
  return plan;
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** Default uploader: read the local file, send it to S3 through Foundry. Returns the URL. */
export async function uploadToS3(path, name, folder) {
  const { bucket } = getTarget();
  const res = await fetch(`/${encodePath(path)}`);
  if (!res.ok) throw new Error(`fetch ${path}: ${res.status}`);
  const blob = await res.blob();
  const file = new File([blob], name, { type: blob.type });
  const result = await foundry.applications.apps.FilePicker.implementation.upload(
    "s3",
    folder,
    file,
    { bucket },
    { notify: false },
  );
  if (!result?.path) throw new Error(`upload ${path} failed`);
  return result.path;
}

/** Default lister: files already in an S3 folder, as {filename: url}. A missing folder is empty. */
export async function listS3(folder) {
  const { bucket } = getTarget();
  const result = await foundry.applications.apps.FilePicker.implementation
    .browse("s3", folder, { bucket })
    .catch(() => null);
  const found = new Map();
  for (const url of result?.files ?? []) found.set(decodeURIComponent(url.split("/").pop()), url);
  return found;
}

/**
 * Upload every file in the plan and point documents at the new URLs.
 * A file whose name is already in its S3 folder is not uploaded again; docs point at the
 * existing URL. Another world may have uploaded it from a shared compendium or journal.
 * @param {object} plan  from scan()
 * @param {object} [opts]
 * @param {Function} [opts.upload]  (path, name, folder) => url; swapped out in tests
 * @param {Function} [opts.list]  (folder) => Map of filename to url; swapped out in tests
 * @param {Function} [opts.onProgress]  (done, total, label)
 * @param {boolean} [opts.writeLog]  create the log journal and manifest
 */
export async function migrate(
  plan,
  { upload = uploadToS3, list = listS3, onProgress = () => {}, writeLog = true } = {},
) {
  const { prefix } = getTarget();
  const map = new Map();
  const failed = [];
  const reused = [];
  const listings = new Map();
  const todo = [...plan.files.entries()].filter(([p]) => !plan.missing.includes(p));
  const total = todo.length + plan.docs.length;
  let done = 0;

  await runPool(todo, 4, async ([path, entry]) => {
    const folder = `${prefix}/${sourceWorld(path)}`;
    try {
      if (!listings.has(folder)) listings.set(folder, list(folder));
      const existing = (await listings.get(folder)).get(entry.name);
      if (existing) reused.push(path);
      map.set(path, existing ?? (await upload(path, entry.name, folder)));
    } catch (err) {
      console.error(`${MODULE_ID} |`, err);
      failed.push(path);
    }
    onProgress(++done, total, entry.name);
  });

  for (const pack of plan.unlockPacks) await pack.configure({ locked: false });
  let updated = 0;
  try {
    for (const { doc, own, label } of plan.docs) {
      const next = rewrite(own, map);
      const changes = {};
      for (const [k, v] of Object.entries(next)) {
        if (JSON.stringify(v) !== JSON.stringify(own[k])) changes[k] = v;
      }
      if (Object.keys(changes).length) {
        await doc.update(changes);
        updated++;
      }
      onProgress(++done, total, label);
    }
  } finally {
    for (const pack of plan.unlockPacks) await pack.configure({ locked: true });
  }

  const result = { map, failed, reused, updated, missing: plan.missing, skippedPacks: plan.skippedPacks };
  if (writeLog && map.size) await writeManifest(plan, result, upload === uploadToS3);
  return result;
}

/** Save what moved where: a JSON file on S3 and a journal entry in the world. */
async function writeManifest(plan, result, toS3) {
  const { prefix } = getTarget();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rows = [...result.map].map(([path, url]) => ({
    from: path,
    to: url,
    reused: result.reused.includes(path),
    usages: plan.files.get(path).usages,
  }));
  if (toS3) {
    const { bucket } = getTarget();
    const file = new File([JSON.stringify(rows, null, 2)], `world-to-s3-manifest-${stamp}.json`, {
      type: "application/json",
    });
    await foundry.applications.apps.FilePicker.implementation
      .upload("s3", `${prefix}/${game.world.id}`, file, { bucket }, { notify: false })
      .catch((err) => console.error(`${MODULE_ID} | manifest upload`, err));
  }
  const esc = foundry.utils.escapeHTML ?? ((s) => s);
  const content =
    `<p>${rows.length} files moved (${result.reused.length} already on S3), ${result.updated} documents updated.</p><ul>` +
    rows
      .map(
        (r) =>
          `<li><code>${esc(r.from)}</code> → <a href="${esc(r.to)}">${esc(r.to)}</a>${r.reused ? " <i>(already on S3)</i>" : ""}</li>`,
      )
      .join("") +
    "</ul>";
  await JournalEntry.create({
    name: `World to S3 log ${stamp}`,
    flags: { [MODULE_ID]: { log: true } },
    pages: [{ name: "Log", type: "text", text: { content } }],
  });
}

/** Run fn over items with at most `size` running at once. */
async function runPool(items, size, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}
