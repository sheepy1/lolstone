# LoLstone 联机对战规格

版本 v0.4 · 2026-10-20

配合 [spec.md](spec.md) 使用。规则、事件、局面模型、表现层以 spec 为准，这里只讲联机：为什么选服务端权威、客户端接缝、逻辑模块的契约、托管、单机的去向、持久化、里程碑、测试。

修订记录：

- v0.4：按平台定稿的协议对齐（逻辑模块的类型定义、声明的 schema、本地 runner，2026-10-20）。4.1 签名按平台的 Logic 接口：setup 返回 Step、onTimeout 按座位依次调、不带 deadline 的步保留计时器、bot 返回 null 表示没事做、result 只放公开字段；4.2 座位 config 去掉昵称；4.3 批次、座位广播、结束广播、拒绝码、重连按协议重写；4.4 version 的计法；3.3 加续局和座位广播；5.1 声明写在构建设置里、模块文件上限；5.3 断线从平台发现断开起算；5.4 一个主体同时只在一局里由平台保证；5.6 bot 的节奏由平台定；5.7 加批次 60 KiB、模块 2 MB、纯 JSON；2.3 加平台的实测；第 8 节本地 runner 的形态；9.6 观众参数。
- v0.3.2：5.2 的 Table 按 M6a 的实现回写：AI 座位是 { kind: 'ai', choose, rng }，choose 能接 Worker 里的 L2 和测试里的假 AI；真人座位只有 deliver，昵称在座位配置里；apply、mask、result 在 M6a 里叫 applyMatchAction、maskMatch、matchResult，M6b 从 src/logic 原样导出。
- v0.3.1：平台规格定了三件待定的事和座位配置的形状。4.1 加 forfeit 和 setup 的入参形状；4.3 加座位间的瞬时消息；5.3 断线判负和双方都断线定稿；第 7 节回放改成用平台导出的整局记录；3.3、3.4、第 8 节的对手抬牌提示不再待定；第 8 节加平台的本地 runner，9.6 用它；第 10 节第 7 条；第 11 节去掉已定的三条。
- v0.3：联机的权威进程不自己写，改成把引擎打成"逻辑模块"交给托管平台替每一局跑（2026-10-20 的架构评审定的）。2.1 加两种落地方式的比较和选逻辑托管的理由，2.3 加一次 apply 的耗时，2.4 总图重画；3.3 RemoteMatch 改成接平台 SDK；第 4 节从 WebSocket 协议改成逻辑模块的契约；第 5 节从自建服务端改成逻辑模块与托管，去掉 ws 接入、房间、静态托管、动作日志存取，5.6 改成 bot 座位，5.7 改成 runner 的限制；第 7 节改成平台保存记录、对局跨 runner 重启；第 8 节 M6b、M6c 和"以后"；第 9 节第 1、5、6 条；第 10 节第 2、5、7、8、10 条改、加第 11 条；第 11 节相应增删。
- v0.2：按托管平台的约束对齐（2026-10-20 的架构评审）。4.1 加生产形态和缓存头；5.1 加静态托管模块和启动方式；5.4 把"玩家是谁"收成一个接口；5.6 加 CPU 预算；新增 5.7 托管环境的约束；第 7 节改成对局不跨服务端重启、回放记录下发客户端；第 8 节 M6c 和"以后"相应改；第 10 节第 2、5 条改、加第 10 条；第 11 节去掉"托管在哪"、加外部数据库和 CPU 预算。
- v0.1：初稿。方案在 2026-10-20 的设计会话里定下；2.3 的三项验证是同一天用脚本在 main（2eff29c）上跑出来的。

## 1. 目标与范围

要做到的：

- 两个人各开一个浏览器，用邀请码进同一局，打完一整局。规则、动画、音效、手感和单机完全一样。
- 对手的手牌、双方的牌库、真实的随机数永远不出托管平台替这一局跑逻辑的那个隔离环境（下面叫 runner）。开浏览器控制台拿不到。
- 断线后回到当前局面接着打。谁都不能靠断线或关页面逃掉一场败局。
- 单机对 AI 不变，不需要联网。

第一版明确不做的：

- 账号、好友、天梯分、排行榜。身份是平台 SDK 给的匿名主体，加自己填的昵称。
- 匹配队列。先用邀请码房间，队列列在"以后"。
- 观战、聊天、表情。
- 对局录像的分享。但第 7 节的回放记录就是 `?replay` 的格式，以后要做分享不用改。
- 防 DDoS、封 IP 这类运营层面的安全。那是平台的事，逻辑模块只防作弊。

## 2. 架构

### 2.1 为什么选服务端权威，为什么用逻辑托管

联机有三种做法。按隐藏信息、作弊、基础设施、改动量四项比较：

| 做法 | 对手手牌和牌库在哪 | 作弊难度 | 基础设施 | 改动量 |
| --- | --- | --- | --- | --- |
| 服务端权威：引擎在一个谁也碰不到的进程里跑，客户端只收遮过的事件和快照 | 只在权威进程里 | 要攻破权威进程 | 一个权威进程 | 对局层拆成两半，表现层不动 |
| P2P 锁步：两端各跑一份完整引擎，共用种子 | 两端都有完整局面 | 开控制台就能看 | 仍然要信令服务器撮合连接 | 两端都要同步校验，表现层不动 |
| 一端当宿主：一个客户端跑引擎，另一个连它 | 宿主有完整局面 | 宿主开控制台就能看 | 仍然要信令服务器 | 和服务端权威差不多 |

选服务端权威。后两种的隐藏信息都在某个玩家的机器上，和引擎已经做好的遮蔽（spec 6.3"隐藏信息只在视图层过滤"）背道而驰，而且省不掉服务器。

权威进程有两种落地：自己写一个 Node 服务（v0.2 之前的方案），或者把引擎打成一个确定性的逻辑模块，交给托管平台在它的 runner 里替每一局跑（逻辑托管）。v0.3 改成后者：

| | 自己写 Node 服务 | 逻辑托管 |
| --- | --- | --- |
| 自己要写的 | 逻辑、WebSocket 接入、房间、座位、计时、断线判负、重连补发、version 防撞车、静态托管、部署成 Node 应用 | 逻辑模块（第 4 节）、客户端接 SDK |
| 平台替你做的 | 托静态、CDN | 长连接、房间、邀请码、座位、身份、计时到点、断线判负、重连补发、version 防撞车、runner 重启后恢复 |
| 进行中的对局跨重启 | 做不到（托管环境没有磁盘和数据库） | 平台保存真实局面和动作日志，runner 重启后接着打 |
| AI 座位 | L0、L1、L2（L2 要 Node 适配） | L0、L1（一次调用限 50 ms，L2 的搜索跑不了） |
| 排期 | 不依赖别人 | 跟平台第一期走，lolstone 是它的验收用例 |

引擎本来就是逻辑模块要的形状：局面是纯 JSON、动作是纯函数、遮蔽已经分开，2.3 的实测也远在 runner 的限制以内（5.7）。少写五个模块和一套部署，代价只有 L2 不能当在线 AI。

### 2.2 现状里已经对齐的部分

联机改动小，是因为现有代码在这几处已经按联机的样子做了：

- 引擎是纯函数，局面是纯 JSON，随机数是局面里的种子（spec 6.3、6.5）。`src/engine`、`src/cards`、`src/ai` 在 tsconfig.json 里按 Node 环境检查，不带 DOM；命令行对局（`src/cli/play.ts`）已经在 Node 里跑引擎。逻辑模块就是这三个目录打成的一个文件（5.1）。
- 隐藏信息已经有遮蔽层。`src/engine/mask.ts` 的 maskHidden 遮对方手牌和双方牌库，maskEvents 遮事件里对方抽到、换到、回手的牌。AI 现在只看遮过的局面（`src/app/match.ts` 的 runAi），客户端联机时看到的就是同一份东西。
- 对局层已经是权威循环的雏形。`src/app/match.ts` 的 Match 持有真实局面、校验并执行动作、驱动 AI、给每方遮事件，只是把"交给导演"也揉在了一起。第 3 节把它拆开。
- 客户端不需要真实局面。合法性只看自己的手牌、双方场面和法力，隐藏信息不参与，所以在遮过的快照上调 listLegalActions，结果和真实局面一致（2.3 的验证）。

### 2.3 验证数据

三项验证都是 2026-10-20 在 main（2eff29c）上用脚本跑的，按"做法"一列能重写：

| 验证 | 做法 | 结果 |
| --- | --- | --- |
| 遮过快照上的合法动作等于真实局面 | L0 对 L0 随机对局，每个局面对双方各算一次 listLegalActions，比较 actionKey 的集合 | 60 局、11632 个局面，零差异 |
| 遮过的随机数能反推真实值 | maskHidden 把 rng 换成 forkRng 的派生流；派生用的 hash32 每一步是异或移位、乘奇数、异或盐，都可逆。写逆函数反推 | 10000 次全部反推出真实 rng 状态 |
| 动作字段类型不对能骗过引擎 | handIndex 传字符串 "0" 打一张无目标法术 | checkAction 放行，法术生效，牌没有离开手牌（手牌 6 张，打完还是 6 张） |

第一项是"客户端在快照上算合法操作、不向权威进程要列表"的依据。后两项是 5.5 两条硬规则的依据：下发的快照把 rng 置零；逻辑模块严格校验动作字段的类型，不能只靠 checkAction。

一局的数据量（L1 对 L1，seed 42）：

| 项目 | 量 |
| --- | --- |
| 动作 | 54 |
| 事件 | 223 |
| 一批里最多的事件数 | 16 |
| 遮过的快照（JSON） | 3.8 KB |
| 整局遮过的事件（JSON） | 32 KB |

快照这么小，所以每执行一个动作，runner 把整个遮过的快照连同事件一起发给客户端（4.3），客户端不必从事件里重建引擎状态。

一次 apply 的耗时（main 764fd5b，40 局自对弈：L0 和 L1 各 20 局、四个职业两两对局，共 2888 个动作；每个动作做一遍 applyAction 加双方 maskHidden 和 maskEvents；Node 22，Apple M4 Pro）：

| 项目 | 量 |
| --- | --- |
| 一次 apply | p50 0.08 ms，p99 0.24 ms，最大 0.75 ms |
| 真实局面（JSON） | 最大 5 KB |
| 遮过的局面（JSON） | 最大 4.7 KB |
| 一批里最多的事件数 | 22 |
| 一局的动作数 | 54 到 120 |

runner 的限制是一次 apply 50 ms、局面 1 MB（5.7），慢 50 倍也在里面。平台用同一份导出拼了临时入口，打成 94 KB 的单文件，在只有 ES 内置对象加 structuredClone 的隔离环境里两个 L0 机器人打完一局：91 步、7 次计时到点，apply 最长 0.32 ms，发给一个座位的一条批次最大 5.4 KB。

### 2.4 总图

```
浏览器 A                              托管平台                                                  浏览器 B
Interaction ──submit(action)──▶ SDK ──▶ 长连接服务：验主体、核对座位、限速、带上 version
    ▲                                      │
legal() 在遮过的快照上算                     ▼
    │                                   runner：一局一个隔离环境，跑逻辑模块（第 4 节）
    │                                      ├ apply：字段校验、行动方核对、checkAction、applyAction
RemoteMatch ◀──batch{version, events,      ├ mask、maskEvents：每个座位各遮一份，rng 置零      ──▶ 同样一份给 B
    │          snapshot, deadlineIn}────────┤ onTimeout：换牌、回合到点
    │                                      ├ bot：平台按节奏调它，走同一个 apply
Director → ViewState → Three.js            └ 房间、座位、计时、断线判负、重连补发、重启恢复由平台做
```

## 3. 客户端接缝

### 3.1 Match 拆成两半

今天 `src/app/match.ts` 的 Match 做了六件事：持有真实局面；校验并执行动作；驱动 AI 并在动作之间插 ai_thinking；给每方遮事件；把遮过的事件交给导演；认输和停止。前四件是权威对局的事，联机时在平台的 runner 里做（第 4 节的逻辑模块），单机时仍在浏览器做；后两件是客户端座位的事。拆法：

- `Table`（`src/server/table.ts`，5.2）：权威对局的编排。持有真实局面、version、动作日志、两个座位；调逻辑模块的 apply、mask、maskEvents，驱动 AI 座位，计时钩子。纯模块，不碰网络，浏览器和 Node 都能跑。单机的 LocalMatch 和测试里的假 runner 用它；线上由平台的 runner 做同样的事。
- `MatchSeat`（`src/app/seat.ts`，3.2）：客户端座位接口。两个实现：`LocalMatch` 在浏览器里直接持有一个 Table，对手是 AI 座位，行为和今天完全一样；`RemoteMatch` 通过平台 SDK 接 runner 里的对局。
- `src/app/game.ts` 的 GameApp 只认 MatchSeat。导演、显示局面、动画模块、场景、输入层一行不改。

### 3.2 MatchSeat 接口

就是 GameApp 今天对 Match 用到的那几个成员，加一个 result：

```ts
type MatchSeat = {
  readonly side: Side;             // 我是哪一方
  readonly initial: ViewState;     // 开局（或重连时）的显示局面
  readonly visible: GameState;     // 我看到的局面：联机是平台发来的遮过的快照，单机是真实局面
  readonly over: boolean;
  readonly result: { winner: Side | 'draw'; reason: 'game' | 'concede' | 'timeout' | 'abandon' | 'kicked' } | null;
  humanToAct(): boolean;           // 轮到我行动（换牌阶段：我还没提交）
  legalActions(): Action[] | null; // 导演忙、不轮到我、上一个动作还没回包时为 null，表示锁定
  submit(action: Action): string | null; // 不合法返回原因，不改局面
  concede(): void;
  start(director: Director): void;
  stop(): void;
  onBatch: ((events: PresentationEvent[], state: GameState) => void) | null; // 对局日志用
};
```

- 合法操作永远在 `visible` 上算。spec 6.6 的"合法操作永远来自真实局面"在联机里是"来自平台的快照"，2.3 验证过两者一致。
- `visible` 的 rng 不可用：联机时是 0，单机时也不要拿它模拟。自动驾驶（`?autoplay`）和 AI 自己有随机数流。

### 3.3 RemoteMatch 的行为

RemoteMatch 包一个平台 SDK 的对局对象（逻辑模式）。建房、进房、发动作、收批次、重连都是 SDK 的方法，RemoteMatch 不碰 WebSocket，也不管 version 和座位凭据，那两样 SDK 自己带。

- legalActions：导演在播、不轮到我、或者有一个动作已发出还没收到回包，都返回 null。一次只允许一个在途动作，避免同一个 version 发两次。
- submit：先在快照上 checkAction，不合法直接返回原因、不发送；合法就调 SDK 的 submit(action)，把自己标成"在途"，不改本地任何东西。收到 batch 或 SDK 报动作被拒后解除在途。
- 收到 batch：更新 visible、version、deadline，把 events 交给导演，调 onBatch。导演的队列和今天一样串行播放，对手的动作一批批到，自然就是对手的节奏，不需要 ai_thinking。要验证一条路径：今天 AI 对局里 card_played 之前总有 ai_thinking 先把牌抬起来，联机里没有，card_played 的动画要能从没抬起的状态直接飞出。
- 动作被拒：解除在途，控制台记警告。输入来自 listLegalActions，正常情况下不会被拒；会被拒的只有和计时器撞车（4.4）。
- concede：发逻辑模块的认输动作 `{ kind: 'concede' }`（4.2），等带 game_over 的 batch，表现层照常播失败演出。对局菜单里"回主菜单"在联机里等于认输，确认文案要说明。
- 断线：SDK 自己重连并补发漏掉的批次（4.3；runner 每个座位留最近 128 条，不够就给当前快照），RemoteMatch 照常交给导演播。页面刷新后 RemoteMatch 调 SDK 的 resume()，平台按主体和对局 id 认座位，不需要自己的座位 token；收到的是当前快照时用 `viewFromState(snapshot, side)` 建场景，不回放历史。
- 对手在线状态和抬牌：平台的座位广播（4.3）更新界面横幅和对手昵称；对手发来的 holding 瞬时消息更新场景里抬起的牌（3.4）。都不进导演队列，因为是瞬时状态，会反复变化。
- 续局：一个主体同时只占一个未结束对局的座位（5.4）。主菜单打开时问 SDK 有没有没打完的局，有就提示"续上还是离开"，离开了才能建房或进房。

### 3.4 界面

| 页面 | 改动 |
| --- | --- |
| 主菜单 | 加"联机"入口：昵称、建房、进房。昵称交给平台的进局请求，对手从座位广播里看到；建房从平台拿到邀请码；进房输邀请码。职业和卡组的选择和单机一样（预组或自组） |
| 等待页（新） | 显示邀请码，可复制；对手进来后双方自动进加载页。runner 睡着时第一次请求要等几秒，页面上要有"正在连接"的提示 |
| 加载页 | 右侧对手显示昵称和职业，不显示难度（今天是"对手 · 难度"，`src/ui/LoadingScreen.tsx`） |
| 换牌 | 不变。对手提交了没有，只影响等待提示 |
| 对局 | 结束回合按钮旁加回合倒计时：最后 15 秒出现、逐秒缩短、最后 5 秒变红并有音效，参考炉石的烧绳；对手断线时顶部横幅"对手已断线，xx 秒后判负"；对手拖着一张牌时它在对手手牌里抬起（M6c，走 4.3 的瞬时消息） |
| 结算 | 加胜负原因：对手认输、对手超时、对手离开（断线或被平台移出） |
| 对局菜单 | "回主菜单"在联机里等于认输，确认文案改成"离开就算认输，对手获胜" |

对局日志的"你 / 对手"用词（`src/ui/logText.ts`）不用改。

## 4. 逻辑模块的契约

逻辑模块是一个 ES 模块（5.1），导出一个满足平台 Logic<State, Event> 接口的对象 `logic`，方法如下。平台的 runner 替每一局调它们：开局调 setup，玩家每发一个动作调一次 apply，每一步成功后对每个座位各调一次 mask 和 maskEvents 再下发，计时到点按座位号依次调 onTimeout，断线宽限到或运营踢人时调 forfeit，每一步之后问每个 bot 座位。每个方法都是纯函数：同样的输入同样的输出，不改入参，对任何输入都不抛。一步的返回值叫 Step：`{ ok: true, state, events, deadline? }` 或 `{ ok: false, reason }`。签名以平台发布的类型定义为准，这里写的是 lolstone 怎么填。

### 4.1 导出的函数

| 函数 | 做什么 | 对应的引擎调用 |
| --- | --- | --- |
| setup({ seed, seats, options }) | 开局。seed 由平台给；seats 是每个座位的 `{ kind: 'human' \| 'bot', config }`，config 是建局或进局时客户端交的 JSON（每个不超过 4 KiB），lolstone 放 { heroClass, deck, poolHash }，bot 座位的 config 放等级；options 不用。先核对两边的 poolHash，不一致返回 ok:false、reason 'version_mismatch'，对局不开始；再 validateDeck 校验两套卡组，不合规返回一个已经结束的局面，不合规那方判负、reason invalid_deck；都过了 createGame。返回的 Step 带初始的 MatchState、开局那批事件（mulligan_start）和换牌的 60 秒 deadline | createGame |
| apply(state, seat, action) | 执行一个座位的动作，按 4.2 的顺序校验。返回 Step；不带 deadline 时平台保留正在走的计时器。拒绝的 reason 原样回给发动作的人（最长 256 字）。对任何输入都返回，不抛；抛错按模块缺陷算，连续 10 次平台会关局 | checkAction、applyAction |
| mask(state, seat) | 这个座位能看到的局面（4.5） | maskHidden，再把 rng 置零 |
| maskEvents(events, seat) | 这个座位能看到的事件 | maskEvents |
| onTimeout(state, seat) | 计时到点。平台按座位号依次调，每次传上一次之后的局面：ok:false 跳过，ok:true 生效，某一步带回新的 deadline 这一轮就停。换牌阶段：这个 seat 还没提交就替它提交"一张都不换"，已提交返回 ok:false；对局阶段：game.current 等于 seat 才替它执行 end_turn，否则 ok:false | applyAction |
| forfeit(state, seat, reason) | 平台发起的判负：断线宽限到（abandon）或运营踢人（kicked）。不走引擎，把 game 换成 phase over、对方获胜，reason 照填，合成一条只有 game_over 的事件 | 无 |
| result(state) | 对局结束了返回 `{ winner, reason }`，没结束返回 null。reason 是 game、concede、timeout、abandon、kicked。返回值会原样广播给所有座位，只放这两样 | state.phase、state.winner |
| bot(state, seat) | 可选。bot 座位的下一步动作，现在没事做返回 null。每一步之后平台都问一次，出手前等声明里的 botDelayMs（默认 1 秒），再按那个座位走 apply。只用 L0、L1（5.6），等级从 setup 时该座位的 config 来 | l0ChooseAction、l1ChooseAction |

MatchState 是引擎的 GameState 外面包一层（M6a 已定义在 `src/server/table.ts`，M6b 挪到 `src/logic`）：`{ game: GameState, log: { seat, action, at }[], reason: Reason | null, bots }`。log 是动作日志（一局最多 120 条），reason 是结束原因，bots 记每个 bot 座位的等级。State 和事件都必须是纯 JSON（没有 undefined、函数、Map、Set）：平台每一步之后把它序列化存起来，runner 重启后装回。mask 只留遮过的 game 和 reason，log 和 bots 不下发，客户端从快照里读结果。

deadline 是"距现在多少毫秒"，由逻辑模块按 5.3 的表算，平台存成到期时刻、到点调 onTimeout，并把剩余时间作为 deadlineIn 发给客户端。只有一个 deadline：换牌阶段是开局起 60 秒，双方共用；对局阶段是当前回合的 75 秒。Step 不带 deadline 时平台保留正在走的计时器，所以先提交换牌的一方那一步不带 deadline，共用的 60 秒照走；进入对局阶段和每次换人时带上 75 秒的新计时。

### 4.2 客户端发的动作

就是 spec 6.5 的 Action，加一个模块级的 `{ kind: 'concede' }`：认输不进引擎，apply 收到它把 game 换成 `{ ...game, phase: 'over', winner: 对方 }`，reason 记 concede，合成一条只有 game_over 的事件。和今天 Match.concede 的做法一样，表现层不区分胜负从哪来。

apply 的校验顺序，每一步失败都返回原因、不改局面：

1. 对局已结束：拒 'over'。
2. 动作的字段严格校验类型：kind 在六种之内；handIndex、position、replace 里的每一项、instanceId 都是非负整数；没有多余字段；整个动作是对象不是别的。拒 'malformed'。平台只保证送进来的是这一局某个座位发的、是 JSON、不超过 4 KiB、不超过速率，其余全是这里的事。
3. 行动方核对：换牌阶段要求 action.kind 是 mulligan 且 action.player 等于 seat；对局阶段要求 game.current 等于 seat。拒 'not your turn'。引擎自己不做这一步，见 5.5。
4. checkAction：拒，原因照引擎的。
5. applyAction。state 换成新局面，log 追加一条。phase 或 current 变了就算新的 deadline。

version 由平台管（4.4），apply 看不到它。

### 4.3 客户端收的批次

| 消息 | 字段 | 什么时候收 |
| --- | --- | --- |
| 批次 | version、seat、cause、events、snapshot、deadlineIn、requestId | 每一步之后每个座位各收一条，各自遮过；遮完 events 是空的也发，所以每个座位收到的 version 连续。cause 是这一步怎么来的：setup（开局，events 是开局那批）、action、timeout、bot、forfeit、resume（恢复时补的当前快照，不是新的一步）。requestId 只在这一步是自己的动作时有。对局结束时 snapshot 的 reason 已填 |
| 座位广播 | version、started、seats[{ seat, kind, player, nickname, connected, graceIn, out }] | 开局、座位的连接状态变化、有人被判负或踢出时广播。开局那条和 cause 为 setup 的批次一起到；对手的昵称和在场状态从这里来；graceIn 是断线判负前剩的毫秒数；out 是已被判负或踢出。座位的 config 永远不在这里 |
| 结束广播 | version、reason、result | reason 是 result（某一步之后 result 非空，前面总有一条带最终快照的批次）、forfeit（模块没有 forfeit 时平台替判）、abandoned（空局）、module_error、setup_rejected（setup 返回 ok:false，detail 带原因）。result 就是 result() 的返回值 |
| 动作被拒 | requestId、code、reason、version | stale（和计时到点撞车）和 invalid（apply 返回的原因原样，含 'not your turn'）：解除在途、控制台记警告。rate_limited、too_large、bad_envelope、not_seated、not_started、ended、module_error、unavailable：客户端或 SDK 的缺陷，或平台暂时不可用，控制台报错 |
| 瞬时消息 | type、data、from | 对局通道上座位之间互发，不经 runner、不存、不保证送达（SDK 的 send 和 on('message')）；类型名不能以 $ 开头，收件人用座位广播里的玩家 id。第一版只有 holding：正在拖哪张手牌的 instanceId，null 是放下（M6c） |
| 重连 | 漏掉的每一条批次，或者一条 cause 为 resume 的当前快照 | SDK 每次订上通道都带已收到的 version 发恢复请求；runner 每个座位留最近 128 条批次，还在就按顺序补发；不在了（runner 重启过、刷新页面没有本地状态、间隔太久）就给当前快照 |

具体的消息名和字段名以平台 SDK 为准，RemoteMatch 在这一层做翻译。

### 4.4 version 与并发

- version 是这一局已执行的步数，由平台维护：setup 之后为 0，每次 apply 成功（玩家的或 bot 的）、onTimeout 成功、forfeit 各加一，被拒的不加，每条批次带新的 version。SDK 看到跳号就自己发恢复请求。
- SDK 发动作时带上客户端正在操作的 version。平台收到时 version 不等于当前的，直接拒 'stale'，不调 apply。回合制下只有当前方能动，撞车只有一种情况：回合计时器到点替玩家结束回合的同时，玩家的动作在路上。有了 version 这个动作被拒，玩家看到的是回合已经结束，不会在下一回合的局面上执行上一回合的动作。
- 客户端一次只有一个在途动作（3.3）。
- 同一局的动作在 runner 里串行执行，apply 是同步的，不会交错。

### 4.5 快照

snapshot 是 `maskHidden(game, seat)` 再把 `rng` 置成 `{ s: 0 }`，外面带上 MatchState 的 reason。里面有：我的手牌（真实 id）、对手手牌（占位牌，保留 instanceId，张数可见）、双方牌库（占位牌，只有张数）、双方场面、英雄、法力、phase、turn、current、winner、双方 mulliganDone；对手还没执行的换牌选择被 maskHidden 清掉。客户端只用它算合法操作和显示，永远不在它上面调 applyAction。

## 5. 逻辑模块与托管

### 5.1 模块

```
src/logic/index.ts       逻辑模块入口：导出满足平台 Logic 接口的 logic 对象（setup、apply、mask、maskEvents、onTimeout、forfeit、result、bot）。只引 engine、cards、ai 的 l0 和 l1
src/logic/validate.ts    动作字段校验（4.2 第 2 步）
src/logic/timeouts.ts    deadline 怎么算、onTimeout 替谁做什么（5.3）
src/server/table.ts      Table：浏览器里的权威对局编排（单机）和测试里的假 runner；调的是同一份 src/logic
src/app/seat.ts          MatchSeat
src/app/localMatch.ts    LocalMatch
src/app/remoteMatch.ts   RemoteMatch：包平台 SDK
scripts/build-logic.ts   把 src/logic 打成一个不带依赖的 ES 文件 dist-logic/logic.js，交给平台
```

- 逻辑模块跑在只有 ES 内置对象加平台注入的 structuredClone 的隔离环境里，没有 Node 和 Web API。`src/engine`、`src/cards`、`src/ai` 的 l0 和 l1 只用 ES 内置对象，模块之间只有相对引用、没有第三方包（2026-10-20 查过）；唯一碰到的全局是 `src/engine/invariants.ts` 读 `process.env`，有 `typeof process` 保护，在隔离环境里就是关闭不变量检查。
- 模块级初始化只有装卡池（installCardPool），加载时跑一次。平台构建时拒绝引用了 Node 或 Web 全局对象的模块，并在隔离环境里加载一遍确认能跑；本地用 9.5 的测试先过一遍。打包后的文件上限 2 MB，现在 94 KB。
- 页面和逻辑模块从同一个提交构建、一起发布，卡池哈希（poolHash）两边一致；客户端缓存了旧页面时 setup 会发现不一致（4.1）。
- 声明写在托管平台的构建设置里（平台也接受仓库里的声明文件，lolstone 不用，仓库里不留平台的东西）：入口 dist-logic/logic.js、座位 2 到 2、断线宽限 60 秒、空局关闭 10 分钟、bot 出手前等 1 秒（默认）、对局结束后导出整局记录（第 7 节）。本机开发命令读同一份声明，文件名由命令行参数给；这个文件和本机快照目录都用 .git/info/exclude 排除，不进 .gitignore。

### 5.2 Table

```ts
type Seat =
  | { kind: 'human'; deliver: (batch: Batch) => void }
  | { kind: 'ai'; choose: AiChooser; rng: RngState };   // choose 可以是异步的，接 Worker 里的 L2 和测试里的假 AI

class Table {
  state: MatchState;                // 真实局面（4.1）
  version = 0;
  readonly seats: [Seat, Seat];
  deadline: number | null;          // 当前计时的到期时刻
  submit(seat: Side, version: number, action: unknown): { ok: true } | { ok: false; reason: string };
  timeout(): void;                  // 计时到点，调 onTimeout
  snapshotFor(seat: Side): Snapshot;
}
```

submit 做的事就是平台的 runner 做的事：version 不等于自己的拒 'stale'，否则调 apply（M6a 里叫 applyMatchAction，连同 maskMatch、matchResult 放在 table.ts，M6b 从 src/logic 原样导出成 apply、mask、result）；成功就 version 加一，给每个座位发 batch（events 是 maskEvents 遮过的，snapshot 是 mask 的，deadlineIn 按 deadline 算），AI 座位的"发"就是按节奏调它的 choose（5.6）；phase 或 current 变了就重置计时器。Table 自己不校验动作、不核对行动方，那些都在 apply 里，这样单机和线上走的是同一段代码。

### 5.3 计时与断线

| 事项 | 数值 | 到点做什么 | 谁做 |
| --- | --- | --- | --- |
| 换牌 | 60 秒，从 setup 起算，双方共用一个 deadline | 平台按座位号依次调 onTimeout，每个还没提交的座位各替它提交"一张都不换" | 逻辑模块算 deadline，平台到点调 |
| 回合 | 75 秒，从开始这一回合的那次 apply 起算 | onTimeout 只在 seat 是当前方时替它执行 end_turn | 同上 |
| 断线宽限 | 60 秒，从平台发现断开起算：标签页正常关闭立刻发现，断网要等心跳超时，晚 33 到 60 秒 | 平台调 forfeit(state, seat, 'abandon')，对手获胜 | 平台计时（声明里写），逻辑模块合成结果 |
| 双方都断线 | 10 分钟 | 平台把对局关成作废，没有结果，不进逻辑模块 | 平台 |
| 等待页没人进 | 10 分钟 | 房间释放 | 平台 |

- 到期时刻只在平台算。发给客户端的是 deadlineIn（距离到期还有几毫秒），客户端用本地时钟倒数，不做时钟同步。两个座位收到同一个 deadlineIn，对手也看得到倒计时。
- 计时器到点和玩家的动作撞车由 version 解决（4.4）：玩家的动作先到，onTimeout 这次到点作废。
- 断线期间回合计时照跑。断线的人轮到自己时 75 秒后会被替结束回合，但宽限 60 秒先到，所以实际是先判负。
- 断线的那一方重连成功就清掉宽限，对手收到在场事件。

### 5.4 房间与身份

- 身份：平台 SDK 给的匿名主体，同一个浏览器在同一个 host 上稳定，清 cookie 才变；以后换平台账号。昵称自己填，存 localStorage 的 lolstone.player，进局时交给平台的进局请求，对手从座位广播里看到，不放进座位 config。"玩家是谁"客户端不自报，逻辑模块也不管，apply 的 seat 参数永远来自平台。
- 房间、邀请码、座位、重连都是平台的。客户端建房或进房时把 { heroClass, deck, poolHash } 作为座位 config 交给平台（只在平台和 runner 里，不发给任何客户端），人类座位都到齐且都在线时平台调 setup。建房的人是 0 号位，人类座位按进局先后排，bot 座位排在最后。
- 开局：setup 先用 `src/cards` 的 validateDeck 校验两套卡组，不合规的那一方直接判负，reason 是 invalid_deck；客户端在建房、进房前用同一个 validateDeck 先查一遍，正常不会走到这一步。poolHash 两边不一致时 setup 返回 ok:false、reason version_mismatch，对局不开始，客户端收到 setup_rejected 的结束广播后提示刷新。seed 由平台给。先后手由 seed 决定（spec 2.2），和座位号无关。
- 一个主体同时只占一个未结束对局的座位，平台保证：再建房或进房被拒（already_in_match），要先离开上一局。客户端不用自己防重，只在主菜单提示续局（3.3）。

### 5.5 安全校验

这几条是硬规则，少一条就有可作弊的口子：

1. seat 永远来自平台。长连接服务验过主体、runner 核对过座位才调 apply，动作里不带 side，带了也不看。
2. 行动方核对由 apply 做。引擎的 Action 里出牌、攻击、英雄技能、结束回合都不带玩家字段，checkAction 把 state.current 当作行动方（`src/engine/actions.ts`）。不核对的话，对手在你的回合发 end_turn 就能替你结束回合。
3. 动作字段严格校验类型，不能只靠 checkAction。2.3 的第三项验证：handIndex 传字符串 "0"，checkAction 用 actionKey 拼字符串比对、能过，applyAction 里 `filter((_, i) => i !== action.handIndex)` 用严格不等、过滤不掉，法术生效了牌还在手里。校验规则在 4.2 第 2 步。M6a 顺手把 checkAction 也加上整数检查，单机和测试也受益。
4. 下发的快照 rng 置零。2.3 第二项：maskHidden 的派生随机数可逆。
5. 卡组用 validateDeck 校验再建局；卡池版本用 poolHash 核对（5.4）。
6. 限速和大小由平台做：每座位每秒 10 个动作，单个动作 4 KiB。
7. 真实局面不出 runner，是平台的硬规则：发给客户端的只有 mask 和 maskEvents 的结果；平台的日志、给作者和运营看的页面、以后的调试工具都只拿遮过的；真实局面和动作日志只在 runner 内存和平台为重启恢复存的库里，不给任何人看。

### 5.6 bot 座位

- 建局时可以指定某些座位是 bot，等级放在那个座位的 config 里。每一步之后平台问每个 bot 座位 `bot(state, seat)`，没事做返回 null；有动作就等声明里的 botDelayMs（默认 1 秒）再走同一个 apply，一次只处理一个 bot 动作；被 apply 拒了这一步之后不再问它。一次调用限 50 ms，L0、L1 可以（L1 一步在桌面机上远小于 1 ms），L2 的搜索跑不了，只留在单机。
- bot 的对局里没有 ai_thinking：bot 只返回动作，抬牌的演出是今天单机 Match 插进去的。联机里 bot 和真人对手一样，card_played 从没抬起的状态直接飞出（3.3）。单机的 AI 节奏不变。
- 用处：一个人在线练习。掉线是否由 bot 接管而不是判负，列在待定。

### 5.7 runner 的限制

逻辑模块跑在平台的 runner 里。下面这些是设计的前提，不是待定；右边是 lolstone 的量：

| 限制 | lolstone |
| --- | --- |
| 隔离环境只有 ES 内置对象加注入的 structuredClone，没有 Node 和 Web API；模块级初始化加载时跑一次 | 引擎、卡牌、L0 和 L1 只用 ES 内置对象（5.1）；初始化只有装卡池 |
| 一次 apply、onTimeout、forfeit、bot 各 50 ms，setup、mask、maskEvents、result 同样 | apply 最大 0.75 ms（2.3）；L1 一步远小于 1 ms |
| 局面 1 MB | 5 KB |
| 2 到 8 个座位 | 2 |
| 每座位每秒 10 个动作，单个动作 4 KiB | 一局 54 到 120 个动作，真人几秒一个；最大的动作是换牌的 replace 列表 |
| apply 抛错按模块缺陷算，同一局连续 10 次关局 | apply 对任何输入都返回拒绝、不抛（4.2） |
| 真实局面只在 runner 内存和平台的库里 | 对局结束后平台导出整局记录（seed 加动作），回放用它（第 7 节） |
| runner 空闲会睡，第一次请求要等几秒 | 等待页有"正在连接"提示（3.4） |
| 发给一个座位的一条批次（遮过的快照加这批事件）60 KiB，超了先丢事件只发快照 | 最大 5.4 KB（2.3） |
| 打包后的模块文件 2 MB | 94 KB |
| State 和事件必须是纯 JSON，平台每一步之后序列化存起来 | 引擎局面本来就是纯 JSON（spec 6.3） |

## 6. 单机的去向

- LocalMatch 在浏览器里直接 new 一个 Table，0 号位是人，1 号位是 AI 座位。Table 在浏览器里跑就是今天 Match 做的事，连 ai_thinking 的插入也在里面，所以单机的手感、AI 节奏、`?autoplay`、回放夹具、/dev/fx 调试台都不变。
- 单机不需要联网。连不上平台只影响联机入口。
- Table 和平台的 runner 调的是同一份 `src/logic`。它只依赖 engine、cards、ai，没有 DOM。L2 只在单机的 AI 座位里用，Worker 适配是唯一按环境分开的地方。

## 7. 持久化与回放

- 真实局面和动作日志由平台保存，用来在 runner 重启后恢复进行中的对局；不给任何人看（5.5 第 7 条）。逻辑模块不为重启做任何事：平台把存的 MatchState 装回 runner，接着调 apply 就行，这是引擎局面是纯 JSON 带来的。
- 整局记录：声明里打开"对局结束后导出"，这一局的座位在结束后能从平台拿 `{ seed, options, seats, actions: [{ seat, action, at }], result }`，真实局面不给。引擎确定性（spec 2.11），seed、两套卡组加逐条动作就能重建任意时刻的局面，所以这就是完整的回放记录；MatchState 里的 log 是同一份东西，留着给假 runner 的测试用。
- 回放：客户端拿到记录后 createGame 加逐条 applyAction 重放一遍，把每批事件按自己的座位 maskEvents 记下来，就是 `src/presentation/fixture.ts` 的 ReplayFixture，页面带 `?replay` 的回放路径不用改；存进 localStorage 或让玩家下载。记录里的 seed 能重建对手的手牌，对局打完了看没关系。不用客户端攒事件。

## 8. 里程碑

| 阶段 | 内容 | 完成标准 |
| --- | --- | --- |
| M6a 接缝 | Match 拆成 Table 和 LocalMatch，抽出 MatchSeat；checkAction 加字段整数检查；不联网 | 单机行为不变：现有测试全过，浏览器自动对局 5 局 0 报错，/dev/fx 和 ?replay 照常；Table 用两个假座位的单测过（9.1） |
| M6b 联机可玩 | 逻辑模块（src/logic：setup、apply 和字段校验、mask、maskEvents、onTimeout、result、认输、bot）、打成单文件、假 runner 测试、RemoteMatch 接平台 SDK、主菜单联机入口、等待页、倒计时、结算原因 | 平台的验收：两个浏览器凭邀请码打完一局；刷新后接着打；断线 60 秒判负；开控制台拿不到对手的手牌和牌库；runner 重启后进行中的局能接着打。加上 9.1 到 9.5 的测试过 |
| M6c 打磨 | 烧绳音效和画面、整局记录导出和回放下载、bot 座位的在线练习入口、对手抬牌提示（瞬时消息）、匹配队列 | 对局结束后能在 ?replay 看回放；一个人对 bot 座位打完一局；9.6 过 |
| 以后 | 账号、天梯、观战、分享回放 | 另写 |

M6b 的逻辑模块和假 runner 测试不依赖平台，可以先做；逻辑模块的类型定义和声明的 schema 平台已经定稿（2026-10-20），按它打包。平台会先给一个本地 runner：本机开发命令在 Vite 前面起代理，同一个进程里跑逻辑模块，限额和云端一样，带一个说长连接协议的本机服务，客户端连本机和连云端是同一份代码，不等云端就能在本机打完一局；本机的开发页能看真实局面和每个座位的快照，还能模拟 runner 重启。平台验收要等第一期的逻辑模式上线，lolstone 是它的验收用例。

## 9. 测试

1. Table 单测：两个假座位，断言行动方核对、stale version、字段类型、onTimeout 替结束回合和替换牌、认输、换牌双方各自提交、AI 座位打完一局。Table 和逻辑模块都是纯模块，这些都在 Node 里跑。
2. 属性测试：随机 L0 对局的每个局面，对双方各算一次，`listLegalActions(maskHidden(s, side), side)` 的 actionKey 集合等于真实局面的。就是 2.3 第一项，进 tests。
3. 遮蔽：扩 `tests/presentation-mask.test.ts`，断言 mask 的 rng.s 为 0、对手手牌和双方牌库都是占位牌、对手的 mulliganReplace 不出现、MatchState 的 log 不出现在快照里。
4. 动作模糊测试：handIndex 为字符串、负数、小数、NaN，多余字段，replace 里混字符串，不是对象的动作，都被 apply 拒绝且局面不变，并且 apply 不抛。
5. 隔离环境加载：用 `node:vm` 造一个只有 ES 内置对象加 structuredClone 的上下文，加载打包后的 dist-logic/logic.js，用假 runner 按脚本打完一局；中途把 MatchState 序列化再装回去，接着打，结果和不中断的一致（模拟 runner 重启）。
6. 浏览器冒烟：两个标签页带 `?autoplay`，再各带本地 runner 要求的不同观众参数（同一个浏览器的标签页共享 cookie，会被当成同一个人），用本地 runner 打完一局，控制台 0 报错；平台上线后用两个浏览器在云端再跑一次。

## 10. 已经定下的选择

都可以改，改了说一声是哪条。

1. 服务端权威，不做 P2P 和宿主模式。理由见 2.1。
2. 引擎打成逻辑模块交给托管平台的 runner 跑，不自己写 Node 服务，不部署 Node 应用。房间、座位、身份、计时到点、断线判负、重连补发、重启恢复都用平台的。理由见 2.1 的第二张表。
3. 每批都带整个遮过的快照，客户端不从事件重建引擎状态。依据是 2.3 的数据量。
4. 客户端在快照上算合法操作，不向平台要列表。依据是 2.3 的第一项验证。
5. 第一版不做账号。身份是平台 SDK 的匿名主体，以后换平台账号；昵称自己填。邀请码房间和重连都是平台的，不自己发座位 token。
6. 回合 75 秒、换牌 60 秒、断线宽限 60 秒。回合时长取炉石的。
7. 认输、超时、弃局都是逻辑模块合成的 game_over 事件：认输是模块级动作 `{ kind: 'concede' }`，断线判负和踢人是平台调 forfeit，都不进引擎；表现层不区分来源，结算面板显示原因。
8. ai_thinking 只在单机对局里出现。联机里真人和 bot 座位的节奏都是真实等待。
9. 对手在线状态不进导演队列。
10. 进行中的对局跨 runner 重启，由平台恢复；逻辑模块不为此做任何事。依据是第 7 节。
11. 回合制，不写平台给实时类游戏的 tick。

## 11. 待定

- 对手提示的粒度：只抬牌，还是连目标箭头也同步。
- 掉线后允许 bot 接管，还是一律判负。
- 匹配队列和天梯分。
