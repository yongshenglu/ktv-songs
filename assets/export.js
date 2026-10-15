/* =========================================================
   导出歌单：纯文本 / CSV / JSON / 分享图片
   以选项列表的形式渲染到添加页的容器里
   ========================================================= */

import { clear, el, groupByArtist, toast } from "./common.js";

const FONT_STACK =
  '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC","Helvetica Neue",Arial,sans-serif';

const SITE = "yongshenglu.github.io/ktv-songs";

/** Excel 需要 BOM，否则中文乱码 */
const CSV_BOM = String.fromCharCode(0xfeff);

/* ---------- 小工具 ---------- */

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fileBase() {
  return `KTV歌单-${today()}`;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* 落到下面的兜底方案 */
    }
  }
  // 非安全上下文 / 旧浏览器兜底
  const ta = el("textarea", {
    value: text,
    style: "position:fixed;top:0;left:0;opacity:0;pointer-events:none",
  });
  document.body.append(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/* ---------- 各格式内容 ---------- */

/** 按原唱者分组的纯文本清单 */
function buildText(songs) {
  const groups = groupByArtist(songs);
  const out = [`我的 KTV 歌单`, `共 ${songs.length} 首 · ${groups.length} 位歌手`, ``, ``];

  groups.forEach((g, i) => {
    out.push(`${g.artist} · ${g.songs.length} 首`);
    g.songs.forEach((s, j) => out.push(`  ${j + 1}. ${s.title}`));
    if (i < groups.length - 1) out.push(``);
  });
  return out.join("\n");
}

function csvCell(value) {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Excel / WPS 可直接打开的两列 CSV */
function buildCSV(songs) {
  const rows = [["原唱者", "歌名"]];
  for (const g of groupByArtist(songs)) {
    for (const s of g.songs) rows.push([s.artist, s.title]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** 与 data/songs.json 同构，可直接覆盖回去 */
function buildJSON(songs) {
  return (
    JSON.stringify(
      {
        version: 1,
        updatedAt: new Date().toISOString(),
        songs: songs.map((s) => ({ id: s.id, artist: s.artist, title: s.title })),
      },
      null,
      2
    ) + "\n"
  );
}

/* ---------- 分享图片 ---------- */

function renderShareImage(songs) {
  return new Promise((resolve, reject) => {
    const groups = groupByArtist(songs);
    const W = 750;
    const PAD = 52;
    const inner = W - PAD * 2;

    const probe = document.createElement("canvas").getContext("2d");
    const setFont = (ctx, weight, size) => {
      ctx.font = `${weight} ${size}px ${FONT_STACK}`;
    };

    const F = {
      title: { w: 700, s: 44, lh: 58 },
      stats: { w: 400, s: 23, lh: 34 },
      artist: { w: 700, s: 29, lh: 42 },
      song: { w: 400, s: 26, lh: 40 },
      foot: { w: 400, s: 19, lh: 28 },
    };

    const wrap = (text, style, maxWidth) => {
      setFont(probe, style.w, style.s);
      const lines = [];
      let cur = "";
      for (const ch of String(text)) {
        const next = cur + ch;
        if (cur && probe.measureText(next).width > maxWidth) {
          lines.push(cur);
          cur = ch;
        } else {
          cur = next;
        }
      }
      if (cur) lines.push(cur);
      return lines.length ? lines : [""];
    };

    const INDENT = 44;

    // —— 量高度 ——
    const TOP = 64;
    const BOT = 64;
    let H = TOP + F.title.lh + 8 + F.stats.lh + 30 + 1 + 34;

    const layout = groups.map((g) => {
      const rows = g.songs.map((s) => wrap(s.title, F.song, inner - INDENT));
      H += F.artist.lh + 6 + rows.reduce((a, r) => a + r.length * F.song.lh, 0) + 26;
      return rows;
    });

    H += 1 + 24 + F.foot.lh + BOT;

    // —— 绘制 ——
    const SCALE = 2;
    const canvas = document.createElement("canvas");
    canvas.width = W * SCALE;
    canvas.height = Math.ceil(H) * SCALE;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("当前浏览器不支持画布"));
      return;
    }
    ctx.scale(SCALE, SCALE);

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#121826");
    bg.addColorStop(1, "#080b11");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W * 0.42, H * 0.22, 0, W * 0.42, H * 0.22, W * 0.9);
    glow.addColorStop(0, "rgba(245,185,66,0.13)");
    glow.addColorStop(1, "rgba(245,185,66,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    ctx.textBaseline = "top";

    let y = TOP;
    ctx.fillStyle = "#eaeff7";
    setFont(ctx, F.title.w, F.title.s);
    ctx.fillText("我的 KTV 歌单", PAD, y);
    y += F.title.lh + 8;

    ctx.fillStyle = "#8b97a8";
    setFont(ctx, F.stats.w, F.stats.s);
    ctx.fillText(`共 ${songs.length} 首 · ${groups.length} 位歌手`, PAD, y);
    y += F.stats.lh + 30;

    const rule = (yy) => {
      ctx.fillStyle = "#26303f";
      ctx.fillRect(PAD, yy, inner, 1);
    };
    rule(y);
    y += 1 + 34;

    groups.forEach((g, gi) => {
      setFont(ctx, F.artist.w, F.artist.s);
      ctx.fillStyle = "#f5b942";
      ctx.fillText(g.artist, PAD, y);

      const count = `${g.songs.length} 首`;
      setFont(ctx, 400, 19);
      ctx.fillStyle = "#6f7c8f";
      ctx.fillText(count, W - PAD - ctx.measureText(count).width, y + 10);
      y += F.artist.lh + 6;

      layout[gi].forEach((lines, si) => {
        const prefix = `${si + 1}. `;
        // 序号用小号字，先量出它占多宽，正文再缩进对齐
        setFont(ctx, 400, 19);
        const prefixW = ctx.measureText(prefix).width;

        lines.forEach((line, li) => {
          const isFirst = li === 0;
          if (isFirst) {
            setFont(ctx, 400, 19);
            ctx.fillStyle = "#6f7c8f";
            ctx.fillText(prefix, PAD, y + 7);
          }
          setFont(ctx, F.song.w, F.song.s);
          ctx.fillStyle = "#eaeff7";
          ctx.fillText(line, PAD + (isFirst ? prefixW : INDENT), y);
          y += F.song.lh;
        });
      });

      y += 26;
      if (gi < groups.length - 1) rule(y - 13);
    });

    rule(y);
    y += 1 + 24;

    ctx.fillStyle = "#6f7c8f";
    setFont(ctx, F.foot.w, F.foot.s);
    ctx.fillText(`${SITE}  ·  ${today()}`, PAD, y);

    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("图片生成失败"));
    }, "image/jpeg", 0.92);
  });
}

async function exportImage(songs) {
  const blob = await renderShareImage(songs);
  const name = `${fileBase()}.jpg`;
  const file = new File([blob], name, { type: "image/jpeg" });

  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "我的 KTV 歌单" });
      return "已分享";
    } catch (err) {
      if (err?.name === "AbortError") return null; // 用户取消，不提示
    }
  }
  download(blob, name);
  return `已保存图片 ${name}`;
}

/* ---------- 选项列表 ---------- */

const OPTIONS = [
  {
    key: "text",
    icon: "📋",
    label: "复制纯文本",
    desc: "按原唱者分组，直接粘进微信 / 备忘录",
  },
  {
    key: "csv",
    icon: "📊",
    label: "下载 CSV 表格",
    desc: "Excel / WPS 可打开，两列：原唱者、歌名",
  },
  {
    key: "json",
    icon: "🗂️",
    label: "下载 JSON 备份",
    desc: "与 data/songs.json 同构，可迁移或回滚",
  },
  {
    key: "image",
    icon: "🖼️",
    label: "生成分享图片",
    desc: "深色 KTV 风长图，可存相册或直接分享",
  },
];

/**
 * 把导出选项渲染进 container。
 * @param {() => object[]} getSongs
 * @param {HTMLElement} container
 * @returns {{ refresh: () => void }}
 */
export function initExport({ getSongs, container }) {
  clear(container);
  container.classList.add("export-list");

  async function handle(key) {
    const songs = getSongs() || [];
    if (songs.length === 0) {
      toast("还没有歌曲可以导出", { type: "error" });
      return;
    }

    try {
      if (key === "text") {
        const ok = await copyText(buildText(songs));
        toast(ok ? "已复制到剪贴板" : "复制失败，请手动选择文本", {
          type: ok ? "ok" : "error",
        });
        return;
      }

      if (key === "csv") {
        const blob = new Blob([CSV_BOM + buildCSV(songs)], {
          type: "text/csv;charset=utf-8",
        });
        const name = `${fileBase()}.csv`;
        download(blob, name);
        toast(`已下载 ${name}`);
        return;
      }

      if (key === "json") {
        const blob = new Blob([buildJSON(songs)], {
          type: "application/json;charset=utf-8",
        });
        const name = `${fileBase()}.json`;
        download(blob, name);
        toast(`已下载 ${name}`);
        return;
      }

      if (key === "image") {
        const msg = await exportImage(songs);
        if (msg) toast(msg);
      }
    } catch (err) {
      toast(err?.message || "导出失败", { type: "error" });
    }
  }

  for (const opt of OPTIONS) {
    container.append(
      el(
        "button",
        { class: "export-item", type: "button", onclick: () => handle(opt.key) },
        [
          el("span", { class: "export-item-icon", text: opt.icon }),
          el("span", { class: "export-item-body" }, [
            el("span", { class: "export-item-label", text: opt.label }),
            el("span", { class: "export-item-desc", text: opt.desc }),
          ]),
          el("span", { class: "export-item-chev", text: "›" }),
        ]
      )
    );
  }

  return { refresh: () => {} };
}
