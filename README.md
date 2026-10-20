# LoLstone

网页版的炉石类卡牌游戏，卡牌角色用《英雄联盟》的英雄。单机，和 AI 对战。自己玩的。

玩法对齐炉石基础模式。视听完成度对标炉石：每个事件有专门的动画和音效，有音乐、环境音和英雄语音；视觉语言取自 LoL 对局（峡谷战局）。对局画面用 Three.js 做真 3D，先用 WebGL2 渲染。

- [设计规格](docs/spec.md)：规则、职业、关键词、效果模型、AI、界面与视听、架构、里程碑。
- [初始卡池 v1](docs/cards-v1.md)：86 张卡、衍生物、预组卡组、实现分级、平衡调整记录。
- [M4 分镜表](docs/m4-storyboard.md)：视听约定、交互手感参数、每个事件的分镜。
- [新玩家前几分钟验收](docs/m4-first-minutes.md)：M4 纵切片的验收清单。
- [招牌卡专属特效](docs/m4-signature-fx.md)：11 张卡的 fxId 和分镜。
- [联机对战规格](docs/online.md)：服务端权威的架构、客户端接缝、协议、服务端、里程碑 M6。

## 当前进度

M1（规则引擎）、M2（四个职业的全部 86 张卡和预组、L1 贪心 AI、平衡验收）、M3（Three.js 对局画面，用户定稿）已完成；M4（视听打磨）和 M5（卡组编辑器、L2 困难 AI、设置页）实现完成，等用户最终验收。进度细节在 spec 第 7 节。
实现时补的细节见 [NOTES.md](NOTES.md)。

```bash
pnpm install
pnpm test          # 单元测试
pnpm typecheck     # 类型检查
pnpm play          # 命令行里和 L1 贪心 AI 打一局（--ai l0 换成随机 AI）
pnpm arena         # AI 互打统计，例：pnpm arena --a l1 --b l1 --games 250
pnpm smoke         # L0 对 L0 自动打 200 局
```

## 拉取素材

英雄头像、竖版原画、语音、音效和音乐都不进 git，第一次 clone 之后在仓库根目录跑：（不跑 `fetch:sfx` 和 `normalize:audio` 的话，游戏里没有音效和音乐，请求全是 404）。开发环境默认有声，地址带 `?mute=1` 静音。

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
