// 事件到动画模块的对照表。每种事件一个模块（spec 5.8），类型保证不漏。
import { aiThinking } from './aiThinking';
import { attack } from './attack';
import { bounce } from './bounce';
import { buff } from './buff';
import { burn } from './burn';
import { cardPlayed } from './cardPlayed';
import { damage } from './damage';
import { death } from './death';
import { draw } from './draw';
import { fatigue } from './fatigue';
import { freeze } from './freeze';
import { gameOver } from './gameOver';
import { gameStart } from './gameStart';
import { heal } from './heal';
import { heroPowerUsed } from './heroPowerUsed';
import { manaChanged } from './manaChanged';
import { minionSummoned } from './minionSummoned';
import { mulliganDone } from './mulliganDone';
import { mulliganStart } from './mulliganStart';
import { shieldBroken } from './shieldBroken';
import { silence } from './silence';
import { spellCast } from './spellCast';
import { stealthLost } from './stealthLost';
import { transform } from './transform';
import { trigger } from './trigger';
import { turnEnd } from './turnEnd';
import { turnStart } from './turnStart';
import type { AnimRegistry } from './types';
import { unfreeze } from './unfreeze';

export const ANIMATIONS: AnimRegistry = {
  mulligan_start: mulliganStart,
  mulligan_done: mulliganDone,
  game_start: gameStart,
  turn_start: turnStart,
  turn_end: turnEnd,
  draw,
  burn,
  fatigue,
  card_played: cardPlayed,
  minion_summoned: minionSummoned,
  spell_cast: spellCast,
  hero_power_used: heroPowerUsed,
  trigger,
  attack,
  damage,
  heal,
  death,
  buff,
  silence,
  freeze,
  unfreeze,
  shield_broken: shieldBroken,
  stealth_lost: stealthLost,
  bounce,
  transform,
  mana_changed: manaChanged,
  game_over: gameOver,
  ai_thinking: aiThinking,
};

export type { Anim, AnimContext, AnimModule, AnimRegistry } from './types';
