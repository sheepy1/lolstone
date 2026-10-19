// 粒子系统的对外入口（分镜表 1.5）。用法：
//   const fx = new ParticleSystem({ camera: stage.camera });
//   stage.scene.add(fx.object);
//   const stop = driveWithGsap(fx);
//   await fx.emit('spark_heavy', { at: hitPoint, count: 14 });
//   fx.emit('fire_bolt', { at: from, to: target, color: '#ff7ad9' });
//   // 一局结束：stop(); fx.dispose();
export { ParticleSystem, ParticleHandle, MAX_PARTICLES, presetDuration } from './system';
export type { EmitOptions, ParticleStats } from './system';
export { PRESETS, PRESET_NAMES, FX_PALETTE, presetParticleCount } from './presets';
export type { PresetName } from './presets';
export { driveWithGsap, particleTimeline } from './gsap';
export type { PresetDef, Layer, Vec3Like } from './types';
