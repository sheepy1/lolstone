// 动画模块的接口（spec 5.8）：输入是事件和场景对象，输出是一条 GSAP 时间线。模块之间不耦合。
import type gsap from 'gsap';
import type { Side } from '../../engine';
import type { TableScene } from '../../scene/table';
import type { PresentationEventKind, PresentationEventOf } from '../events';
import type { ViewState } from '../viewState';

export type AnimContext = {
  scene: TableScene;
  before: ViewState; // 这个事件之前的显示局面
  after: ViewState; // 推进完这个事件之后的显示局面
  viewer: Side;
};

// impact：同一步里有带 impact 的事件（攻击）时，其余事件从 impact 时刻开始，表现为"撞上的瞬间受伤"。
export type Anim = { tl: gsap.core.Timeline; impact?: number };

export type AnimModule<K extends PresentationEventKind> = (e: PresentationEventOf<K>, ctx: AnimContext) => Anim;

// 每种事件一个模块，类型保证一个都不漏。
export type AnimRegistry = { [K in PresentationEventKind]: AnimModule<K> };
