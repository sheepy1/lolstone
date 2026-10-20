# 开发记录

配合 [README](../README.md) 使用：README 介绍项目，这里放进度、命令、调试入口、素材抓取和音频处理的管线。

## 进度

M1（规则引擎）、M2（四个职业的全部 86 张卡和预组、L1 贪心 AI、平衡验收）、M3（Three.js 对局画面，定稿）已完成；M4（视听打磨）和 M5（卡组编辑器、L2 困难 AI、设置页）实现完成，等最终验收。进度细节在 [spec 第 7 节](spec.md#7-里程碑)，实现时补的细节在 [NOTES.md](../NOTES.md)。联机、账号、天梯的方案在 [online.md](online.md)，还没实现。

## 命令

```bash
pnpm install
pnpm dev               # 开发服务器（.claude/launch.json 里的 lolstone-dev 用 5174 端口）
pnpm build             # 先跑浏览器侧类型检查再打包到 dist/
pnpm test              # 单元测试（vitest）
pnpm typecheck         # Node 侧和浏览器侧两份 tsconfig 都查
pnpm play              # 命令行里和 L1 贪心 AI 打一局（--ai l0 换成随机 AI）
pnpm arena             # AI 互打统计，例：pnpm arena --a l1 --b l1 --games 250
pnpm smoke             # L0 对 L0 自动打 200 局
pnpm fixture:record    # 重录回放夹具 tests/fixtures/l0-replay.json
pnpm font:subset       # 重做卡面 SDF 字体的子集
pnpm audition:audio    # 生成音效试听页（见下面"音效和音乐"）
```

## 调试入口

只在开发服务器里有，生产构建不带：

- `/dev/fx`：动画调试台，任何事件单独触发、慢放、改时长和曲线；`/dev/art`：卡牌配图总览；粒子预设演示页是 `src/dev/particles/index.html`。
- 地址带 `?autoplay`：玩家这一方也随机选合法动作，快进播放，用来自动跑完一局；`?replay`：回放夹具；`?mute=1`：静音。
- 控制台里的 `lolstone` 对象：`lolstone.autoplay()`、`lolstone.saveScreenshot(name)`（把画布原尺寸存到 `.dev-output/`）、`lolstone.renderFrame()`、`lolstone.gsap`。
- `POST /__dev/screenshot?name=xxx`：页面传来的 PNG 存到 `.dev-output/`，自动化验证用。

## 拉取素材

英雄头像、竖版原画、语音、音效和音乐的成品都在 git 里（`public/art`、`public/audio`），clone 下来就能玩，部署时也不用再跑脚本。要换版本或刷新素材时在仓库根目录跑下面的脚本（`fetch:sfx` 和 `normalize:audio` 要先装 ffmpeg）。开发环境默认有声，地址带 `?mute=1` 静音。

```bash
pnpm fetch:art         # 等于 node scripts/fetch-art.ts
pnpm fetch:voice       # 等于 node scripts/fetch-voice.ts
pnpm fetch:icons       # 等于 node scripts/fetch-icons.ts
pnpm fetch:sfx         # 等于 node scripts/fetch-sfx.ts
pnpm normalize:audio   # 等于 node scripts/normalize-audio.ts，要先装 ffmpeg
```

- 需要 Node 22.18 以上（直接运行 .ts），不需要先装依赖。
- `fetch-art.ts` 从 Data Dragon 取最新版本，拉头像（`icon.png`）和竖版原画（`loading.jpg`）到 `public/art/<key 小写>/`，清单在 `public/art/manifest.json`。
- `fetch-voice.ts` 从 CommunityDragon 拉选用语音（`choose.ogg`，登场台词）和禁用语音（`ban.ogg`，死亡台词）到 `public/audio/voice/<key 小写>/`，清单在 `public/audio/voice/manifest.json`。中文语音拿不到时用英文，清单的 `englishFallback` 列出这些英雄。
- `fetch-icons.ts` 按 `scripts/data/card-art.json` 给没有英雄原画的卡（小兵、野怪、法术、衍生物）、英雄技能和关键词拉配图，到 `public/art/cards/<卡牌 id>/`（`art.*` 卡面原画、`icon.png` 方图）、`public/art/heropowers/`、`public/art/keywords/`，清单在 `public/art/icons-manifest.json`。来源有 Data Dragon 的技能、物品、被动图标和皮肤原画，CommunityDragon 的峡谷单位头像，符文之地传说的卡牌原画（服务器慢，第一次约 1 分钟）。`node scripts/art-review.ts <输出.html>` 生成逐张对照页。
- 已经下载且完整的文件会跳过。加 `--force` 全部重下，`--concurrency <1-6>` 调并发（默认 5）。删掉清单也会全部重下，因为脚本靠清单记的大小判断文件是否完整。
- 有文件下载失败时脚本以非 0 退出，失败的文件记在清单的 `failed` 里，再跑一次会重试。
- 要拉哪些英雄写在 `scripts/lib/champions.ts`，和 [初始卡池](docs/cards-v1.md) 的 key 列保持一致。key 在 Data Dragon 里找不到时脚本会列出来并退出，不下载任何东西。

### 音效和音乐

- 来源、授权和候选都记在 `scripts/data/audio-sources.json`（进 git）：`sources` 是来源（素材包或单个文件），每个都写了页面、作者、授权和授权写在哪里，只收 CC0；`sounds` 是 spec 5.6、5.7 的每个事件或类别和它的 2 到 3 个候选，`selected` 是用户在试听页选定的那个（序号从 1 起），`id` 和 `src/audio/sfx.ts` 的音效键、`music.ts` 的曲目名对应。没选中的候选留着记录，不进成品。
- `fetch-sfx.ts` 只下载选中的候选用到的来源（加 `--candidates` 全部下载），原始素材到 `assets-src/audio/sources/<来源 id>/` 并解压（压缩包用 unzip，7z 用 macOS 自带的 tar 或 `7z`）。断了会从断开的位置续传；字节数和 sha256 跟清单记的不一致时报错，说明上游换了文件。加新来源时先在页面上确认授权，写进清单，再跑 `node scripts/fetch-sfx.ts --record` 把字节数和 sha256 记下来。
- `normalize-audio.ts` 用 ffmpeg 统一响度和格式：48 kHz，ogg（Vorbis）加 mp3 兜底。音效按最大瞬时响度对齐到 -18 LUFS，单声道，去掉首尾静音；语音积分响度 -18 LUFS，单声道；对局和菜单音乐 -20 LUFS，胜负收尾 -18 LUFS，环境音 -30 LUFS，立体声；真峰值都在 -1 dBTP 以下。起音很尖或只有几十毫秒的音效，限幅器最多压 6 dB（语音、音乐 3 dB），再要增益就停在峰值上限，比目标轻，不硬压。目标和理由写在脚本开头的 `PROFILES`。
  - 只做选中的候选，输出 `public/audio/sfx/<id>.ogg|mp3`、`public/audio/music/<id>.ogg|mp3`，`src/audio` 按 id 拼出地址。清单 `public/audio/manifest.json` 列出每个事件 → 选中的文件 → 来源、授权、处理前后的响度。这两个目录下不属于选中候选的旧文件会被删掉。处理记录在 `assets-src/audio/normalize-state.json`，不进构建。
  - 语音也在这里处理：第一次把 `public/audio/voice/` 的原件复制到 `assets-src/audio/voice/` 留底，处理结果写回原路径，旁边加 `.mp3`。重跑 `fetch:voice` 之后 public 里又是原件（`fetch:voice` 按大小判断，会把处理过的文件重新下回来），再跑一次 `normalize:audio` 就行。
  - 输入和参数都没变的文件跳过，`--force` 全部重做，`--only sfx,music,voice` 只做某几类。
- 重新挑选：`node scripts/fetch-sfx.ts --candidates`、`node scripts/normalize-audio.ts --candidates` 把全部候选做到 `assets-src/audio/candidates/`（不碰 public），再 `pnpm audition:audio --out <目录>` 生成试听页：按类别列出每个候选，点击播放，标出来源、授权和现在选中的那个，可以勾选"留用"再导出。定下来后改清单的 `selected`，重跑 `normalize:audio`。
