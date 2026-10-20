# LoLstone 联机对战规格

版本 v0.2 · 2026-10-20

配合 [spec.md](spec.md) 使用。规则、事件、局面模型、表现层以 spec 为准，这里只讲联机：为什么选服务端权威、客户端接缝、协议、服务端、单机的去向、持久化、里程碑、测试。

修订记录：

- v0.2：按托管平台的约束对齐（2026-10-20 的架构评审）。4.1 加生产形态和缓存头；5.1 加静态托管模块和启动方式；5.4 把"玩家是谁"收成一个接口；5.6 加 CPU 预算；新增 5.7 托管环境的约束；第 7 节改成对局不跨服务端重启、回放记录下发客户端；第 8 节 M6c 和"以后"相应改；第 10 节第 2、5 条改、加第 10 条；第 11 节去掉"托管在哪"、加外部数据库和 CPU 预算。
- v0.1：初稿。方案在 2026-10-20 的设计会话里定下；2.3 的三项验证是同一天用脚本在 main（2eff29c）上跑出来的。

## 1. 目标与范围

要做到的：

- 两个人各开一个浏览器，用邀请码进同一局，打完一整局。规则、动画、音效、手感和单机完全一样。
- 对手的手牌、双方的牌库、真实的随机数永远不出服务端。开浏览器控制台拿不到。
- 断线后回到当前局面接着打。谁都不能靠断线或关页面逃掉一场败局。
- 单机对 AI 不变，不需要服务端。

第一版明确不做的：

- 账号、好友、天梯分、排行榜。身份只到"昵称加本机生成的随机 id"。
- 匹配队列。先用邀请码房间，队列列在"以后"。
- 观战、聊天、表情。
- 对局录像的分享。但第 7 节的动作日志本身就是回放格式，以后要做分享不用改存法。
- 防 DDoS、封 IP 这类运营层面的安全。自己和朋友玩，服务端只防作弊。

## 2. 架构

### 2.1 为什么选服务端权威

联机有三种做法。按隐藏信息、作弊、基础设施、改动量四项比较：

| 做法 | 对手手牌和牌库在哪 | 作弊难度 | 基础设施 | 改动量 |
| --- | --- | --- | --- | --- |
| 服务端权威：引擎在服务端跑，客户端只收遮过的事件和快照 | 只在服务端 | 要攻破服务端 | 一个 WebSocket 服务 | 对局层拆成两半，表现层不动 |
| P2P 锁步：两端各跑一份完整引擎，共用种子 | 两端都有完整局面 | 开控制台就能看 | 仍然要信令服务器撮合连接 | 两端都要同步校验，表现层不动 |
| 一端当宿主：一个客户端跑引擎，另一个连它 | 宿主有完整局面 | 宿主开控制台就能看 | 仍然要信令服务器 | 和服务端权威差不多 |

选服务端权威。后两种的隐藏信息都在某个玩家的机器上，和引擎已经做好的遮蔽（spec 6.3"隐藏信息只在视图层过滤"）背道而驰，而且省不掉服务器。

### 2.2 现状里已经对齐的部分

联机改动小，是因为现有代码在这几处已经按联机的样子做了：

- 引擎是纯函数，局面是纯 JSON，随机数是局面里的种子（spec 6.3、6.5）。`src/engine`、`src/cards`、`src/ai` 在 tsconfig.json 里按 Node 环境检查，不带 DOM；命令行对局（`src/cli/play.ts`）已经在 Node 里跑引擎。服务端可以直接 import 这三个目录。
- 隐藏信息已经有遮蔽层。`src/engine/mask.ts` 的 maskHidden 遮对方手牌和双方牌库，maskEvents 遮事件里对方抽到、换到、回手的牌。AI 现在只看遮过的局面（`src/app/match.ts` 的 runAi），客户端联机时看到的就是同一份东西。
- 表现层只吃事件，不反查引擎（spec 5.8、6.4）。显示局面落后真实局面，追上之前锁输入（spec 6.6）。网络延迟只是让"落后"多了几十毫秒，不需要客户端预测。
- 对局层已经是服务端循环的雏形。`src/app/match.ts` 的 Match 持有真实局面、校验并执行动作、驱动 AI、给每方遮事件，只是把"交给导演"也揉在了一起。第 3 节把它拆开。
- 客户端不需要真实局面。合法性只看自己的手牌、双方场面和法力，隐藏信息不参与，所以在遮过的快照上调 listLegalActions，结果和真实局面一致（2.3 的验证）。

### 2.3 验证数据

三项验证都是 2026-10-20 在 main（2eff29c）上用脚本跑的，按"做法"一列能重写：

| 验证 | 做法 | 结果 |
| --- | --- | --- |
| 遮过快照上的合法动作等于真实局面 | L0 对 L0 随机对局，每个局面对双方各算一次 listLegalActions，比较 actionKey 的集合 | 60 局、11632 个局面，零差异 |
| 遮过的随机数能反推真实值 | maskHidden 把 rng 换成 forkRng 的派生流；派生用的 hash32 每一步是异或移位、乘奇数、异或盐，都可逆。写逆函数反推 | 10000 次全部反推出真实 rng 状态 |
| 动作字段类型不对能骗过引擎 | handIndex 传字符串 "0" 打一张无目标法术 | checkAction 放行，法术生效，牌没有离开手牌（手牌 6 张，打完还是 6 张） |

第一项是"客户端在快照上算合法操作、不向服务端要列表"的依据。后两项是 5.5 两条硬规则的依据：下发的快照把 rng 置零；服务端严格校验动作字段的类型，不能只靠 checkAction。

一局的数据量（L1 对 L1，seed 42）：

| 项目 | 量 |
| --- | --- |
| 动作 | 54 |
| 事件 | 223 |
| 一批里最多的事件数 | 16 |
| 遮过的快照（JSON） | 3.8 KB |
| 整局遮过的事件（JSON） | 32 KB |

快照这么小，所以每执行一个动作，服务端把整个遮过的快照连同事件一起发给客户端（4.4），客户端不必从事件里重建引擎状态。

### 2.4 总图

```
浏览器 A                                服务端：Node，一局一个 Table                 浏览器 B
Interaction ──submit(action)──▶ ws ──▶ Table.submit(side, version, action)
    ▲                                   ├ 字段类型校验；核对 side 是否等于 state.current
legal() 在遮过的快照上算                  ├ checkAction、applyAction 在真实局面上跑
    │                                   ├ 给每个座位各自 maskEvents、maskHidden，rng 置零
RemoteMatch ◀──{version, 事件, 快照}────┤ 回合计时、认输、断线判负                  ──▶ 同样一份给 B
    │                                   └ AI 座位：ChooseAction 直接接上
Director → ViewState → Three.js
```

## 3. 客户端接缝

### 3.1 Match 拆成两半

今天 `src/app/match.ts` 的 Match 做了六件事：持有真实局面；校验并执行动作；驱动 AI 并在动作之间插 ai_thinking；给每方遮事件；把遮过的事件交给导演；认输和停止。前四件是权威对局的事，联机时在服务端做，单机时仍在浏览器做；后两件是客户端座位的事。拆法：

- `Table`（`src/server/table.ts`，5.2）：权威对局。持有真实局面、version、动作日志、两个座位；执行动作、遮蔽、驱动 AI 座位、计时钩子。纯模块，不碰网络，浏览器和 Node 都能跑。
- `MatchSeat`（`src/app/seat.ts`，3.2）：客户端座位接口。两个实现：`LocalMatch` 在浏览器里直接持有一个 Table，对手是 AI 座位，行为和今天完全一样；`RemoteMatch` 通过 WebSocket 接服务端的 Table。
- `src/app/game.ts` 的 GameApp 只认 MatchSeat。导演、显示局面、动画模块、场景、输入层一行不改。

### 3.2 MatchSeat 接口

就是 GameApp 今天对 Match 用到的那几个成员，加一个 result：

```ts
type MatchSeat = {
  readonly side: Side;             // 我是哪一方
  readonly initial: ViewState;     // 开局（或重连时）的显示局面
  readonly visible: GameState;     // 我看到的局面：联机是服务端发来的遮过的快照，单机是真实局面
  readonly over: boolean;
  readonly result: { winner: Side | 'draw'; reason: 'game' | 'concede' | 'timeout' | 'abandon' } | null;
  humanToAct(): boolean;           // 轮到我行动（换牌阶段：我还没提交）
  legalActions(): Action[] | null; // 导演忙、不轮到我、上一个动作还没回包时为 null，表示锁定
  submit(action: Action): string | null; // 不合法返回原因，不改局面
  concede(): void;
  start(director: Director): void;
  stop(): void;
  onBatch: ((events: PresentationEvent[], state: GameState) => void) | null; // 对局日志用
};
```

- 合法操作永远在 `visible` 上算。spec 6.6 的"合法操作永远来自真实局面"在联机里是"来自服务端的快照"，2.3 验证过两者一致。
- `visible` 的 rng 不可用：联机时是 0，单机时也不要拿它模拟。自动驾驶（`?autoplay`）和 AI 自己有随机数流。

### 3.3 RemoteMatch 的行为

- legalActions：导演在播、不轮到我、或者有一个动作已发出还没收到回包，都返回 null。一次只允许一个在途动作，避免同一个 version 发两次。
- submit：先在快照上 checkAction，不合法直接返回原因、不发送；合法就发 `action {version, action}`，把自己标成"在途"，不改本地任何东西。收到 batch 或 rejected 后解除在途。
- 收到 batch：更新 visible、version、deadline，把 events 交给导演，调 onBatch。导演的队列和今天一样串行播放，对手的动作一批批到，自然就是对手的节奏，不需要 ai_thinking。要验证一条路径：今天 AI 对局里 card_played 之前总有 ai_thinking 先把牌抬起来，联机里没有，card_played 的动画要能从没抬起的状态直接飞出。
- 收到 rejected：解除在途，控制台记警告。输入来自 listLegalActions，正常情况下不会被拒；会被拒的只有和计时器撞车（4.4）。
- concede：发 concede，等服务端回带 game_over 的 batch，表现层照常播失败演出。对局菜单里"回主菜单"在联机里等于认输，确认文案要说明。
- 断线：WebSocket 关闭后指数退避重连（1、2、4、8 秒，之后每 8 秒），连上发 `resume {seatToken, version}`，服务端补发漏掉的批次（4.3），导演接着播。页面刷新后 localStorage 的 lolstone.seat 里还有座位 token 和 matchId，直接 resume 且 version 为 null，服务端发当前快照，客户端用 `viewFromState(snapshot, side)` 建场景，不回放历史。
- 对手在线状态：`opponent` 消息更新界面横幅和场景里对手抬起的牌（3.4）。不进导演队列，因为它是瞬时状态，会反复变化。

### 3.4 界面

| 页面 | 改动 |
| --- | --- |
| 主菜单 | 加"联机"入口：昵称、建房、进房。建房得到邀请码；进房输邀请码。职业和卡组的选择和单机一样（预组或自组） |
| 等待页（新） | 显示邀请码，可复制；对手进来后双方自动进加载页 |
| 加载页 | 右侧对手显示昵称和职业，不显示难度（今天是"对手 · 难度"，`src/ui/LoadingScreen.tsx`） |
| 换牌 | 不变。对手提交了没有，只影响等待提示 |
| 对局 | 结束回合按钮旁加回合倒计时：最后 15 秒出现、逐秒缩短、最后 5 秒变红并有音效，参考炉石的烧绳；对手断线时顶部横幅"对手已断线，xx 秒后判负"；对手拖着一张牌时它在对手手牌里抬起（M6c） |
| 结算 | 加胜负原因：对手认输、对手超时、对手离开 |
| 对局菜单 | "回主菜单"在联机里等于认输，确认文案改成"离开就算认输，对手获胜" |

对局日志的"你 / 对手"用词（`src/ui/logText.ts`）不用改。

## 4. 协议

### 4.1 传输

- WebSocket，一帧一条 JSON 消息，`t` 字段是消息类型。消息类型放 `src/net/protocol.ts`，客户端和服务端共用同一份类型，不手写两遍。
- 服务端每 15 秒 ping，连续两次没有 pong 就当断线。客户端同样判断。
- 单条消息最大 16 KB。最大的客户端消息是卡组（30 个卡牌 id），远小于这个数；超过直接断开。
- 开发时 Vite 的 `server.proxy` 把 `/ws` 转到服务端（默认 8787 端口），页面和服务端同源，不用处理跨域。
- 生产时页面和服务端在同一个 Node 进程、同一个 host：服务端托 `dist/` 的静态产物，在 `/ws` 收 WebSocket，和开发形态一致。自己的路由只用 `/ws` 和自己的前缀，不碰托管平台保留的路径前缀。
- 静态产物的缓存头由服务端给：`/assets/` 下带内容哈希的文件 `public, max-age=31536000, immutable`，HTML 和其他文件 `no-cache`。托管平台前面有 CDN，按响应头缓存（5.7）。
- 链路上 WebSocket 的空闲上限按 10 分钟算，15 秒一次 ping 远在上限以内。

### 4.2 客户端发给服务端

| 消息 | 字段 | 什么时候发 |
| --- | --- | --- |
| hello | playerId、nickname、poolHash | 连上之后第一条。poolHash 是卡池内容的哈希，和服务端不一致时服务端回 error，页面提示刷新 |
| create_room | heroClass、deck | 建房。deck 是 30 个卡牌 id |
| join_room | code、heroClass、deck | 进房 |
| leave_room | | 在等待页退出 |
| action | matchId、version、action | 玩家操作。action 就是 spec 6.5 的 Action |
| concede | matchId | 认输 |
| resume | seatToken、version | 重连。version 是客户端已经收到的最后一批的 version；页面刷新后没有本地状态，传 null |
| holding | matchId、instanceId | 正在拖哪张手牌，null 是放下（M6c） |

### 4.3 服务端发给客户端

| 消息 | 字段 | 什么时候发 |
| --- | --- | --- |
| room_created | code、expiresIn | 建房成功 |
| match_start | matchId、side、seatToken、opponent{nickname, heroClass}、version、snapshot、events、deadlineIn、resumed | 双方到齐，服务端建好局。events 是开局那批（mulligan_start）。重连且 version 为 null 时也发它，resumed 为 true，events 为空，snapshot 是当前局面 |
| batch | version、events、snapshot、deadlineIn、result | 每执行一个动作发一条，每个座位各自遮过。result 只在这一批把对局打完时有 |
| rejected | version、reason | 动作被拒。version 是服务端当前的 version |
| opponent | connected、graceIn、holding | 对手上线、断线、抬牌。graceIn 是断线判负前剩的毫秒数，没断线时不带 |
| error | code、message | hello 失败、房间不存在或已满、卡组不合规、版本不一致 |

重连带 version 时，服务端补发 version 之后的每一批 batch（服务端整局都留着，一局 32 KB），客户端照常交给导演播。

### 4.4 version 与并发

- version 是服务端已执行的动作数，createGame 之后为 0，每次 applyAction 加一，计时器替玩家执行的 end_turn 和 5.2 的认输、判负也加一。每条 batch 带新的 version。
- 客户端发 action 时带上它正在操作的 version。服务端收到时 version 不等于自己的，回 rejected 'stale'，不执行。回合制下只有当前方能动，撞车只有一种情况：回合计时器到点替玩家结束回合的同时，玩家的动作在路上。有了 version 这个动作被拒，玩家看到的是回合已经结束，不会在下一回合的局面上执行上一回合的动作。
- 客户端一次只有一个在途动作（3.3）。
- 服务端对同一局的消息串行处理：Node 单线程，Table.submit 是同步的，不会交错。

### 4.5 快照

snapshot 是 `maskHidden(state, side)` 再把 `rng` 置成 `{ s: 0 }`。里面有：我的手牌（真实 id）、对手手牌（占位牌，保留 instanceId，张数可见）、双方牌库（占位牌，只有张数）、双方场面、英雄、法力、phase、turn、current、winner、双方 mulliganDone；对手还没执行的换牌选择被 maskHidden 清掉。客户端只用它算合法操作和显示，永远不在它上面调 applyAction。

## 5. 服务端

### 5.1 模块

```
src/net/protocol.ts     消息类型，两端共用
src/server/table.ts     权威对局 Table：局面、version、动作日志、座位、遮蔽、计时钩子。纯模块，无 I/O，浏览器也能跑
src/server/rooms.ts     房间：邀请码、两个座位、到齐开局
src/server/ws.ts        WebSocket 接入：连接和座位的绑定、消息校验、心跳、限速
src/server/aiSeat.ts    AI 座位：ChooseAction 接 Table；L2 在 worker_threads 里跑
src/server/static.ts    生产时托 dist：静态文件、缓存头、index.html
src/server/main.ts      入口。开发时只起 WebSocket（页面由 Vite 起），生产时同时托静态
```

开发时 `pnpm serve` 用 tsx 直接跑，`.claude/launch.json` 加一条 lolstone-server。生产时托管平台的 Node 应用会去掉 devDependencies，所以服务端用 tsc 编译到 `dist-server/`，`scripts.start` 是 `node dist-server/main.js`，监听平台给的 `PORT` 和 0.0.0.0；`ws` 和静态文件服务放 dependencies，vite 和 tsx 留在 devDependencies。

### 5.2 Table

```ts
type Seat =
  | { kind: 'human'; playerId: string; token: string; nickname: string; connected: boolean; send: (m: ServerMessage) => void }
  | { kind: 'ai'; choose: ChooseAction; rng: RngState };

class Table {
  readonly id: string;
  state: GameState;                 // 真实局面
  version = 0;
  readonly log: { side: Side; action: Action; at: number }[];
  readonly seats: [Seat, Seat];
  deadline: number | null;          // 当前计时的到期时刻
  submit(side: Side, version: number, action: unknown): { ok: true } | { ok: false; reason: string };
  concede(side: Side): void;
  forfeit(side: Side, reason: 'timeout' | 'abandon'): void;
  snapshotFor(side: Side): GameState;
}
```

submit 的顺序，每一步失败都返回原因、不改局面：

1. 对局已结束：拒。
2. version 不等于 Table 的 version：拒 'stale'。
3. 动作的字段类型校验（5.5）：拒 'malformed'。
4. 行动方核对：换牌阶段要求 action.kind 是 mulligan 且 action.player 等于 side；对局阶段要求 state.current 等于 side。拒 'not your turn'。引擎自己不做这一步，见 5.5。
5. checkAction：拒，原因照引擎的。
6. applyAction。state 换成新局面，version 加一，log 追加一条。
7. 给每个座位发 batch：events 是 maskEvents 遮过的，snapshot 是 snapshotFor 的，deadlineIn 按 5.3 算。AI 座位的"发"就是按节奏调它的 choose（5.6）。
8. phase 或 current 变了就重置计时器（5.3）。对局结束就写 result、存日志（第 7 节）、通知房间清理。

concede 和 forfeit 不走引擎：把 state 换成 `{ ...state, phase: 'over', winner: other(side) }`，version 加一，发一条只有 game_over 事件的 batch，result 带原因。和今天 Match.concede 的做法一样，表现层不区分胜负从哪来。

### 5.3 计时与断线

| 事项 | 数值 | 到点做什么 |
| --- | --- | --- |
| 换牌 | 60 秒，从 match_start 起算，两个座位各自计时 | 替还没提交的一方提交"一张都不换" |
| 回合 | 75 秒，从开始这一回合的那批 batch 发出起算 | 替当前方执行 end_turn，走 submit，version 用 Table 自己的 |
| 断线宽限 | 60 秒，从连接关闭起算 | 到点 forfeit(side, 'abandon')，对手获胜 |
| 双方都断线 | 10 分钟 | 对局作废，不记胜负，释放 |
| 等待页没人进 | 10 分钟 | 房间释放 |

- 到期时刻只在服务端算。发给客户端的是 deadlineIn（距离到期还有几毫秒），客户端用本地时钟倒数，不做时钟同步。两个座位收到同一个 deadlineIn，对手也看得到倒计时。
- 计时器到点先核对 version 没变再动作，变了说明玩家已经行动，这次到点作废。
- 断线期间回合计时照跑。断线的人轮到自己时 75 秒后会被替结束回合，但宽限 60 秒先到，所以实际是先判负。
- 断线的那一方重连成功就清掉宽限，对手收到 opponent{connected: true}。

### 5.4 房间与身份

- 身份："玩家是谁"收在服务端的一个接口后面：输入是连接上带的凭据，输出是稳定的主体 id 和昵称；房间、座位、Table 只认这个输出。第一版的实现是客户端自报：第一次打开时生成随机 playerId，和昵称一起存在 localStorage 的 lolstone.player，服务端不核实，playerId 只用来配对重连和写日志。托管平台给出匿名观众身份之后（应用 host 上的 HttpOnly cookie，服务端用平台的 SDK 验），换成那个实现，主体 id 来自平台、客户端不再自报；再往后是平台账号。换实现时座位 token、房间和 Table 都不动。
- 座位 token：match_start 时服务端给每个座位发一个随机 128 位的 token，客户端存在 localStorage 的 lolstone.seat（连同 matchId）。重连只认 token，不认 playerId。对局结束后清掉。
- 邀请码：6 位，字母数字去掉 0、O、1、I，在未开局的房间里唯一。
- 开局：双方到齐，服务端先用 `src/cards` 的 validateDeck 校验两套卡组（进房时就校验，不合规当场回 error），再 createGame，seed 是服务端生成的随机 32 位整数。建房的人是 0 号位，先后手由 seed 决定（spec 2.2），和座位号无关。
- 一个 playerId 同时只能在一局里。

### 5.5 安全校验

这几条是硬规则，少一条就有可作弊的口子：

1. 连接绑定座位，side 永远不信客户端。消息里的 matchId 只用来找 Table，座位由连接决定。
2. 行动方核对由服务端做。引擎的 Action 里出牌、攻击、英雄技能、结束回合都不带玩家字段，checkAction 把 state.current 当作行动方（`src/engine/actions.ts`）。服务端不核对的话，对手在你的回合发 end_turn 就能替你结束回合。
3. 动作字段严格校验类型，不能只靠 checkAction。2.3 的第三项验证：handIndex 传字符串 "0"，checkAction 用 actionKey 拼字符串比对、能过，applyAction 里 `filter((_, i) => i !== action.handIndex)` 用严格不等、过滤不掉，法术生效了牌还在手里。服务端校验：kind 在五种之内；handIndex、position、replace 里的每一项、instanceId 都是非负整数；side 是 0 或 1；没有多余字段。M6a 顺手把 checkAction 也加上整数检查，单机和测试也受益。
4. 下发的快照 rng 置零。2.3 第二项：maskHidden 的派生随机数可逆。
5. 卡组用 validateDeck 校验再建局；卡池版本用 hello 的 poolHash 核对。
6. 限速：每个连接每秒最多 10 条消息，超过断开。单条消息最大 16 KB。
7. 任何发给客户端的东西都先过 maskEvents 和 snapshotFor，没有第二条通道。动作日志只在服务端。

### 5.6 AI 座位

- Table 的座位可以是 AI：`{ kind: 'ai', choose, rng }`。每批 batch 之后，轮到 AI 座位就按 Match 今天的 AI_PACE 节奏调 choose，拿到动作走同一个 submit。L0、L1 同步跑；L2 要在 worker_threads 里跑，`src/ai/l2Worker.ts` 现在只认浏览器的 Worker，没有 Worker 时退回同步，在服务端会卡住事件循环，要加一个 Node 适配。
- 用处：开发时一个人就能测服务端；以后可以加"在线练习"模式。掉线是否由 AI 接管而不是判负，列在待定。
- CPU 预算：托管的应用只有 0.25 到 2 核，L2 一步搜索在桌面机上接近 1 秒，在 pod 里会慢几倍。服务端 AI 座位先只用 L0、L1，L2 等实测再定。

### 5.7 托管环境的约束

服务端跑在静态站点托管平台的 Node 应用里。下面这些是设计的前提，不是待定：

| 约束 | 对设计的影响 |
| --- | --- |
| 单副本，发布和节点滚动时进程会重启 | 进程内的房间和 Table 随之消失，进行中的对局作废（第 7 节） |
| 没有持久化磁盘，不托管数据库 | 不写文件。要跨重启保留的东西只能放外部数据库，第一版不要 |
| 没有连接时闲置 15 分钟缩到 0，唤醒要 4 到 5 秒；有 WebSocket 连着就不睡 | 对局进行中不会睡；房间里没人时睡掉等于关房。睡着时第一个请求要等几秒，等待页要有提示 |
| 出网只放行 80、443 和常见数据库端口 | 服务端不需要出网 |
| 前面有 CDN，按响应头缓存；带 Set-Cookie 的响应一律不缓存 | 缓存头由服务端给（4.1）；WebSocket 不经缓存 |
| 应用 host 上有平台保留的路径前缀 | 自己的路由不用那个前缀 |

## 6. 单机的去向

- LocalMatch 在浏览器里直接 new 一个 Table，0 号位是人，1 号位是 AI 座位。Table 在浏览器里跑就是今天 Match 做的事，连 ai_thinking 的插入也在里面，所以单机的手感、AI 节奏、`?autoplay`、回放夹具、/dev/fx 调试台都不变。
- 单机不需要服务端、不需要网络。连不上服务端只影响联机入口。
- Table 是浏览器和服务端共用的同一份代码。它只依赖 engine、cards、ai，没有 DOM，也没有 ws。L2 的 Worker 适配是唯一按环境分开的地方。

## 7. 持久化与回放

- 一局的记录：`{ id, seed, classes, decks, nicknames, startedAt, actions: { side, action, at }[], result }`。引擎确定性（spec 2.11），createGame 加逐条 applyAction 就能重建任意时刻的局面，所以不存局面、不存事件，只存动作。
- 存法：只在内存里。托管环境没有磁盘和数据库（5.7），服务端重启时进行中的对局作废：重启后客户端 resume 得到 match_not_found，界面提示"对局已失效"并回主菜单，不记胜负。要跨重启保留只能接外部数据库，列在待定。
- 回放：对局结束时服务端把这份记录随最后一批 batch 发给双方，客户端存进 localStorage 或让玩家下载；重放一遍、把每批事件记下来，就是 `src/presentation/fixture.ts` 的 ReplayFixture，页面带 `?replay` 的回放路径不用改。服务端自己不留。

## 8. 里程碑

| 阶段 | 内容 | 完成标准 |
| --- | --- | --- |
| M6a 接缝 | Match 拆成 Table 和 LocalMatch，抽出 MatchSeat；checkAction 加字段整数检查；不联网 | 单机行为不变：现有测试全过，浏览器自动对局 5 局 0 报错，/dev/fx 和 ?replay 照常；Table 用两个假座位的单测过（9.1） |
| M6b 联机可玩 | 服务端（ws 接入、房间、Table、计时、认输、断线判负、重连）、协议、RemoteMatch、主菜单联机入口、等待页、倒计时、结算原因、Vite 代理 | 两个浏览器标签页通过邀请码打完一局；一个标签页刷新后能接着打；一方关掉标签页 60 秒后另一方获胜；9.2 到 9.5 的测试过 |
| M6c 打磨 | 对手抬牌提示、烧绳音效和画面、回放记录下发客户端、身份接口换成平台的匿名主体（平台就绪后）、服务端 AI 座位、匹配队列 | 对局结束后能在 ?replay 看回放；服务端重启后客户端收到"对局已失效"的提示、不卡死；一个人开两个标签页对 AI 座位打完一局；9.6 过 |
| 以后 | 账号、天梯、观战、分享回放、外部数据库 | 另写 |

## 9. 测试

1. Table 单测：两个假座位，断言 side 核对、stale version、字段类型、计时器替结束回合、认输、断线判负、换牌双方各自提交、AI 座位打完一局。Table 是纯模块，这些都在 Node 里跑。
2. 属性测试：随机 L0 对局的每个局面，对双方各算一次，`listLegalActions(maskHidden(s, side), side)` 的 actionKey 集合等于真实局面的。就是 2.3 第一项，进 tests。
3. 遮蔽：扩 `tests/presentation-mask.test.ts`，断言 snapshotFor 的 rng.s 为 0、对手手牌和双方牌库都是占位牌、对手的 mulliganReplace 不出现。
4. 动作模糊测试：handIndex 为字符串、负数、小数、NaN，多余字段，replace 里混字符串，都被 submit 拒绝且局面不变。
5. 协议：进程内起一个 ws 服务端和两个客户端，按脚本打一局；中途断开一个客户端再 resume，收到的补发批次和漏掉的一致；刷新式 resume 收到的快照和服务端一致。
6. 浏览器冒烟：两个标签页带 `?autoplay` 打本地服务端，打完一局，控制台 0 报错。

## 10. 已经定下的选择

都可以改，改了说一声是哪条。

1. 服务端权威，不做 P2P 和宿主模式。理由见 2.1。
2. 单进程 Node，同时托静态产物和 WebSocket，部署成托管平台的 Node 应用；不另起 VPS，不做 Durable Objects。Table 不碰 I/O。
3. 每批都带整个遮过的快照，客户端不从事件重建引擎状态。依据是 2.3 的数据量。
4. 客户端在快照上算合法操作，不向服务端要列表。依据是 2.3 的第一项验证。
5. 第一版不做账号。"玩家是谁"收在一个接口后面：先客户端自报，再换平台的匿名主体，再换平台账号。邀请码房间，座位 token 重连。
6. 回合 75 秒、换牌 60 秒、断线宽限 60 秒。回合时长取炉石的。
7. 认输、超时、弃局都是服务端合成的 game_over 事件，表现层不区分来源，结算面板显示原因。
8. ai_thinking 只在有 AI 座位的对局里出现。真人对手的节奏就是真实等待。
9. 对手在线状态不进导演队列。
10. 进行中的对局不跨服务端重启，重启就作废。依据是 5.7。

## 11. 待定

- 认输要不要收进引擎 Action，让它也进动作日志。现在是服务端命令，日志里单独记 result 的 reason。
- 对手提示的粒度：只抬牌，还是连目标箭头也同步。
- 要不要接外部数据库，让对局和回放记录跨服务端重启。
- 服务端 AI 座位的 L2 在托管的 CPU 预算下能不能用。
- 掉线后允许 AI 接管，还是一律判负。
- 匹配队列和天梯分。
