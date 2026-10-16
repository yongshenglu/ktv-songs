/* =========================================================
   显示页逻辑：按原唱分区、歌名胶囊、可折叠、统计
   ========================================================= */

import {
  byPinyin,
  clear,
  el,
  getExpandedOrNull,
  groupByArtist,
  loadSongs,
  normKey,
  saveExpanded,
} from "./common.js";

const listEl = document.getElementById("list");
const stateEl = document.getElementById("state");
const statsEl = document.getElementById("stats");
const toggleAllBtn = document.getElementById("toggle-all");

const CHEVRON = `<svg class="chev" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** 当前渲染出来的分组 */
let groups = [];
/** 当前展开的歌手 key */
let expanded = new Set();

function showState({ icon, title, text, action, isError = false }) {
  stateEl.hidden = false;
  stateEl.className = `state${isError ? " is-error" : ""}`;
  clear(stateEl);
  stateEl.append(
    el("div", { class: "state-icon", text: icon }),
    el("h2", { text: title }),
    el("p", { text })
  );
  if (action) {
    stateEl.append(
      el("button", {
        class: "btn btn-primary",
        type: "button",
        text: action.label,
        onclick: action.onClick,
      })
    );
  }
  clear(listEl);
}

function hideState() {
  stateEl.hidden = true;
  clear(stateEl);
}

function renderStats(songCount, artistCount) {
  clear(statsEl);
  statsEl.append(
    el("span", {}, [
      "共 ",
      el("b", { text: String(songCount) }),
      " 首 · ",
      el("b", { text: String(artistCount) }),
      " 位歌手",
    ])
  );
}

function renderGroup(group) {
  const key = normKey(group.artist);
  const isOpen = expanded.has(key);

  const body = el("div", { class: "artist-body" }, [
    el(
      "div",
      { class: "artist-body-inner" },
      [
        el(
          "ul",
          { class: "song-list" },
          group.songs.map((song) => el("li", { class: "song", text: song.displayTitle }))
        ),
      ]
    ),
  ]);

  const section = el(
    "section",
    { class: `artist${isOpen ? " is-open" : ""}`, dataset: { artist: key } },
    [
      el(
        "button",
        {
          class: "artist-head",
          type: "button",
          "aria-expanded": String(isOpen),
          onclick: () => toggleGroup(key),
        },
        [
          el("span", { class: "artist-name", text: group.artist }),
          el("span", { class: "artist-count", text: `${group.songs.length} 首` }),
        ]
      ),
      body,
    ]
  );

  section.querySelector(".artist-head").insertAdjacentHTML("beforeend", CHEVRON);
  return section;
}

function toggleGroup(key) {
  const section = listEl.querySelector(`[data-artist="${CSS.escape(key)}"]`);
  const willOpen = !expanded.has(key);

  if (willOpen) expanded.add(key);
  else expanded.delete(key);

  saveExpanded(expanded);

  if (section) {
    section.classList.toggle("is-open", willOpen);
    section.querySelector(".artist-head").setAttribute("aria-expanded", String(willOpen));
  }
  syncToggleAllLabel();
}

function allOpen() {
  return groups.length > 0 && groups.every((g) => expanded.has(normKey(g.artist)));
}

function syncToggleAllLabel() {
  toggleAllBtn.textContent = allOpen() ? "全部收起" : "全部展开";
  toggleAllBtn.disabled = groups.length === 0;
}

function render(data) {
  groups = groupByArtist(data.songs);
  hideState();

  if (groups.length === 0) {
    renderStats(0, 0);
    syncToggleAllLabel();
    showState({
      icon: "🎤",
      title: "还没有歌曲",
      text: "去添加页录入你的第一首擅长曲目吧。",
      action: {
        label: "去添加歌曲",
        onClick: () => {
          location.href = "./add.html";
        },
      },
    });
    return;
  }

  const alive = new Set(groups.map((g) => normKey(g.artist)));
  const stored = getExpandedOrNull();
  // 从未手动设置过 → 默认全部收起；设置过则尊重上次状态
  expanded = stored ? new Set([...stored].filter((k) => alive.has(k))) : new Set();
  if (stored) saveExpanded(expanded);

  renderStats(data.songs.length, groups.length);
  clear(listEl);
  const frag = document.createDocumentFragment();
  for (const g of groups) frag.append(renderGroup(g));
  listEl.append(frag);
  syncToggleAllLabel();
}

function renderError(err) {
  renderStats(0, 0);
  toggleAllBtn.disabled = true;
  showState({
    icon: "⚠️",
    title: "歌单加载失败",
    text: `${err?.message || "读取歌单数据时出错"}。`,
    isError: true,
    action: { label: "重试", onClick: () => boot() },
  });
}

toggleAllBtn.addEventListener("click", () => {
  expanded = allOpen() ? new Set() : new Set(groups.map((g) => normKey(g.artist)));
  saveExpanded(expanded);

  for (const section of listEl.querySelectorAll(".artist")) {
    const open = expanded.has(section.dataset.artist);
    section.classList.toggle("is-open", open);
    section.querySelector(".artist-head").setAttribute("aria-expanded", String(open));
  }
  syncToggleAllLabel();
});

async function boot() {
  try {
    const data = await loadSongs();
    render(data);
  } catch (err) {
    renderError(err);
  }
}

boot();
