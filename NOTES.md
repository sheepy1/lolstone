# 实现笔记（M1 引擎）

记录 spec 没写、实现时自己定下的细节。规则以 [docs/spec.md](docs/spec.md) v0.4 为准，这里只补空白。
最后一节是按字面理解实现、但可能影响规则的几处，需要设计方确认。

## 目录

```
src/engine/   规则引擎，纯 TypeScript，不依赖 DOM
  state.ts       局面和卡牌数据的类型
  events.ts      事件类型
  actions.ts     玩家动作、listLegalActions、合法性检查
  game.ts        applyAction 入口
  setup.ts       createGame、换牌
  turn.ts        回合开始、回合结束
  resolve.ts     出牌、攻击、英雄技能、死亡结算、胜负
  effects/       每种动作一个执行器，targets.ts 解析自动目标
  keywords.ts    关键词判定（能否攻击、攻击目标、法术伤害）
  targeting.ts   需要玩家选的目标（TargetSpec）
  scripts/       菲奥娜、泰达米尔
  mask.ts        maskHidden / visibleState
  rng.ts         种子随机数、forkRng
  invariants.ts  不变量检查
  cardDb.ts      卡池注册表
src/cards/    卡牌数据（按职业分文件）、加载校验、预组卡组
src/ai/       L0 随机 AI、L0 对 L0 自动对局
src/cli/      命令行对局
tests/        测试，helpers/ 里是场景 DSL、事件字段表、测试专用卡
```

## 类型和局面

- `CardInstance = { instanceId, cardId }`。instanceId 整局唯一，由 `GameState.nextInstanceId` 分配。
  一张牌从牌库到手牌到场上用同一个 id（随从沿用打出它的那张牌的 id），回手时也保留这个 id；
  衍生物和变形出来的随从分配新 id。开局时按洗牌后的顺序分配 id，所以 id 不泄露卡组列表的顺序。
- `Buff = { source, sourceCardId, attack, health, keywords, duration, enrage? }`。attack 记实际生效的变化量：
  攻击力最低压到 0，被压掉的部分不记，到期移除时按记下的量反向扣回。激怒产生的增益 source 为 null、enrage 为 true。
- `RngState = { s }`，mulberry32 的 32 位状态。`forkRng(state, salt)` 用局面当前状态和 salt 哈希出一条新流，
  不推进局面里的状态；同一局面同一 salt 得到同一条流。
- `GameState` 加了 `nextInstanceId`、`nextSummonOrder` 两个计数器。换牌阶段 `turn` 为 0，第一回合是 1。
- `MinionState` 加了 `extraAttacks`（extra_attack 给的额外攻击次数，回合结束清零）和 `pendingDestroy`
  （被消灭或剧毒命中，等死亡结算移除）。`PlayerState` 加了 `mulliganReplace`（已提交、还没执行的换牌下标）。
- 换牌动作加了 `player` 字段：换牌阶段双方都能行动，`applyAction(state, action)` 需要知道是谁。
- `applyAction` 返回 `{ ok: true, state, events }` 或 `{ ok: false, error }`。合法性判断就是看动作是否在
  `listLegalActions` 的结果里（按规范化的键比较），所以"列出来的一定能执行"天然成立，测试里也抽查了。
- 卡池不进局面。`src/cards` 校验后调用 `installCardPool` 装进引擎的注册表，局面因此保持纯 JSON。
- `maskHidden` 把对方手牌和双方牌库的 cardId 换成占位牌 `hidden`（实例 id 保留），去掉对方未执行的换牌选择，
  随机数换成 `forkRng` 派生的流。占位牌不能打出，抽到它也不出错，遮过的局面可以继续模拟。

## 结算顺序

- 死亡结算的时机：每个效果（一个效果的全部动作）执行完、每次攻击之后、每个回合开始/结束效果之后、回合开始抽牌之后，
  applyAction 结束前再兜底一次。同一个效果里后面的动作照样作用于已经将死、还没离场的随从。
  所以暴风雪会冻结被它打死的随从（随后离场），但不会冻结这些随从亡语召唤出来的衍生物。
- 一轮死亡结算：所有将死的随从同时离场，按入场顺序发 death 事件（同一个 group），按入场顺序触发亡语，
  然后触发 on_kill；有新的死亡就再来一轮，最后判定胜负。
- on_kill 的记功：一个随从对敌方随从造成大于 0 的伤害（攻击、反击、或它自己效果里的伤害）就记一笔，
  同一个受害者以最后一笔为准；被剧毒杀死也算；消灭效果不是伤害，不记。击杀者要在结算时还在场上、
  并且自己没有将死，才触发 on_kill。多个击杀者按入场顺序触发。
- 回合结束顺序：turn_end 事件 → 回合结束效果 → 双方"本回合"增益到期 → 解冻 → 双方额外攻击次数清零 → 临时法力清零。
- 回合开始顺序：turn_start 事件 → 法力 → 回合开始效果 → 抽牌。先手第一回合也抽牌。
- 换牌：双方都提交后才执行，固定先处理玩家 0 再处理玩家 1，所以提交顺序不影响结果。只有一方提交时返回空事件列表。
  换掉的牌洗回牌库再从顶上补抽，新牌放回被换掉的位置；一张都没换的那方不洗牌。

## 规则细节

- 法力药水（temp）：current 和 temp 一起加，current 不超过 10（已经是 10 时什么也不加）。花法力时 temp 跟着降到不超过 current。
  回合结束 temp 清零、current 不超过 max。
- 空水晶（empty）：逐个处理，上限不到 10 就加上限（不回法力），已经是 10 的那个改为抽一张牌。
- mana_changed 即使数值没变也发（比如 10 费时用法力药水），给表现层一个反馈点。
- 吸血：恢复量等于实际造成的伤害（被圣盾挡下为 0，溢出的伤害照算）。剧毒和吸血都看"伤害来源是不是带这个关键词的随从"，
  所以随从自己效果里的伤害也算；亡语时随从已离场，用离场时的快照判断。
- 圣盾挡下伤害时发一个 amount 为 0、shieldAbsorbed 为原伤害的 damage 事件，再发 shield_broken。
- 随机目标（random_*）只从没有将死的随从里选，可以选中潜行随从（不是指向性效果）。群体目标包括将死的随从。
- 群体目标的顺序：友方在前，各自从左到右。
- 集结（使所有友方随从 +1/+1）用 `other_friendly_minions`：法术没有"本随从"，这时就是所有友方随从。
  ActionTarget 里没有 all_friendly_minions，没有加新的。
- 召唤位置：回合开始/结束效果和 on_kill 里的召唤放最右边（spec 2.12 没列这两种时机）。
- 需要目标的战吼和连击：有合法目标时必须选，没有时随从照常入场、该效果跳过。一张卡最多一个效果声明 target
  （动作里只有一个 target 字段），这条加进了加载校验。
- 效果只有召唤的法术和英雄技能，场上满 7 个时不能使用（按"cast 效果的所有动作都是 summon"判断）。
- 沉默：攻击力、生命上限回到卡面；当前生命值只在超过新上限时降到上限，受到的伤害保留；清掉冻结并发
  unfreeze（reason 为 silence）。额外攻击次数不清（它不是增益）。
- 增减益：生命值增减同时改上限和当前值，减到 0 以下的随从随后死亡。"本回合"增益到期时，正的生命增益按
  "当前生命不超过新上限"处理；关键词只有在卡面（未沉默时）和其余增益都不提供时才移除。
- 激怒：实现为一条带 enrage 标记的增益，每次生命值或上限变化后检查，受伤时加上、回满时去掉，各发一个 buff 事件（reason 为 enrage）。
- 冻结已冻结的随从：frozenAt 改成当前回合。
- 回手：变回卡面状态的牌，放在手牌末尾。手牌满时直接销毁，发 bounce 事件（destroyed 为 true、handIndex 为 null），不发 death，不触发亡语。
- 变形：新随从分配新的 instanceId 和入场顺序，enteredTurn 为当前回合。
- extra_attack（易）：只在拥有者自己的回合生效，给本回合多一次攻击机会；对方回合里反杀照样触发 on_kill（发 trigger 事件），
  但这个动作什么也不做。它没有专门的事件，前面的 trigger 事件就是它的表现。
- 脚本卡（菲奥娜、泰达米尔）生效时发 trigger 事件，timing 为 `script`，script 字段是脚本名。spec 6.4 的 timing 列表里没有这个值，是新增的。
  菲奥娜只在对方攻击力大于 0 时发。泰达米尔的那次伤害事件 `lethalPrevented` 为 true，healthAfter 为 1。

## 事件

- 每个事件都有 `kind` 和 `group`。group 在一次 applyAction 的返回值里唯一；一个动作打到的所有目标、一次攻击的双方伤害、
  一轮死亡结算的所有 death 事件各共用一个 group。
- 在 spec 6.4 列的字段之外补了一些表现层用得上的字段，完整字段表见 `src/engine/events.ts`，测试里的
  `tests/helpers/events.ts` 逐个核对。
- 引擎自己产生、卡牌数据里没有 fx 的事件取默认值：攻击伤害 physical，疲劳 shadow，吸血治疗 holy，激怒 fire，增益到期 physical。

## 卡牌数据

- 卡牌 id 按 cards-v1 的规则起名，非英雄卡的英文名是我取的，比如 `neutral.ancient_krug`（石甲虫）、`neutral.gromp`（魔沼蛙）、
  `neutral.red_brambleback`（猩红印记）、`token.void_worm`（虚空蠕虫）、`token.anivia_egg`（冰凤凰蛋）。
- 衍生物的费用卡池里没写，回手后能从手牌打出，所以给了费用：冰凤凰蛋 0，亡骨赛恩 3，其余 1。
- fx 是我按卡的意思挑的，表现层可以再调。
- 加载校验在 spec 3.5 之外加了：卡牌 id 和名字唯一（场景 DSL 按中文名找卡）、一张卡最多一个效果声明 target、
  法术和英雄技能只能有 cast 效果、随从不能有 cast 效果、self 目标只能用在随从上。
- `createGame` 只检查卡组里的卡存在、不是衍生物和英雄技能，不强制 30 张（测试要用小卡组）；30 张、同名最多 2 张、
  职业限制由 `validateDeck` 检查，预组卡组过了这个检查。

## 测试和命令行

- `pnpm test`：Vitest。`tests/setup.ts` 打开不变量检查、装载卡池和测试专用卡（`tests/helpers/testCards.ts`，
  覆盖连击、回手、再次攻击、受伤条件、随机目标、全场目标等 M1 卡池里没有卡用到的机制）。
- `pnpm typecheck`：tsc --noEmit。
- `pnpm play`：人（玩家 0）对 L0，输入编号选动作。`--class`、`--ai-class` 选 demacia 或 freljord，`--seed` 固定种子。
- `pnpm smoke`：L0 对 L0 自动打 200 局，`--games N`、`--seed N` 可改，`--log` 打印事件。环境变量 `MELOL_INVARIANTS=1` 打开不变量检查。
- 仓库根目录的 `.npmrc` 把 registry 指回 npmjs 官方源：本机全局 npm 配置把默认源指到了一个需要鉴权的私有源，不加这个装不了依赖。

## 需要设计方确认的地方

这些都按 spec 字面实现了，列出来是因为它们会影响对局结果：

1. 特朗德尔的 -2/-2 把受伤的泰达米尔减到 0 血时，泰达米尔死亡。减益不是"受到伤害"，无尽怒火拦不住。
2. 换牌按 spec 6.5"先把换掉的牌洗回牌库、再补抽"，所以可能抽回刚换掉的牌（炉石是先抽再洗回）。
3. 死亡结算以"一个效果执行完"为单位（见上面"结算顺序"）。暴风雪打死虚空幼虫时，召唤出来的蠕虫不会被同一张暴风雪冻结。
4. 剧毒、吸血对随从自己效果里的伤害也生效（M1 卡池里没有同时带这两个关键词和伤害效果的卡，测试卡覆盖了）。
