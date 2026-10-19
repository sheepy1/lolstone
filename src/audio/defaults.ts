// 四条音量通道的类型和默认值（spec 5.7）。单独放一个文件、不引 Howler：
// 设置页的逻辑（src/ui/settings.ts）要在 Node 里测试，不能把依赖 DOM 的音频模块带进来。
export type Channel = 'master' | 'music' | 'sfx' | 'voice';

export type Volumes = Record<Channel, number>;

export const VOLUME_DEFAULTS: Volumes = { master: 0.8, music: 0.5, sfx: 0.8, voice: 0.9 };
