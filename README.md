# MeLoL

网页版的炉石类卡牌游戏，卡牌角色用《英雄联盟》的英雄。单机，和 AI 对战。自己玩的。

玩法对齐炉石基础模式。视听完成度对标炉石：每个事件有专门的动画和音效，有音乐、环境音和英雄语音；视觉语言取自 LoL 对局（峡谷战局）。对局画面用 Three.js 做真 3D，先用 WebGL2 渲染。

- [设计规格](docs/spec.md)：规则、职业、关键词、效果模型、AI、界面与视听、架构、里程碑。
- [初始卡池 v1](docs/cards-v1.md)：86 张卡、衍生物、预组卡组、实现分级。

## 当前进度

M1（规则引擎）和 M2（四个职业的全部 86 张卡和预组、L1 贪心 AI、AI 互打统计）已完成。
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

英雄头像、竖版原画和语音不进 git，第一次 clone 之后在仓库根目录跑：

```bash
pnpm fetch:art     # 等于 node scripts/fetch-art.ts
pnpm fetch:voice   # 等于 node scripts/fetch-voice.ts
```

- 需要 Node 22.18 以上（直接运行 .ts），不需要先装依赖。
- `fetch-art.ts` 从 Data Dragon 取最新版本，拉头像（`icon.png`）和竖版原画（`loading.jpg`）到 `public/art/<key 小写>/`，清单在 `public/art/manifest.json`。
- `fetch-voice.ts` 从 CommunityDragon 拉选用语音（`choose.ogg`，登场台词）和禁用语音（`ban.ogg`，死亡台词）到 `public/audio/voice/<key 小写>/`，清单在 `public/audio/voice/manifest.json`。中文语音拿不到时用英文，清单的 `englishFallback` 列出这些英雄。
- 已经下载且完整的文件会跳过。加 `--force` 全部重下，`--concurrency <1-6>` 调并发（默认 5）。删掉清单也会全部重下，因为脚本靠清单记的大小判断文件是否完整。
- 有文件下载失败时脚本以非 0 退出，失败的文件记在清单的 `failed` 里，再跑一次会重试。
- 要拉哪些英雄写在 `scripts/lib/champions.ts`，和 [初始卡池](docs/cards-v1.md) 的 key 列保持一致。key 在 Data Dragon 里找不到时脚本会列出来并退出，不下载任何东西。
