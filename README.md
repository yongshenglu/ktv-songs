# 我的 KTV 歌单

一个可以在手机上随时翻看的「擅长演唱歌曲名单」。按**原唱**分区显示，加歌和看歌分成两个页面，纯静态托管在 GitHub Pages 上，没有后端、没有构建步骤。

**线上地址：<https://yongshenglu.github.io/ktv-songs/>**

- **看歌**（`index.html`）：按原唱分组、可折叠，顶部显示「共 N 首 · M 位歌手」
- **加歌 + 导出**（`add.html`）：按「原唱 + 歌名」录入提交到仓库；并可导出纯文本 / CSV / JSON / 分享图片

---

## 目录结构

```
├── index.html          显示页（手机上看的主页面）
├── add.html            添加页
├── assets/
│   ├── style.css       移动优先的深色样式
│   ├── common.js       数据读写、拼音排序、批量行解析
│   ├── list.js         显示页逻辑
│   ├── export.js       导出：纯文本 / CSV / JSON / 分享图片
│   ├── add.js          添加页逻辑（GitHub API 客户端）
│   ├── icon.svg / icon-*.png / apple-touch-icon.png
│   └── favicon-32.png
├── data/
│   └── songs.json      歌曲数据
├── tools/
│   └── make_icons.py   图标生成脚本（开发用，不参与部署）
├── site.webmanifest    PWA 清单
├── .nojekyll           关闭 GitHub Pages 的 Jekyll 处理
└── README.md
```

没有 `package.json`，没有依赖，没有构建产物。推上去就能跑。

---

## 一、发布到 GitHub Pages

### 1. 新建仓库

在 GitHub 新建一个 **公开** 仓库（GitHub Pages 免费版要求公开），建议命名 `ktv-songs`，先不要勾选 README/gitignore。

### 2. 推送代码

```bash
git init
git add .
git commit -m "KTV 歌单初版"
git branch -M main
git remote add origin https://github.com/<你的用户名>/ktv-songs.git
git push -u origin main
```

### 3. 开启 Pages

仓库页面 → **Settings → Pages → Build and deployment**

- Source：**Deploy from a branch**
- Branch：`main` / `/ (root)`

保存后等 1 分钟左右，页面顶部会出现访问地址：

```
https://<你的用户名>.github.io/ktv-songs/
```

### 4. 手机上安装

用手机浏览器打开上面的地址 → 浏览器菜单 → **添加到主屏幕**，就会像 App 一样有个图标。

图标是深色底 + 琥珀色音符，跟站内品牌色一致：

| 文件 | 用途 |
|---|---|
| `assets/apple-touch-icon.png` | iOS「添加到主屏幕」图标（180×180） |
| `assets/icon-192.png` / `icon-512.png` | 安卓/桌面安装图标（`purpose: any`） |
| `assets/icon-maskable-*.png` | 启动器裁切成圆形等形状时用（满幅，内容在中央安全区） |
| `assets/icon.svg` | 现代浏览器标签页图标（矢量，无限清晰） |
| `assets/favicon-32.png` | 不支持 SVG 的旧浏览器兜底 |
| `site.webmanifest` | PWA 清单：应用名、主题色、图标声明 |

**换图标**：改 `tools/make_icons.py` 里的配色/造型，跑一次就全部重新生成。

```bash
python tools/make_icons.py
```

需要 Pillow（`pip install Pillow`）。改完记得把 `assets/icon.svg` 也同步改一下，它和 PNG 是两份独立实现，但几何参数在注释里是对应的。

---

## 二、配置 GitHub 同步（加歌用）

添加页需要往仓库写文件，所以要配一个 Token。

### 1. 生成 Fine-grained Personal Access Token

1. 打开 <https://github.com/settings/personal-access-tokens/new>
2. **Token name**：随便填，比如 `ktv-songs`
3. **Expiration**：建议 1 年
4. **Repository access**：选 **Only select repositories** → 勾选 `ktv-songs`
5. **Permissions → Repository permissions → Contents**：设为 **Read and write**
6. 点 **Generate token**，复制 `github_pat_...`（只显示一次）

> 用 Fine-grained token 的好处是：即使泄露，也只能改这一个仓库的文件，不能动你的其他仓库或账号设置。

### 2. 在添加页填入

打开 `https://<你的用户名>.github.io/ktv-songs/add.html`

1. 点开 **GitHub 同步 → 连接设置**
2. 粘贴 Token
3. 仓库会自动推断成 `<你的用户名>/ktv-songs`，确认一下即可
4. 分支填 `main`
5. 点 **测试连接** —— 显示「连接成功」就完成了
6. 点 **保存设置**

> Token 只存在这台手机的浏览器里（localStorage），**不会写进仓库，也不会发给任何第三方**。
> 换手机或清了浏览器数据后需要重新填一次。

---

## 三、日常使用

### 添加歌曲

- **单首**：填「原唱」和「歌名」，点「添加这首歌」。输入框会自动清空并保持焦点，方便连续录入。
- **批量**：展开「批量添加」，每行一首；同一个歌手的多首歌用顿号或逗号隔开：

  ```
  周杰伦+晴天、稻香、七里香
  林俊杰 - 江南，她说
  陈奕迅｜浮夸
  邓紫棋：泡沫
  ```

  也支持行首带序号（`1.` / `2、` / `3)`），会自动去掉。名字里的连字符（如 `A-Lin`）不会被误当成。

  等价写法都行：`原唱+歌名`、`原唱 - 歌名`、`原唱｜歌名`、`原唱：歌名`。歌名之间的分隔符支持顿号、逗号、分号（全角半角）。

- 重复的「原唱+歌名」会被自动拦下，不会写两遍。
- 每次添加都会在仓库里产生一条 commit，message 形如 `添加歌曲：周杰伦 - 晴天`。

### 查看歌单

- **歌名是胶囊标签**，同一歌手的歌自动换行排布 —— 一屏能看到二十几首，不用一行一首地滚
- 歌手区块**默认收起**，右侧箭头可点开/收起，顶部「全部展开 / 全部收起」一键切换
- 你手动展开/收起的状态会被记住，下次打开还是那样（从没动过就保持收起）
- 歌手和歌名都按**拼音**排序；**「一人一首」固定在最下方** —— 只有一首歌的歌手自动归并到这一组，歌名写作「原唱-歌名」
- 归并是**自动维持**的：某歌手只剩 1 首歌就并进来，他又有了第 2 首就整组回到自己的拼音位置。加歌、删歌都不用管

### 导出歌单

导出在**添加页**（`add.html`，即第二个页面），显示页保持干净、去 KTV 时只看列表。

打开添加页，拉到「导出歌单」卡片，四种格式任选：

| 格式 | 去向 | 适合 |
|---|---|---|
| **复制纯文本** | 剪贴板 | 粘进微信 / 备忘录 / 点歌台，按原唱分组 |
| **CSV 表格** | 下载 `.csv` | Excel / WPS / Numbers 打开，可排序筛选打印 |
| **JSON 备份** | 下载 `.json` | 与 `data/songs.json` 同构，换设备迁移或回滚 |
| **分享图片** | 系统分享 / 下载 `.jpg` | 深色 KTV 风长图，发群、存相册 |

- 导出范围是**全部歌曲**，按原唱分组、拼音排序
- 文件名带日期：`KTV歌单-2026-10-15.csv`
- CSV 带 BOM，Excel 打开中文不乱码
- 分享图片在支持的手机浏览器上会直接唤起系统分享面板（可存相册、发微信）；不支持时自动改为下载
- 卡片右上角实时显示当前「N 首 · M 位歌手」；**刚录进去的歌立刻可导**，不等 CDN 缓存

### 删除歌曲

添加页的「删除歌曲」折叠区，**默认收起**。为了防误删，要过两道：

1. 在下拉框里**选中**要删的那首（按原唱分组、拼音排序）
2. 在下面**完整输入这首歌的歌名**（不区分大小写），删除按钮才会亮起

两个条件缺一不可，按钮默认是禁用的。删除会在仓库里产生一条 `删除歌曲：原唱 - 歌名` 的 commit，想反悔可以从 git 历史找回。

### 改歌

要改歌名或原唱，直接去 GitHub 仓库编辑 [`data/songs.json`](data/songs.json)：

```json
{
  "version": 1,
  "updatedAt": "2026-10-14T00:00:00.000Z",
  "songs": [
    { "id": "…", "artist": "周杰伦", "title": "晴天" }
  ]
}
```

改完 commit 即可，`id` 随便留个唯一字符串。

---

## 四、常见问题

**加完歌，显示页还是旧的？**
GitHub Pages 有最长约 10 分钟的 CDN 缓存。显示页已经加了时间戳强制刷新，一般点一下浏览器刷新就更新了；偶尔会有延迟，等一会儿再刷。

**提示「Token 无效或已过期」？**
去 <https://github.com/settings/personal-access-tokens> 看看 token 是不是过期了，或者权限里漏了 **Contents: Read and write**。

**提示「找不到仓库或文件」？**
检查「仓库」是不是 `owner/repo` 的完整写法，分支是不是 `main`。第一次添加前 `data/songs.json` 已经在仓库里了；如果是全新仓库，第一次添加会自动创建。

**手机上加歌没反应？**
先点「测试连接」看是不是配置问题。加歌需要联网提交，飞行模式下不行（歌单本身可以离线看，只要之前打开过）。

---

## 五、数据说明

`data/songs.json` 是唯一的数据源，字段只有两个：

| 字段 | 说明 |
|---|---|
| `artist` | 原唱 |
| `title` | 歌名 |

`id` 是内部去重用的，`updatedAt` 是最后修改时间，都不用管。

数据是公开的（公开仓库），所以别往里写不想让人看到的东西。
