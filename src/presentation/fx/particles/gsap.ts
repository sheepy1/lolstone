// 粒子系统和 GSAP 的衔接。
//
// - driveWithGsap：把 system.update 接到 GSAP 的时钟上，乘全局时间线的 timeScale。导演快进（3 倍速）和
//   调试台慢放都改的是全局时间线，粒子跟着一起快、一起慢；页面不可见时 GSAP 停，粒子也停。
// - particleTimeline：把一次发射包成一条 GSAP 时间线，可以 tl.add 到事件时间线的命中帧上。时间线开始时发射，
//   时长是预设的预计时长；时间线被提前杀掉（换局、跳过）时粒子一起清掉。
import gsap from 'gsap';
import type { PresetName } from './presets';
import { PRESETS } from './presets';
import { presetDuration, type EmitOptions, type ParticleHandle, type ParticleSystem } from './system';
import type { PresetDef } from './types';

export function driveWithGsap(system: ParticleSystem, g: typeof gsap = gsap): () => void {
  const tick = (_time: number, deltaMs: number) => system.update(Math.min(deltaMs / 1000, 0.1) * g.globalTimeline.timeScale());
  g.ticker.add(tick);
  return () => g.ticker.remove(tick);
}

export function particleTimeline(
  system: ParticleSystem,
  preset: PresetName | PresetDef,
  opts: EmitOptions,
  g: typeof gsap = gsap,
): { tl: gsap.core.Timeline; handle: () => ParticleHandle | null } {
  let h: ParticleHandle | null = null;
  const def = typeof preset === 'string' ? PRESETS[preset] : preset;
  const tl = g.timeline({ onInterrupt: () => h?.kill() });
  tl.call(() => {
    h?.kill();
    h = system.emit(preset, opts);
  });
  tl.to({}, { duration: presetDuration(def, opts) });
  return { tl, handle: () => h };
}
