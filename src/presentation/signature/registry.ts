// 招牌卡专属特效的注册表和导演钩子（docs/m4-signature-fx.md）。
// 导演播一步时先问这里：这一步里有没有事件属于某个已注册的招牌特效。有就把这些事件交给专属模块合成一条时间线，
// 其余事件照常走默认模块；没有就返回 null，播放器整步走默认模块。
//
// 一个事件属于哪个招牌特效（signatureIdOf）：
// - 事件自己带 fxId（引擎把动作上的 fxId 原样放进 damage、freeze、death、minion_summoned、bounce、buff 等事件）；
// - 招牌法术的 spell_cast：引擎不给 spell_cast 带 fxId，按卡牌数据里第一个写了 fxId 的动作映射，专属模块在这一步做
//   "展示"之后的起手段，同时替掉通用的法术演出（不然通用版和专属版会叠在一起）；
// - trigger 事件按 (卡牌 id, 触发时机) 映射：泰达米尔的无尽怒火（脚本）和易的击杀重置（on_kill）在数据里没有动作可挂 fxId。
// 只认注册表里有的 fxId：数据里写了 fxId、这边还没做专属模块的卡照常走默认（fx 类型兜底）。
import gsap from 'gsap';
import { getCard, type Side } from '../../engine';
import type { TableScene } from '../../scene/table';
import type { Anim, AnimContext, Cue } from '../animations/types';
import type { PresentationEvent } from '../events';

export type SignatureCtx = {
  scene: TableScene;
  viewer: Side;
  fxId: string;
  // 这一步里属于这个招牌特效的事件（按原顺序），和各自的动画上下文
  events: PresentationEvent[];
  ctxs: AnimContext[];
  // 同一步的全部事件
  step: readonly PresentationEvent[];
  // 第 k 个事件的默认动画（专属模块可以把默认的受伤、死亡、冻结放到自己的命中帧上，飘字、徽章、命中声都沿用）
  byDefault: (k: number) => Anim;
};

// hitAt：这一步的命中帧（秒）。同一步里不属于招牌特效的事件（圣盾碎裂之类）从这里开始，不抢在命中帧之前播
export type SignatureAnim = Anim & { hitAt?: number };
export type SignatureModule = (c: SignatureCtx) => SignatureAnim;
export type SignatureTable = Readonly<Record<string, SignatureModule>>;

// (卡牌 id, 触发时机) → fxId（m4-signature-fx 清单里注明的两张）
export const TRIGGER_FX: Readonly<Record<string, string>> = {
  'freljord.tryndamere/script': 'tryndamere.undying_rage',
  'ionia.masteryi/on_kill': 'masteryi.highlander',
};

const spellFx = new Map<string, string | null>();

// 法术卡数据里第一个写了 fxId 的动作（没有就是 null）。按卡牌 id 缓存
export function spellFxId(cardId: string): string | null {
  if (spellFx.has(cardId)) return spellFx.get(cardId)!;
  let id: string | null = null;
  try {
    const def = getCard(cardId);
    if (def.type === 'spell') {
      for (const eff of def.effects ?? []) {
        if (eff.trigger === 'static') continue;
        const a = eff.actions.find((x) => 'fxId' in x && typeof x.fxId === 'string');
        if (a && 'fxId' in a && a.fxId) {
          id = a.fxId;
          break;
        }
      }
    }
  } catch {
    id = null; // 遮住的牌、卡池里没有的 id
  }
  spellFx.set(cardId, id);
  return id;
}

export function signatureIdOf(e: PresentationEvent, table: SignatureTable): string | null {
  let id: string | null = null;
  if ('fxId' in e && typeof e.fxId === 'string') id = e.fxId;
  else if (e.kind === 'spell_cast') id = spellFxId(e.card.cardId);
  else if (e.kind === 'trigger' && 'cardId' in e.source) id = TRIGGER_FX[`${e.source.cardId}/${e.timing}`] ?? null;
  return id && table[id] ? id : null;
}

// 把一条默认动画整体推迟 at 秒（时间线、cue、impact 一起挪）
function delayed(a: Anim, at: number): Anim {
  if (at <= 0) return a;
  const tl = gsap.timeline();
  tl.add(a.tl, at);
  const cues: Cue[] | undefined = a.cues?.map((c) => ({ ...c, at: c.at + at }));
  return { ...a, tl, cues, impact: a.impact === undefined ? undefined : a.impact + at };
}

// 导演钩子：这一步里有招牌特效时返回整步的动画列表，没有时返回 null（调用方整步走默认模块）。
// ctxOf(i)、byDefault(e, i) 由播放器提供，i 是事件在这一步里的序号。
export function signatureAnims(
  events: readonly PresentationEvent[],
  ctxOf: (i: number) => AnimContext,
  byDefault: (e: PresentationEvent, i: number) => Anim,
  table: SignatureTable,
): Anim[] | null {
  const ids = events.map((e) => signatureIdOf(e, table));
  if (ids.every((x) => x === null)) return null;
  const groups = new Map<string, number[]>();
  ids.forEach((id, i) => {
    if (id === null) return;
    const g = groups.get(id);
    if (g) g.push(i);
    else groups.set(id, [i]);
  });
  const out: Anim[] = [];
  let hitAt = 0;
  for (const [fxId, idx] of groups) {
    const ctxs = idx.map(ctxOf);
    const a = table[fxId]!({
      scene: ctxs[0]!.scene,
      viewer: ctxs[0]!.viewer,
      fxId,
      events: idx.map((i) => events[i]!),
      ctxs,
      step: events,
      byDefault: (k) => byDefault(events[idx[k]!]!, idx[k]!),
    });
    hitAt = Math.max(hitAt, a.hitAt ?? 0);
    const { hitAt: _hit, ...anim } = a;
    out.push(anim);
  }
  events.forEach((e, i) => {
    if (ids[i] === null) out.push(delayed(byDefault(e, i), hitAt));
  });
  return out;
}
