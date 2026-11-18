import { MODULE_ID, getTarget, migrate, scan } from "./migrate.js";
import { sourceWorld } from "./scan.js";

const { ApplicationV2 } = foundry.applications.api;
const esc = (s) => foundry.utils.escapeHTML?.(String(s)) ?? String(s);

/** Settings menu window: Scan (dry run) then Run. */
export class WorldToS3App extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "world-to-s3",
    window: { title: "World to S3", resizable: true },
    position: { width: 640, height: 560 },
    actions: {
      scan: WorldToS3App.#onScan,
      run: WorldToS3App.#onRun,
    },
  };

  plan = null;
  result = null;
  busy = "";

  async _renderHTML() {
    const { bucket, prefix } = getTarget();
    const parts = [`<p>Bucket: <b>${esc(bucket ?? "none set")}</b> · Folder: <code>${esc(prefix)}/{world}/</code></p>`];
    if (!bucket) parts.push(`<p class="notification error">No S3 bucket. Set up S3 in Foundry first.</p>`);

    if (this.busy) parts.push(`<p class="busy"><i class="fa-solid fa-spinner fa-spin"></i> ${esc(this.busy)}</p>`);
    else if (this.result) parts.push(renderResult(this.result));
    else if (this.plan) parts.push(renderPlan(this.plan));
    else
      parts.push(
        `<p>Scan finds every <code>worlds/…</code> image used by this world and its compendiums. Nothing changes until you press Run.</p>`,
      );

    const canRun = bucket && this.plan && !this.result && !this.busy && this.plan.files.size;
    parts.push(`<footer class="form-footer">
      <button type="button" data-action="scan" ${this.busy ? "disabled" : ""}><i class="fa-solid fa-magnifying-glass"></i> Scan</button>
      <button type="button" data-action="run" ${canRun ? "" : "disabled"}><i class="fa-solid fa-cloud-arrow-up"></i> Run</button>
    </footer>`);
    return `<div class="world-to-s3" style="overflow:auto;height:100%;padding:0.5rem">${parts.join("")}</div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  static async #onScan() {
    this.result = null;
    this.busy = "Scanning…";
    await this.render();
    this.plan = await scan({ includeModulePacks: game.settings.get(MODULE_ID, "includeModulePacks") });
    this.busy = "";
    this.render();
  }

  static async #onRun() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "World to S3" },
      content: `<p>Upload ${this.plan.files.size - this.plan.missing.length} files and update ${this.plan.docs.length} documents? Back up the world first.</p>`,
    });
    if (!ok) return;
    this.busy = "Starting…";
    await this.render();
    this.result = await migrate(this.plan, {
      onProgress: (done, total, label) => {
        this.busy = `${done} / ${total} · ${label}`;
        const el = this.element?.querySelector(".world-to-s3 .busy");
        if (el) el.textContent = this.busy;
      },
    });
    this.busy = "";
    this.render();
  }
}

function renderPlan(plan) {
  const byWorld = {};
  for (const p of plan.files.keys()) byWorld[sourceWorld(p)] = (byWorld[sourceWorld(p)] ?? 0) + 1;
  const rows = [...plan.files]
    .slice(0, 300)
    .map(
      ([p, e]) =>
        `<li><code>${esc(p)}</code><br>→ ${esc(e.name)}${e.usages.length > 1 ? ` <i>(+${e.usages.length - 1} more uses)</i>` : ""}</li>`,
    )
    .join("");
  return `<p><b>${plan.files.size}</b> files in <b>${plan.docs.length}</b> documents.</p>
    <p>By source world: ${
      Object.entries(byWorld)
        .map(([w, n]) => `${esc(w)} (${n})`)
        .join(", ") || "none"
    }</p>
    ${plan.missing.length ? `<details><summary>${plan.missing.length} missing on disk (skipped)</summary><ul>${plan.missing.map((p) => `<li><code>${esc(p)}</code></li>`).join("")}</ul></details>` : ""}
    ${plan.skippedPacks.length ? `<details><summary>${plan.skippedPacks.length} locked module packs skipped</summary><ul>${plan.skippedPacks.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></details>` : ""}
    <details open><summary>Files${plan.files.size > 300 ? " (first 300)" : ""}</summary><ul>${rows}</ul></details>`;
}

function renderResult(r) {
  return `<p><b>Done.</b> ${r.map.size} files uploaded, ${r.updated} documents updated.</p>
    ${r.failed.length ? `<p class="notification error">${r.failed.length} uploads failed (see console):</p><ul>${r.failed.map((p) => `<li><code>${esc(p)}</code></li>`).join("")}</ul>` : ""}
    <p>A "World to S3 log" journal lists every move.</p>`;
}
