/* =========================================================
   共用工具：数据读写、拼音排序、解析、折叠状态
   ========================================================= */

export const DATA_PATH = "data/songs.json";

/* ---------- localStorage ---------- */

const LS = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 隐私模式下写入失败，静默忽略 */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export const STORAGE_KEYS = {
  expanded: "ktv.expanded",
  config: "ktv.config",
  token: "ktv.token",
};

export const store = LS;

/* ---------- 排序 ---------- */

const collator = new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "base" });

export function byPinyin(a, b) {
  return collator.compare(String(a), String(b));
}

/** 去重用的归一化键：去首尾空白、全角转半角、小写 */
export function normKey(str) {
  return String(str ?? "")
    .trim()
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ")
    .toLowerCase();
}

export function songKey(artist, title) {
  return `${normKey(artist)} ${normKey(title)}`;
}

/* ---------- 数据结构 ---------- */

export function emptyData() {
  return { version: 1, updatedAt: new Date().toISOString(), songs: [] };
}

/** 容错解析：接受数组或 {songs:[]} 对象 */
export function normalizeData(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.songs) ? raw.songs : [];
  const songs = [];
  for (const item of list) {
    const artist = String(item?.artist ?? "").trim();
    const title = String(item?.title ?? "").trim();
    if (!artist || !title) continue;
    songs.push({ id: String(item?.id ?? makeId()), artist, title });
  }
  return {
    version: 1,
    updatedAt: raw?.updatedAt ?? new Date().toISOString(),
    songs,
  };
}

export function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 归并区：只有一首歌的歌手，统一挂在「一人一首」下、歌名写作「原唱-歌名」。
 * 这个分组固定排在最后，不参与拼音排序。
 *
 * 归并是**显示层实时计算**的，数据里始终存真实的原唱与歌名 ——
 * 这样加歌/删歌后会自动进出：某歌手只剩 1 首就并进来，
 * 他又有了第 2 首就整组按正常拼音排序回到自己的位置。
 */
const PINNED_GROUP = "一人一首";

/** 按原唱分组并排序；每首歌会多出 displayTitle 字段供界面使用 */
export function groupByArtist(songs) {
  // 先统计每位歌手有几首，决定谁要被归并
  const counts = new Map();
  for (const s of songs) {
    const k = normKey(s.artist);
    counts.set(k, (counts.get(k) || 0) + 1);
  }

  const map = new Map();
  for (const s of songs) {
    const solo = counts.get(normKey(s.artist)) === 1;
    const groupKey = solo ? normKey(PINNED_GROUP) : normKey(s.artist);
    const displayTitle = solo ? `${s.artist}-${s.title}` : s.title;

    if (!map.has(groupKey)) {
      map.set(groupKey, { artist: solo ? PINNED_GROUP : s.artist, songs: [] });
    }
    map.get(groupKey).songs.push({ ...s, displayTitle });
  }

  const groups = [...map.values()];
  for (const g of groups) g.songs.sort((a, b) => byPinyin(a.displayTitle, b.displayTitle));

  groups.sort((a, b) => {
    const aPin = normKey(a.artist) === normKey(PINNED_GROUP) ? 1 : 0;
    const bPin = normKey(b.artist) === normKey(PINNED_GROUP) ? 1 : 0;
    if (aPin !== bPin) return aPin - bPin;
    return byPinyin(a.artist, b.artist);
  });
  return groups;
}

/* ---------- 仓库配置 ---------- */

/** 从当前网址推断 owner/repo（GitHub Pages） */
export function inferRepo() {
  const host = location.hostname;
  const m = host.match(/^(.+)\.github\.io$/i);
  if (!m) return null;
  const owner = m[1];
  const seg = location.pathname.split("/").filter(Boolean)[0] || "";
  const isPageFile = /\.(html?)$/i.test(seg);
  const repo = isPageFile || !seg ? `${owner}.github.io` : seg;
  return `${owner}/${repo}`;
}

export function getConfig() {
  const saved = LS.get(STORAGE_KEYS.config, {}) || {};
  return {
    owner: saved.owner || "",
    repo: saved.repo || "",
    branch: saved.branch || "main",
  };
}

export function saveConfig({ owner, repo, branch }) {
  LS.set(STORAGE_KEYS.config, { owner, repo, branch: branch || "main" });
}

/** 把 "owner/repo" 拆开 */
export function parseRepoField(value) {
  const v = String(value || "").trim().replace(/\.git$/, "");
  const m = v.match(/^([^/\s]+)\/([^/\s]+)$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

/** 当前生效的 owner/repo 字符串，未配置返回 null */
export function activeRepoSlug() {
  const cfg = getConfig();
  if (cfg.owner && cfg.repo) return `${cfg.owner}/${cfg.repo}`;
  return inferRepo();
}

/* ---------- 读取数据 ---------- */

/**
 * 读取 songs.json。
 * 优先同源文件（加时间戳绕开 Pages CDN 缓存），失败回退 raw.githubusercontent.com。
 */
export async function loadSongs() {
  const stamp = Date.now();
  const localUrl = `./${DATA_PATH}?t=${stamp}`;

  try {
    const res = await fetch(localUrl, { cache: "no-store" });
    if (res.ok) return normalizeData(await res.json());
  } catch {
    /* 同源不可用，走回退源 */
  }

  const slug = activeRepoSlug();
  if (!slug) throw new Error("无法确定数据文件的地址");

  const [owner, repo] = slug.split("/");
  const branch = getConfig().branch || "main";
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${DATA_PATH}?t=${stamp}`;

  let res;
  try {
    res = await fetch(rawUrl, { cache: "no-store" });
  } catch {
    throw new Error("网络请求失败，请检查网络连接");
  }
  if (!res.ok) {
    if (res.status === 404) throw new Error("找不到 data/songs.json，请检查仓库地址与分支");
    throw new Error(`服务器返回 ${res.status}`);
  }
  return normalizeData(await res.json());
}

/* ---------- 批量行解析 ---------- */

/** 始终当作分隔符的标点 */
const SEP_CHARS = new Set(["+", "＋", "|", "｜", "：", ":"]);
/** 破折号类字符（连续多个也算一个分隔符） */
const DASH_CHARS = new Set(["-", "–", "—", "‒", "―", "﹣", "－"]);

const isAsciiWord = (ch) => Boolean(ch) && /[0-9A-Za-z]/.test(ch);

/** 去掉 "1." "2、" "3)" 之类的粘贴序号前缀 */
function stripIndex(line) {
  return line.replace(/^\s*["'“‘]?\d+\s*[.、．,，:：)）]\s*/, "").trim();
}

/**
 * 找到第一个分隔符位置。
 * 特例：夹在两个 ASCII 字母/数字之间的单个连字符（如 A-Lin、J-Pop）
 * 属于名字本身，不当分隔符。
 */
function findSeparator(line) {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (SEP_CHARS.has(ch)) return { at: i, len: 1 };

    if (DASH_CHARS.has(ch)) {
      let len = 1;
      while (i + len < line.length && DASH_CHARS.has(line[i + len])) len++;

      const before = i > 0 ? line[i - 1] : "";
      const after = i + len < line.length ? line[i + len] : "";
      const spaced = /\s/.test(before) || /\s/.test(after);
      const wordHyphen =
        !spaced && len === 1 && ch === "-" && isAsciiWord(before) && isAsciiWord(after);

      if (wordHyphen) {
        i += len - 1;
        continue;
      }
      return { at: i, len };
    }
  }
  return null;
}

/** 同一行里多首歌名之间的分隔符：顿号、逗号、分号（全角/半角） */
const TITLE_SEPARATORS = /[、，,；;]+/;

/**
 * 解析一行，返回该行对应的多首歌曲。
 *
 * 一行可以写同一个歌手的多首歌：`周杰伦+晴天、稻香、七里香`
 * 也支持 `原唱 - 歌名` / `原唱｜歌名` / `原唱：歌名`。
 *
 * @returns {{artist:string,title:string}[]} 解析不出返回空数组
 */
function parseSongLine(rawLine) {
  const line = stripIndex(String(rawLine ?? ""));
  if (!line) return [];

  const sep = findSeparator(line);
  if (!sep) return [];

  const artist = line.slice(0, sep.at).trim();
  const rest = line.slice(sep.at + sep.len);
  if (!artist || !rest.trim()) return [];

  const titles = rest
    .split(TITLE_SEPARATORS)
    .map((t) => t.trim())
    .filter(Boolean);

  return titles.map((title) => ({ artist, title }));
}

/** 批量解析并去重（保留首次出现） */
export function parseSongLines(text) {
  const lines = String(text || "").split(/\r?\n/);
  const added = [];
  const seen = new Set();
  let invalid = 0;
  let blank = 0;

  for (const line of lines) {
    if (!line.trim()) {
      blank++;
      continue;
    }
    const parsed = parseSongLine(line);
    if (parsed.length === 0) {
      invalid++;
      continue;
    }
    for (const item of parsed) {
      const key = songKey(item.artist, item.title);
      if (seen.has(key)) continue;
      seen.add(key);
      added.push(item);
    }
  }
  return { added, invalid, blank };
}

/* ---------- 折叠状态 ---------- */

/**
 * 用户手动保存的展开集合。
 * 从未设置过返回 null，由调用方决定默认值。
 */
export function getExpandedOrNull() {
  const v = LS.get(STORAGE_KEYS.expanded, null);
  return Array.isArray(v) ? new Set(v.map(String)) : null;
}

function getExpanded() {
  return getExpandedOrNull() ?? new Set();
}

export function saveExpanded(set) {
  LS.set(STORAGE_KEYS.expanded, [...set]);
}

/* ---------- DOM 小工具 ---------- */

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

let toastWrap = null;
export function toast(message, { type = "ok", action = null, duration = 2800 } = {}) {
  if (!toastWrap) {
    toastWrap = el("div", { class: "toast-wrap" });
    document.body.append(toastWrap);
  }
  const node = el("div", { class: `toast toast-${type}`, role: "status" }, [message]);
  if (action) {
    node.append(el("a", { href: action.href, text: action.label }));
  }
  toastWrap.append(node);
  setTimeout(() => {
    node.style.transition = "opacity .22s ease, transform .22s ease";
    node.style.opacity = "0";
    node.style.transform = "translateY(8px)";
    setTimeout(() => node.remove(), 240);
  }, duration);
}
