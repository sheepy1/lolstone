// 法术和英雄技能演出的时间表（m4-storyboard E06、E09、E10、E23）。这里只有数据和纯函数：打到谁、按哪种 fx、
// 每个目标的命中帧在第几秒、下一组从哪一秒开始。画面在 spellFx.ts 和 heroPowerFx.ts，测试直接测这里。
//
// 命中帧怎么接到后面的事件：法术的效果和它造成的伤害、冻结、增益是两组事件（引擎先发 spell_cast，再按动作各发一组）。
// 分镜要求"效果的命中帧接 damage / heal / destroy 等事件"，所以 spell_cast 这一步报的 tail 让导演正好在命中帧开始
// 下一组：导演在"最后 tail 秒的 60%"处开始下一组（compose.ts 的 readyTime），tail = 命中帧之后剩下的时长 / (1 - 0.6)。
// 群体法术的下一组（同组的伤害）按目标横坐标每个错开 40ms，和这里每个目标的命中帧一一对上。
import { getCard, other, type CardClass, type EffectAction, type Fx, type HeroClass, type Side, type TargetRef } from '../../engine';
import { OVERLAP } from '../compose';
import type { ViewState } from '../viewState';

// 时长单位秒。展示段（E06、E09 的前两段）由 cardPlayed 做，溶解和效果由 spellCast 做
export const SPELL = {
  mine: { fly: 0.15, hold: 0.15 }, // 自己出的法术：展示缩到 300ms（他已经知道自己出了什么）
  theirs: { fly: 0.25, hold: 0.45, flip: 0.4 }, // 对手出牌（E06）：前 40% 翻面，停 450ms 不能缩
  glow: 0.55, // 停的时候卡面按 fx 色发光的强度
  dissolve: 0.1, // 溶解成光（起）
  fire: { travel: 0.25 }, // fire_bolt 从中央飞向目标（线）
  frost: { spread: 0.3 }, // 冰霜在目标处铺开，铺满是命中帧
  holy: { land: 0.14, pillar: 0.3 }, // 光柱从天上落下，落地是命中帧；整根柱子 300ms
  shadow: { gather: 0.25, shrink: 0.1 }, // 聚拢再收缩，缩到最小时爆发
  physical: { slash: 0.14, second: 0.06 }, // 两道交叉的刀光，第一道挥过目标中心是命中帧；第二道晚 60ms
  noTarget: { travel: 0.25 }, // 抽牌、加法力：溶解的光飞向牌库或法力条
  residual: 0.16, // 命中帧之后时间线再留多久（爆开、闪光的余韵；粒子本身发出去就不管）
  scale: 1.4, // 单体效果的粒子缩放（预设按底座 1.5 宽设计，法术命中要比攻击火花大一圈）
  groupScale: 1.15, // 群体每个目标的缩放：同时落在一排上，单个小一点
  stagger: 0.04, // 群体法术按目标从左到右错开（分镜 1.7）
  heavyAt: 4, // 单体伤害 ≥ 4 时 S1（目标是英雄时交给 E24）
};

// 英雄技能（E23，600ms）：按下 200、出手 300、冷却 100
export const HERO_POWER = {
  pressDown: 0.08, // 起
  pressUp: 0.12, // 弹
  pressScale: 0.92,
  glow: 1.6, // 按下时图标自发光
  cast: 0.3,
  cooldown: 0.1, // 灰色遮罩从下往上盖住图标
  demacia: { land: 0.14 }, // 光柱落在最右槽位，落地是命中帧（士兵从光中成形由 minion_summoned 接）
  noxus: { travel: 0.25, spin: 3, size: 1.7 }, // 斧刃飞向敌方枢纽，转几圈；size 是斧刃的缩放
  ionia: { travel: 0.25 }, // 灵魄飞弹
  freljord: { travel: 0.22 }, // 冰箭
};

export type SpellShape = 'single' | 'group' | 'none';
export type NoTargetKind = 'draw' | 'mana' | 'other';

export type SpellPlan = {
  fx: Fx;
  shape: SpellShape;
  // 有害（伤害、消灭、冻结、沉默、变形）还是有益（增益、治疗、回手）：有益的不炸、不震、不闪棋盘
  harmful: boolean;
  targets: TargetRef[];
  noTarget: NoTargetKind | null;
  amount: number; // 伤害动作的数值（不含法术伤害加成），没有伤害时为 0
  freezesAll: boolean; // 群体冻结接在后面：冻结那组自己闪一次冰色棋盘，这里不再闪
  hit: number; // 第一个命中帧（相对 spell_cast 时间线开头）
};

const HARMFUL = new Set<EffectAction['kind']>(['damage', 'destroy', 'freeze', 'silence', 'transform']);
const GROUP = new Set(['all_enemy_minions', 'all_minions', 'other_friendly_minions']);

// 没有 fx 字段的牌（抽牌、加法力）按职业取一种
export const CLASS_FX: Record<CardClass, Fx> = { demacia: 'holy', noxus: 'physical', ionia: 'shadow', freljord: 'frost', neutral: 'holy' };

function castActions(cardId: string): EffectAction[] {
  const out: EffectAction[] = [];
  for (const eff of getCard(cardId).effects ?? []) if (eff.trigger === 'cast') out.push(...eff.actions);
  return out;
}

// 效果开始后多久命中（不含溶解），按 fx 类型
export function effectHit(fx: Fx): number {
  switch (fx) {
    case 'fire':
      return SPELL.fire.travel;
    case 'frost':
      return SPELL.frost.spread;
    case 'holy':
      return SPELL.holy.land;
    case 'shadow':
      return SPELL.shadow.gather + SPELL.shadow.shrink;
    case 'physical':
      return SPELL.physical.slash / 2;
  }
}

export function planSpell(cardId: string, side: Side, chosen: TargetRef | null, view: ViewState): SpellPlan {
  const actions = castActions(cardId);
  const withFx = actions.find((a) => 'fx' in a) as Extract<EffectAction, { fx: Fx }> | undefined;
  const fx = withFx?.fx ?? CLASS_FX[getCard(cardId).class];
  const targeted = actions.find((a) => 'target' in a) as Extract<EffectAction, { target: string }> | undefined;
  const dmg = actions.find((a) => a.kind === 'damage') as Extract<EffectAction, { kind: 'damage' }> | undefined;
  const harmful = targeted ? HARMFUL.has(targeted.kind) : false;
  const freezesAll = actions.some((a) => a.kind === 'freeze' && GROUP.has(a.target));
  const base = { fx, harmful, amount: dmg?.amount ?? 0, freezesAll };
  const hit = SPELL.dissolve + effectHit(fx);
  const none = (kind: NoTargetKind): SpellPlan => ({ ...base, shape: 'none', targets: [], noTarget: kind, hit: SPELL.dissolve + SPELL.noTarget.travel });
  if (!targeted) return none(actions.some((a) => a.kind === 'draw') ? 'draw' : actions.some((a) => a.kind === 'gain_mana') ? 'mana' : 'other');
  const enemy = other(side);
  const minions = (s: Side) => view.players[s].board.map((m): TargetRef => ({ side: s, kind: 'minion', instanceId: m.instanceId }));
  let targets: TargetRef[];
  switch (targeted.target) {
    case 'chosen':
      targets = chosen ? [chosen] : [];
      break;
    case 'friendly_hero':
      targets = [{ side, kind: 'hero' }];
      break;
    case 'enemy_hero':
      targets = [{ side: enemy, kind: 'hero' }];
      break;
    case 'all_enemy_minions':
      targets = minions(enemy);
      break;
    case 'all_minions':
      targets = [...minions(side), ...minions(enemy)];
      break;
    case 'other_friendly_minions':
      targets = minions(side);
      break;
    default:
      // 随机目标、自己：事件里还没有落点，按无目标处理
      targets = [];
  }
  const shape: SpellShape = GROUP.has(targeted.target) ? 'group' : 'single';
  if (targets.length === 0) return { ...none('other'), harmful, shape: shape === 'group' ? 'group' : 'none' };
  return { ...base, shape, targets, noTarget: null, hit };
}

// 群体法术每个目标的命中帧：按横坐标从左到右每个错开 stagger，同一个横坐标算同一格（和 compose 的错开规则一致）
export function hitTimes(plan: Pick<SpellPlan, 'hit'>, xs: readonly number[]): number[] {
  const round = (x: number) => Math.round(x * 100) / 100;
  const ranks = [...new Set(xs.map(round))].sort((a, b) => a - b);
  return xs.map((x) => plan.hit + ranks.indexOf(round(x)) * SPELL.stagger);
}

// 让导演在第 at 秒开始下一组的 tail（见文件头）
export function tailFor(duration: number, at: number): number {
  return Math.max(0, Math.min(duration, (duration - at) / (1 - OVERLAP)));
}

// 导演最早只能在整步的 60% 处开始下一组（tail 不能超过整步时长），所以要在第 at 秒交接，这一步的时间线最长 at / 0.6。
// 想留的余韵（after 秒）放不下时截短；超出这个长度的画面（群体法术后面几个目标、英雄技能的冷却）单独播，不算进这一步
export function stepEnd(at: number, after: number): number {
  return Math.min(at + after, at / OVERLAP);
}

// 法术施放的音效：群体法术用大法术音，其余按 fx 类型（分镜 E09、E10：magic 在溶解 t=0）
export function spellSfx(plan: Pick<SpellPlan, 'fx' | 'shape'>): `spell.${Fx | 'big'}` {
  return plan.shape === 'group' ? 'spell.big' : `spell.${plan.fx}`;
}

// 英雄技能的命中帧（相对 hero_power_used 时间线开头）
export function heroPowerHit(cls: HeroClass): number {
  const press = HERO_POWER.pressDown + HERO_POWER.pressUp;
  switch (cls) {
    case 'demacia':
      return press + HERO_POWER.demacia.land;
    case 'noxus':
      return press + HERO_POWER.noxus.travel;
    case 'ionia':
      return press + HERO_POWER.ionia.travel;
    case 'freljord':
      return press + HERO_POWER.freljord.travel;
  }
}

export function heroPowerDuration(): number {
  return HERO_POWER.pressDown + HERO_POWER.pressUp + HERO_POWER.cast + HERO_POWER.cooldown;
}
