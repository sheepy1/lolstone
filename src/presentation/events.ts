// 表现层接收的事件（spec 6.4 末尾）：引擎事件加对局层自己插的事件，放在一个联合类型里。
import { ENGINE_EVENT_KINDS, type GameEvent, type Side } from '../engine';

// 对局层事件。AI 的两个动作之间插一个 ai_thinking，导演当成等待播放。
// card：AI 接下来要打出的那张手牌的实例 id（只有下一步是出牌时才有）。思考时抬起的就是这一张，接着直接从抬起的状态飞出
// （m4-storyboard E27 的衔接）。这张牌马上就会被打出，实例 id 在遮挡后的事件里本来也保留着，不算泄露信息。
export type MatchEvent = { kind: 'ai_thinking'; group: number; side: Side; seconds: number; card?: number };

export type PresentationEvent = GameEvent | MatchEvent;

export type PresentationEventKind = PresentationEvent['kind'];

export type PresentationEventOf<K extends PresentationEventKind> = Extract<PresentationEvent, { kind: K }>;

export const PRESENTATION_EVENT_KINDS: readonly PresentationEventKind[] = [...ENGINE_EVENT_KINDS, 'ai_thinking'];
