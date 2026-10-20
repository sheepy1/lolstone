// 托管平台的逻辑模块接口（docs/online.md 第 4 节），照平台发布的类型定义抄一份，不依赖平台的包。
// 平台改了定义，这里跟着改；src/logic/index.ts 用 `satisfies Logic<MatchState, GameEvent>` 核对 logic 对象。
//
// 平台给隔离环境的只有 ES 内置对象加注入的 structuredClone，没有 Date、定时器、Math.random、console 和任何
// Node、Web API。每个方法都是纯函数：同样的输入同样的输出，不改入参，对任何输入都不抛（抛错算模块缺陷，
// 同一局连续 10 次平台关局）。State 和 Event 必须是纯 JSON：平台每一步之后序列化存起来，runner 重启后装回。

// 一步的结果。deadline 是距现在多少毫秒：带数字就替换正在走的计时器，带 null 清掉，不带就保留。
// 对局结束时平台自动停计时器，结束的那一步带不带都行（lolstone 带 null）
export type Step<State, Event> =
  | { ok: true; state: State; events: Event[]; deadline?: number | null }
  | { ok: false; reason: string };

// 建局时的一个座位。config 是这个座位的玩家建局或进局时交的 JSON（不超过 4 KiB），bot 座位是建局的人替它给的。
// config 只在平台和 runner 里，不发给任何客户端
export type SeatSpec = { kind: 'human' | 'bot'; config: unknown };

// setup 的入参。seed 是 [0, 2^32) 的整数，平台给并记下；seats[i] 是 i 号座位；options 是建局的人给的 JSON，没给为 null
export type SetupContext = { seed: number; seats: SeatSpec[]; options: unknown };

// 平台发起的判负：断线宽限到（abandon）或运营踢人（kicked）
export type ForfeitReason = 'abandon' | 'kicked';

// winner 是座位号或 'draw'。其余字段原样广播给所有座位，只放公开的东西
export type MatchResultBase = { winner: number | 'draw' };

// 写成方法而不是函数属性：TypeScript 对方法参数做双向检查，模块可以把 seat 收窄成自己的座位类型
export interface Logic<State, Event> {
  // 所有座位到齐、人类座位都在线时调一次。返回开局局面（version 0）、开局事件和第一个 deadline。
  // ok:false 表示对局不开始，平台以 setup_rejected 关局，并把 reason 发给每个座位
  setup(ctx: SetupContext): Step<State, Event>;
  // 一个座位发的动作。平台只核对过座位、是 JSON、大小和速率、version；动作的形状、轮到谁、合不合法都在这里查
  apply(state: State, seat: number, action: unknown): Step<State, Event>;
  // 这个座位能看到的局面。局面离开 runner 只有这一种形式，所以能反推的随机数状态也要遮
  mask(state: State, seat: number): unknown;
  // 这个座位能看到的事件，来自同一步的 events
  maskEvents(events: Event[], seat: number): Event[];
  // deadline 到点。平台按座位号依次调，每次传上一次之后的局面；ok:false 跳过，ok:true 生效，
  // 某一步带回新的 deadline 这一轮就停
  onTimeout(state: State, seat: number): Step<State, Event>;
  // 可选。平台发起的判负，不走引擎
  forfeit?(state: State, seat: number, reason: ForfeitReason): Step<State, Event>;
  // 每一步之后调，非 null 就以这个结果结束对局
  result(state: State): MatchResultBase | null;
  // 可选。bot 座位的下一步动作，现在没事做返回 null。随机数从 state 里取
  bot?(state: State, seat: number): unknown;
  // 可选，实时类游戏才用。lolstone 是回合制，不写
  tick?(state: State, dtMs: number): Step<State, Event>;
}
