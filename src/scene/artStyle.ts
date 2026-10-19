// 棋盘和卡框的美术版本（M4 美术定稿）。默认是新版；地址带 ?art=old 时用 M3 的骨架版，/dev/fx 的"美术"面板
// 切这个参数做新旧对比。新版的可调参数也放在这里，面板直接改它们（着色器每帧读 uniform，改了马上生效）。
export type ArtStyle = 'new' | 'old';

export const ART_STYLE: ArtStyle =
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('art') === 'old' ? 'old' : 'new';

// 棋盘着色器的参数（groundMaterial.ts 每帧写进 uniform）
export const BOARD_ART = {
  // 外圈压暗：离中央（双方随从行）越远越暗，0 是不压暗
  edgeDark: 0.42,
  // 整体饱和度：1 是原色。棋盘不抢戏，绿色压低一些
  saturation: 0.8,
  // 整体明度
  brightness: 0.9,
  // 河床上的焦散亮纹
  caustics: 0.55,
  // 水面反光（环境反射的强度）
  waterGloss: 0.6,
  // 草丛随风摆动的幅度
  sway: 1,
};
