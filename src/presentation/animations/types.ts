// 动画模块的接口（spec 5.8）：输入是事件和场景对象，输出是一条 GSAP 时间线。模块之间不耦合。
import type gsap from 'gsap';
import type { Side } from '../../engine';
import type { TableScene } from '../../scene/table';
import type { PresentationEvent, PresentationEventKind, PresentationEventOf } from '../events';
import type { ViewState } from '../viewState';

export type AnimContext = {
  scene: TableScene;
  before: ViewState; // 这个事件之前的显示局面
  after: ViewState; // 推进完这个事件之后的显示局面
  viewer: Side;
  // 同一步里的全部事件（含这个）。受伤模块据此判断自己是不是攻击撞击的一部分
  step?: readonly PresentationEvent[];
  // 这个事件在同一步里的序号（从 0 数）。同组多张抽牌据此错开（m4-storyboard E03）
  index?: number;
};

// 一步里只能出现一次的反馈（m4-storyboard 1.7）：震屏取最重的一次，命中声取最重的一次，语音只播最后一条。
// 动画模块不直接触发这些，而是报一条 cue，由 compose 在整步里挑一条放进时间线。
// channel 相同的 cue 互相竞争：voice 留时间最晚的，其余留 weight 最大的（相同时留最早的）。
// 同一频道有多条 cue 时，若被选中的那条带 many，改为调用 many（比如群体增益用一圈大金环代替每个一圈）。
export type Cue = {
  channel: string;
  at: number; // 相对这个事件时间线开头的秒数
  weight: number;
  run: () => void;
  many?: () => void;
};

// impact：同一步里有带 impact 的事件（攻击）时，其余事件从 impact 时刻开始，表现为"撞上的瞬间受伤"。
// order、stagger：同组多个目标按 order（目标在画面上的横坐标）从左到右每个错开 stagger 秒（1.7 的"一道波"）；
// 有攻击的一步不错开，攻击方和被攻击方同一个命中帧。
// tail：时间线最后多少秒是收尾（回弹、淡出、让位、残留），m4-storyboard 1.7 的组间重叠按它算：这一步里最后结束的事件
// 收尾进行到 60% 时，下一组就可以开始。有 impact 的一步不看 tail：最后一个命中帧之后都算收尾。其余不写时算 0（不重叠）。
// readyAt：下一组最早在这个事件时间线的哪个时刻开始，比 tail 的 60% 规则优先（取更早的）。死亡后紧跟亡语时用它。
export type Anim = { tl: gsap.core.Timeline; impact?: number; cues?: Cue[]; order?: number; stagger?: number; tail?: number; readyAt?: number };

export type AnimModule<K extends PresentationEventKind> = (e: PresentationEventOf<K>, ctx: AnimContext) => Anim;

// 每种事件一个模块，类型保证一个都不漏。
export type AnimRegistry = { [K in PresentationEventKind]: AnimModule<K> };
