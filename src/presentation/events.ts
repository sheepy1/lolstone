// 表现层接收的事件（spec 6.4 末尾）：引擎事件加对局层自己插的事件，放在一个联合类型里。
import { ENGINE_EVENT_KINDS, type GameEvent, type Side } from '../engine';

// 对局层事件。AI 的两个动作之间插一个 ai_thinking，导演当成等待播放。
export type MatchEvent = { kind: 'ai_thinking'; group: number; side: Side; seconds: number };

export type PresentationEvent = GameEvent | MatchEvent;

export type PresentationEventKind = PresentationEvent['kind'];

export type PresentationEventOf<K extends PresentationEventKind> = Extract<PresentationEvent, { kind: K }>;

export const PRESENTATION_EVENT_KINDS: readonly PresentationEventKind[] = [...ENGINE_EVENT_KINDS, 'ai_thinking'];
