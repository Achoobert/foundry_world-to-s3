/**
 * Pure helpers: find local world image paths, build S3 names, rewrite references.
 * No Foundry globals here so they are easy to test.
 */

export const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "gif", "svg", "avif"];

// A worlds/... image path, either bare or inside HTML/CSS. The lookbehind stops matches
// inside full URLs like https://host/worlds/... so only local paths are touched.
const EMBEDDED_PATH = new RegExp(
  `(?<![\\w./:%-])/?(worlds/[^"'()<>\\s?#]+?\\.(?:${IMAGE_EXT.join("|")}))(?=$|[?#"'()<>\\s&])`,
  "gi",
);
// A whole field that is just a path. Allows spaces, which plain fields can hold.
const WHOLE_PATH = new RegExp(`^/?(worlds/[^"'<>?#]+\\.(?:${IMAGE_EXT.join("|")}))$`, "i");

/** Turn a raw match into the key used for fetch and the map: no leading slash, decoded. */
export function normalizePath(raw) {
  let p = raw.replace(/^\//, "");
  try {
    p = decodeURIComponent(p);
  } catch {
    // Leave malformed escapes as they are.
  }
  return p;
}

/** Find all local world image paths in one string. Returns normalized keys. */
export function findInString(str) {
  if (typeof str !== "string" || !str.includes("worlds/")) return [];
  const whole = str.trim().match(WHOLE_PATH);
  if (whole) return [normalizePath(whole[1])];
  return [...str.matchAll(EMBEDDED_PATH)].map((m) => normalizePath(m[1]));
}

/** Walk any plain object or array and collect local world image paths. */
export function findLocalPaths(value, out = new Set()) {
  if (typeof value === "string") {
    for (const p of findInString(value)) out.add(p);
  } else if (Array.isArray(value)) {
    for (const v of value) findLocalPaths(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) findLocalPaths(v, out);
  }
  return out;
}

/** Replace local paths in one string using map key -> url. */
export function rewriteString(str, map) {
  if (typeof str !== "string" || !str.includes("worlds/")) return str;
  const whole = str.trim().match(WHOLE_PATH);
  if (whole) return map.get(normalizePath(whole[1])) ?? str;
  return str.replace(EMBEDDED_PATH, (match, p) => map.get(normalizePath(p)) ?? match);
}

/** Return a deep copy of value with local paths rewritten. */
export function rewrite(value, map) {
  if (typeof value === "string") return rewriteString(value, map);
  if (Array.isArray(value)) return value.map((v) => rewrite(v, map));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v, map)]));
  }
  return value;
}

/** Make one name part safe for an S3 key. */
export function sanitize(part) {
  return String(part ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s/\\:*?"<>|#%&{}$!'@+`=^~[\]]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.]+|[_.]+$/g, "");
}

export const MAX_NAME = 200;

/**
 * Build the S3 file name: {part1}_{part2}_..._{original filename}.
 * The original filename is never trimmed; the prefix is cut to fit MAX_NAME.
 */
export function buildName(parts, path) {
  const original = sanitize(path.split("/").pop()) || "image";
  let prefix = parts.map(sanitize).filter(Boolean).join("_");
  const room = MAX_NAME - original.length - 1;
  if (room <= 0) return original;
  if (prefix.length > room) prefix = prefix.slice(0, room).replace(/_+$/, "");
  return prefix ? `${prefix}_${original}` : original;
}

/** worlds/{id}/... -> id */
export function sourceWorld(path) {
  return path.split("/")[1];
}
