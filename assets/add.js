/* =========================================================
   添加页逻辑：GitHub API 客户端 + 单首/批量录入
   ========================================================= */

import {
  DATA_PATH,
  STORAGE_KEYS,
  clear,
  el,
  emptyData,
  getConfig,
  groupByArtist,
  inferRepo,
  loadSongs,
  makeId,
  normKey,
  normalizeData,
  parseRepoField,
  parseSongLines,
  saveConfig,
  songKey,
  store,
  toast,
} from "./common.js";
import { initExport } from "./export.js";

/* ---------- DOM ---------- */

const $ = (id) => document.getElementById(id);

const syncBadge = $("sync-badge");
const syncHint = $("sync-hint");
const syncDetails = $("sync-details");
const syncStatus = $("sync-status");

const cfgToken = $("cfg-token");
const cfgTokenToggle = $("cfg-token-toggle");
const cfgRepo = $("cfg-repo");
const cfgRepoHint = $("cfg-repo-hint");
const cfgBranch = $("cfg-branch");
const cfgSave = $("cfg-save");
const cfgTest = $("cfg-test");

const inArtist = $("in-artist");
const inTitle = $("in-title");
const singleAdd = $("single-add");
const singleError = $("single-error");

const batchInput = $("batch-input");
const batchAdd = $("batch-add");
const batchError = $("batch-error");

/* ---------- Token / 配置 ---------- */

const getToken = () => String(store.get(STORAGE_KEYS.token, "") || "").trim();

function currentConfig() {
  return {
    owner: cfgRepo.dataset.owner || getConfig().owner,
    repo: cfgRepo.dataset.repo || getConfig().repo,
    branch: (cfgBranch.value || "main").trim(),
  };
}

function paintRepoField() {
  const inferred = inferRepo();
  const cfg = getConfig();
  const slug = cfg.owner ? `${cfg.owner}/${cfg.repo}` : inferred;

  if (slug) {
    cfgRepo.value = slug;
    const parsed = parseRepoField(slug);
    if (parsed) {
      cfgRepo.dataset.owner = parsed.owner;
      cfgRepo.dataset.repo = parsed.repo;
    }
    cfgRepoHint.textContent = inferred
      ? `已从当前网址推断为 ${inferred}，可手动修改。`
      : `请确认仓库地址，例如 你的用户名/ktv-songs。`;
  } else {
    cfgRepo.value = "";
    cfgRepoHint.textContent = "当前不是 github.io 网址，请手动填写 owner/repo。";
  }
}

function paintSyncStatus() {
  const token = getToken();
  const cfg = getConfig();
  const ok = Boolean(token && cfg.owner && cfg.repo);

  syncBadge.className = `badge ${ok ? "badge-on" : "badge-off"}`;
  syncBadge.textContent = ok ? `已连接 · ${cfg.owner}/${cfg.repo}` : "未配置";
  syncHint.hidden = ok;
  syncDetails.open = !ok;
}

function showStatus(kind, text) {
  syncStatus.hidden = false;
  syncStatus.className = `notice ${kind ? `notice-${kind}` : ""}`;
  syncStatus.textContent = text;
}

function showFormError(node, text) {
  if (!text) {
    node.hidden = true;
    node.textContent = "";
    return;
  }
  node.hidden = false;
  node.textContent = text;
}

/* ---------- base64（UTF-8 安全） ---------- */

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(String(b64).replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* ---------- GitHub API ---------- */

class GhError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function ghMessage(status) {
  switch (status) {
    case 401:
      return "Token 无效或已过期，请重新生成 Fine-grained token。";
    case 403:
      return "没有权限或触发了 GitHub 限流，请检查 token 的 Contents 写权限。";
    case 404:
      return "找不到仓库或文件，请核对 owner/repo 与分支名。";
    case 409:
      return "仓库内容已被其他改动更新，请重试。";
    case 422:
      return "提交参数不被接受，请检查分支名是否正确。";
    default:
      return `请求失败（HTTP ${status}）。`;
  }
}

function apiUrl(cfg, ref = true) {
  const base = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${DATA_PATH}`;
  return ref ? `${base}?ref=${encodeURIComponent(cfg.branch)}` : base;
}

function authHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    Authorization: `Bearer ${token}`,
  };
}

/** 读取远端 songs.json，返回 { sha, data }；文件不存在时 sha 为 null */
async function ghGetFile(cfg, token) {
  const res = await fetch(apiUrl(cfg), { headers: authHeaders(token) });

  if (res.status === 404) {
    // 可能是文件不存在，也可能是仓库不存在；再确认一下仓库
    const repoRes = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}`, {
      headers: authHeaders(token),
    });
    if (!repoRes.ok) throw new GhError(ghMessage(repoRes.status), repoRes.status);
    return { sha: null, data: emptyData() };
  }

  if (!res.ok) throw new GhError(ghMessage(res.status), res.status);

  const json = await res.json();
  if (json.encoding !== "base64" || typeof json.content !== "string") {
    throw new GhError("远端文件格式异常。", 0);
  }
  try {
    return { sha: json.sha, data: normalizeData(JSON.parse(fromBase64(json.content))) };
  } catch {
    throw new GhError("远端 data/songs.json 不是合法 JSON。", 0);
  }
}

async function ghPutFile(cfg, token, data, message, sha) {
  const body = {
    message,
    content: toBase64(JSON.stringify(data, null, 2) + "\n"),
    branch: cfg.branch,
  };
  if (sha) body.sha = sha;

  const res = await fetch(apiUrl(cfg, false), {
    method: "PUT",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new GhError(ghMessage(res.status), res.status);
  return res.json();
}

/* ---------- 业务：写入歌曲 ---------- */

/**
 * 把 entries 追加进远端数据文件（自动去重、冲突自动重试一次）。
 * @param {{artist:string,title:string}[]} entries
 * @param {(toAdd:{artist:string,title:string}[]) => string} buildMessage
 *        基于真正写入的条目生成 commit message，避免把重复项也算进去
 * @returns {{added:number, skipped:number, entries:object[]}}
 */
async function commitSongs(entries, buildMessage) {
  const token = getToken();
  const cfg = currentConfig();

  if (!token) throw new GhError("还没有配置 Token。", 0);
  if (!cfg.owner || !cfg.repo) throw new GhError("还没有配置仓库地址。", 0);

  for (let attempt = 0; attempt < 2; attempt++) {
    const remote = await ghGetFile(cfg, token);
    const seen = new Set(remote.data.songs.map((s) => songKey(s.artist, s.title)));

    const toAdd = [];
    let skipped = 0;
    for (const e of entries) {
      const key = songKey(e.artist, e.title);
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      toAdd.push({ id: makeId(), artist: e.artist, title: e.title });
    }

    if (toAdd.length === 0) return { added: 0, skipped, entries: [] };

    const next = {
      version: 1,
      updatedAt: new Date().toISOString(),
      songs: [...remote.data.songs, ...toAdd],
    };

    const message = buildMessage(toAdd);

    try {
      await ghPutFile(cfg, token, next, message, remote.sha);
      return { added: toAdd.length, skipped, entries: toAdd };
    } catch (err) {
      if (err instanceof GhError && err.status === 409 && attempt === 0) continue;
      throw err;
    }
  }

  throw new GhError("仓库已被其他人改动，请重试。", 409);
}

/* ---------- 业务：删除歌曲 ---------- */

/**
 * 从远端删掉一首歌（按 id 精确匹配），冲突时自动重试一次。
 * @param {{id:string, artist:string, title:string}} target
 * @returns {object[]} 删除后的完整歌曲列表（来自 GitHub API，非 CDN 缓存）
 */
async function removeSong(target) {
  const token = getToken();
  const cfg = currentConfig();

  if (!token) throw new GhError("还没有配置 Token。", 0);
  if (!cfg.owner || !cfg.repo) throw new GhError("还没有配置仓库地址。", 0);

  for (let attempt = 0; attempt < 2; attempt++) {
    const remote = await ghGetFile(cfg, token);
    const next = remote.data.songs.filter((s) => s.id !== target.id);

    if (next.length === remote.data.songs.length) {
      throw new GhError("列表里没有这首歌，可能已被删除。", 0);
    }

    const data = {
      version: 1,
      updatedAt: new Date().toISOString(),
      songs: next,
    };
    const message = `删除歌曲：${target.artist} - ${target.title}`;

    try {
      await ghPutFile(cfg, token, data, message, remote.sha);
      return next;
    } catch (err) {
      if (err instanceof GhError && err.status === 409 && attempt === 0) continue;
      throw err;
    }
  }

  throw new GhError("仓库已被其他人改动，请重试。", 409);
}

/* ---------- 表单：单首 ---------- */

async function handleSingleAdd() {
  const artist = inArtist.value.trim();
  const title = inTitle.value.trim();

  if (!artist || !title) {
    showFormError(singleError, !artist && !title ? "原唱和歌名都要填。" : !artist ? "原唱还没填。" : "歌名还没填。");
    return;
  }
  showFormError(singleError, "");

  singleAdd.disabled = true;
  singleAdd.textContent = "保存中…";

  try {
    const result = await commitSongs([{ artist, title }], (toAdd) => {
      const s = toAdd[0];
      return `添加歌曲：${s.artist} - ${s.title}`;
    });

    if (result.added === 0) {
      toast("这首歌已经在列表里了", { type: "error" });
      showFormError(singleError, `「${artist} - ${title}」已经在列表里了，没有重复添加。`);
      return;
    }

    inArtist.value = "";
    inTitle.value = "";
    inArtist.focus();
    mergeExportSongs(result.entries);
    toast(`已添加：${artist} - ${title}`, {
      type: "ok",
      action: { label: "查看歌单", href: "./index.html" },
    });
  } catch (err) {
    showFormError(singleError, err?.message || "保存失败，请重试。");
    toast(err?.message || "保存失败", { type: "error" });
  } finally {
    singleAdd.disabled = false;
    singleAdd.textContent = "添加这首歌";
  }
}

/* ---------- 表单：批量 ---------- */

async function handleBatchAdd() {
  const { added, invalid } = parseSongLines(batchInput.value);

  if (added.length === 0) {
    showFormError(
      batchError,
      invalid > 0 ? `没有识别出有效条目，${invalid} 行格式不正确。` : "还没有粘贴内容。"
    );
    return;
  }
  showFormError(batchError, "");

  batchAdd.disabled = true;
  batchAdd.textContent = "保存中…";

  try {
    const result = await commitSongs(added, (toAdd) =>
      toAdd.length === 1
        ? `添加歌曲：${toAdd[0].artist} - ${toAdd[0].title}`
        : `批量添加 ${toAdd.length} 首歌曲`
    );

    const parts = [`成功 ${result.added} 首`];
    if (result.skipped > 0) parts.push(`跳过 ${result.skipped} 首（重复）`);
    if (invalid > 0) parts.push(`${invalid} 行无法识别`);

    if (result.added === 0) {
      toast("没有新歌曲被添加", { type: "error" });
      showFormError(batchError, `全部重复，未写入。${invalid > 0 ? `另有 ${invalid} 行无法识别。` : ""}`);
    } else {
      batchInput.value = "";
      mergeExportSongs(result.entries);
      toast(parts.join("，"), {
        type: "ok",
        action: { label: "查看歌单", href: "./index.html" },
      });
    }
  } catch (err) {
    showFormError(batchError, err?.message || "保存失败，请重试。");
    toast(err?.message || "保存失败", { type: "error" });
  } finally {
    batchAdd.disabled = false;
    batchAdd.textContent = "批量添加";
  }
}

/* ---------- 事件绑定 ---------- */

cfgTokenToggle.addEventListener("click", () => {
  const showing = cfgToken.type === "text";
  cfgToken.type = showing ? "password" : "text";
  cfgTokenToggle.textContent = showing ? "显示" : "隐藏";
});

cfgRepo.addEventListener("change", () => {
  const parsed = parseRepoField(cfgRepo.value);
  if (parsed) {
    cfgRepo.dataset.owner = parsed.owner;
    cfgRepo.dataset.repo = parsed.repo;
  }
});

cfgSave.addEventListener("click", () => {
  const parsed = parseRepoField(cfgRepo.value);
  if (!parsed) {
    showStatus("error", "仓库地址格式应为 owner/repo，例如 yourname/ktv-songs。");
    return;
  }
  const token = cfgToken.value.trim();
  if (token) store.set(STORAGE_KEYS.token, token);

  const branch = (cfgBranch.value || "main").trim();
  saveConfig({ owner: parsed.owner, repo: parsed.repo, branch });

  cfgRepo.dataset.owner = parsed.owner;
  cfgRepo.dataset.repo = parsed.repo;
  cfgToken.value = "";

  paintSyncStatus();
  showStatus("ok", `设置已保存：${parsed.owner}/${parsed.repo}@${branch}。Token 仅保存在本机浏览器。`);
  toast("设置已保存");
});

cfgTest.addEventListener("click", async () => {
  const parsed = parseRepoField(cfgRepo.value);
  const token = cfgToken.value.trim() || getToken();

  if (!parsed) {
    showStatus("error", "请先填写 owner/repo。");
    return;
  }
  if (!token) {
    showStatus("error", "请先填写 Token。");
    return;
  }

  cfgTest.disabled = true;
  cfgTest.textContent = "测试中…";
  try {
    const cfg = { owner: parsed.owner, repo: parsed.repo, branch: (cfgBranch.value || "main").trim() };
    const remote = await ghGetFile(cfg, token);
    const n = remote.data.songs.length;
    showStatus(
      "ok",
      remote.sha
        ? `连接成功。已读到 ${n} 首歌曲。`
        : `连接成功。仓库里还没有 data/songs.json，第一次添加时会自动创建。`
    );
  } catch (err) {
    showStatus("error", err?.message || "连接失败。");
  } finally {
    cfgTest.disabled = false;
    cfgTest.textContent = "测试连接";
  }
});

singleAdd.addEventListener("click", handleSingleAdd);
batchAdd.addEventListener("click", handleBatchAdd);

inTitle.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    handleSingleAdd();
  }
});

/* ---------- 导出 ---------- */

const exportCount = $("export-count");
const exportHint = $("export-hint");
const exportList = $("export-list");

/** 导出用的歌曲数据；加完歌后立即合并进本 */
let exportSongs = [];

initExport({ getSongs: () => exportSongs, container: exportList });

function paintExportStats() {
  const n = exportSongs.length;
  const m = groupByArtist(exportSongs).length;
  exportCount.className = `badge ${n ? "badge-on" : "badge-off"}`;
  exportCount.textContent = n ? `${n} 首 · ${m} 位歌手` : "暂无歌曲";
  exportHint.textContent = n
    ? "导出全部歌曲，按原唱分组、拼音排序。"
    : "还没有歌曲，先在上面录几首再导出。";
}

/** 按 songKey 去重合并，保留已有顺序 */
function mergeExportSongs(entries) {
  const seen = new Set(exportSongs.map((s) => songKey(s.artist, s.title)));
  let changed = false;
  for (const s of entries) {
    const key = songKey(s.artist, s.title);
    if (seen.has(key)) continue;
    seen.add(key);
    exportSongs.push({ id: s.id || makeId(), artist: s.artist, title: s.title });
    changed = true;
  }
  if (changed) paintExportStats();
}

/**
 * 从远端拉一次并合并。
 * 用合并而不是覆盖 —— GitHub Pages 有 CDN 缓存，直接覆盖可能把刚加进去的歌冲掉。
 */
async function refreshExportSongs() {
  try {
    const data = await loadSongs();
    mergeExportSongs(data.songs);
    paintExportStats();
    paintDeleteOptions();
  } catch (err) {
    if (exportSongs.length === 0) {
      exportCount.className = "badge badge-off";
      exportCount.textContent = "读取失败";
      exportHint.textContent = `读取歌单失败（${err?.message || "未知错误"}）。`;
      paintDeleteOptions();
    }
  }
}

/* ---------- 删除歌曲 ---------- */

const delSong = $("del-song");
const delConfirm = $("del-confirm");
const delBtn = $("del-btn");
const delError = $("del-error");
const delHint = $("del-hint");

/** 用当前歌单填充下拉框，按原唱分组、拼音排序 */
function paintDeleteOptions() {
  const prev = delSong.value;
  clear(delSong);

  if (exportSongs.length === 0) {
    delSong.append(el("option", { value: "", text: "暂无歌曲", disabled: true, selected: true }));
    delSong.dataset.empty = "true";
    delHint.textContent = "还没有歌曲可以删除。";
    syncDeleteState();
    return;
  }

  delSong.append(el("option", { value: "", text: "请选择要删除的歌曲", selected: true }));
  for (const g of groupByArtist(exportSongs)) {
    const group = el("optgroup", { label: `${g.artist}（${g.songs.length} 首）` });
    for (const s of g.songs) {
      group.append(el("option", { value: s.id, text: s.title }));
    }
    delSong.append(group);
  }
  delete delSong.dataset.empty;

  // 尽量保留之前的选择
  if (prev && exportSongs.some((s) => s.id === prev)) delSong.value = prev;

  delHint.textContent = "选择后，在下面完整输入该歌名才能删除。";
  syncDeleteState();
}

/** 当前选中的歌曲 */
function selectedSong() {
  return exportSongs.find((s) => s.id === delSong.value) || null;
}

/** 只有「选中了歌」且「确认框歌名一致」时才允许点删除。
 *  用 normKey 归一化比较（去首尾空白、全角转半角、忽略大小写），
 *  避免手机输入法的自动首字母大写把英文歌名挡在门外。 */
function confirmMatches() {
  const target = selectedSong();
  return Boolean(target) && normKey(delConfirm.value) === normKey(target.title);
}

function syncDeleteState() {
  delBtn.disabled = !confirmMatches();
}

function showDeleteError(msg) {
  if (!msg) {
    delError.hidden = true;
    delError.textContent = "";
    return;
  }
  delError.hidden = false;
  delError.textContent = msg;
}

async function handleDelete() {
  const target = selectedSong();
  if (!target) {
    showDeleteError("请先选择要删除的歌曲。");
    return;
  }
  if (!confirmMatches()) {
    showDeleteError("歌名不一致，删除不了。请完整输入上面选中的歌名。");
    return;
  }

  showDeleteError("");
  delBtn.disabled = true;
  delBtn.textContent = "删除中…";

  try {
    const remaining = await removeSong(target);

    // 用 GitHub API 返回的权威列表覆盖本地（不是合并）——
    // 合并是给「加歌」防 CDN 缓存冲掉新增用的，删除若再合并会把刚删的歌找回来
    exportSongs = remaining;
    paintExportStats();
    paintDeleteOptions();
    delConfirm.value = "";
    syncDeleteState();
    toast(`已删除：${target.artist} - ${target.title}`, {
      type: "ok",
      action: { label: "查看歌单", href: "./index.html" },
    });
  } catch (err) {
    showDeleteError(err?.message || "删除失败，请重试。");
    toast(err?.message || "删除失败", { type: "error" });
  } finally {
    delBtn.textContent = "删除这首歌";
    syncDeleteState();
  }
}

delSong.addEventListener("change", () => {
  showDeleteError("");
  syncDeleteState();
});
delConfirm.addEventListener("input", () => {
  showDeleteError("");
  syncDeleteState();
});
delBtn.addEventListener("click", handleDelete);

/* ---------- 初始化 ---------- */

paintRepoField();
paintSyncStatus();
paintExportStats();
paintDeleteOptions();
refreshExportSongs();
inArtist.focus();
