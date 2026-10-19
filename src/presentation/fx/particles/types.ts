// 粒子预设的数据格式（分镜表 1.5）。一个预设由几层发射器组成，每层是一组同样行为的粒子：
// 比如重撞击火花 = 火花条 + 余烬 + 闪光 + 冲击环。预设只是数据，ParticleSystem 编译后按层发射。
//
// 单位：长度用世界单位（一张手牌宽 1.5，随从底座高 0.32），时间用秒，速度是单位每秒，重力是单位每秒平方（y 向上为正）。

export type Vec3Like = { x: number; y: number; z: number };

// 固定值或 [最小, 最大] 之间均匀随机
export type Range = number | readonly [number, number];

// 生命周期曲线：[进度 0 到 1, 值] 的关键帧，中间线性插值
export type Curve = readonly (readonly [number, number])[];

// 颜色引用：十六进制颜色，或者相对预设主色的三种派生色。调用方用 color 覆盖主色时，这三种跟着变。
//   main 主色；hot 主色往白色走 60%（炽热的核心）；deep 主色压暗到 35%（尾焰、余烬、阴影）
export type ColorRef = number | 'main' | 'hot' | 'deep';

// 颜色渐变的一站：[进度, 颜色, 亮度倍数]。加法混合的层亮度可以大于 1（HDR，进泛光和色调映射）。
export type GradientStop = readonly [number, ColorRef, number];

// 贴图图集里的格子（atlas.ts 程序生成）
export const CELLS = ['glow', 'ember', 'shard', 'smoke', 'flake', 'ring', 'star', 'arc'] as const;
export type Cell = (typeof CELLS)[number];

// add：加法混合，发光的东西（火花、光点、光柱）；alpha：普通透明混合，有实体的东西（烟、尘、碎片、纸屑）
export type Blend = 'add' | 'alpha';

// 朝向：
//   billboard 朝向镜头，可以绕视线自转；
//   velocity 沿运动方向拉长（火花条、光柱、刀光），长度 = max(size × aspect, 速度 × stretch)；
//   ground 平躺在台面上（地面冲击环）；
//   tumble 朝向镜头但带翻转（宽度按翻转相位缩放、亮度随之闪），碎片和纸屑用，看起来在空中翻滚。
export type Align = 'billboard' | 'velocity' | 'ground' | 'tumble';

// 发射形状（相对发射点，乘 scale）
export type Shape =
  | { kind: 'point' }
  // 球体内部或球面；hemi 只取上半球
  | { kind: 'sphere'; radius: number; surface?: boolean; hemi?: boolean }
  // 水平圆盘（edge 只取圆周），height 给了就是圆柱
  | { kind: 'disc'; radius: number; edge?: boolean; height?: Range }
  // 长方体，size 是 x、y、z 三个方向的全长
  | { kind: 'box'; size: readonly [number, number, number] };

// 初速度方向：
//   up / down 竖直；out 从发射点沿形状向外（点形状时随机方向）；
//   in 从形状上向发射点聚拢，速度按"生命结束时正好到中心"算，speed 是到达比例（1 = 正好到）；
//   toward 朝调用方给的目标；back 和发射点的运动方向相反（拖尾）；none 不给初速度。
export type DirMode = 'up' | 'down' | 'out' | 'in' | 'toward' | 'back' | 'none';

export type Layer = {
  name: string;
  // 预设默认 count 下这一层发多少；调用方改 count 时按比例缩放，fixed 的层（闪光、冲击环）不缩放
  count: number;
  fixed?: boolean;
  delay?: number;
  // 发射时长，0 是一次性迸发；'travel' 表示跟着预设的飞行时长（飞弹的拖尾）
  duration?: number | 'travel';
  life: Range;
  shape: Shape;
  offset?: Vec3Like;
  dir: DirMode;
  // 调用方给的 dir 是否覆盖这一层的方向（预设的主体层才跟着改，闪光、地面环不改）
  followDir?: boolean;
  spread?: number; // 方向随机的锥角（弧度，近似）
  lift?: number; // 方向上额外加的 y 分量，out 时让碎片往上飞
  speed: Range;
  inherit?: number; // 继承发射点运动速度的比例
  gravity?: number;
  drag?: number; // 每秒速度衰减比例
  swirl?: number; // 绕发射点竖直轴的角速度（弧度每秒）
  turbulence?: number; // 扰动加速度
  floor?: boolean; // 碰到台面（y = 0）弹一下
  local?: boolean; // 跟着发射点走（位置相对发射点）
  size: Range;
  sizeCurve?: Curve;
  alphaCurve?: Curve;
  gradient: readonly GradientStop[];
  // 每个粒子从调色板里随机取一个颜色乘到渐变上（渐变这时只管亮度，用白色）
  palette?: readonly ColorRef[];
  brightJitter?: number; // 亮度随机 ±比例
  cell: Cell;
  blend: Blend;
  // 进选择性泛光（只给小而亮的粒子：火花、光点；大面积的闪光和烟不进，否则会把底下的台面一起晕开）
  bloom?: boolean;
  align: Align;
  stretch?: number;
  aspect?: number;
  spin?: Range; // 自转角速度，随机正负
  flip?: Range; // tumble 的翻转角速度
  soft?: boolean; // 软粒子：贴近台面时淡出，不出现硬切边
};

export type PresetDef = {
  // 分镜里不写 count 时用的默认数量，各层的 count 按 count / 默认 缩放
  count: number;
  dir: 'up' | 'out' | 'in' | 'toward';
  color: number;
  // 飞行时长：给了目标时发射点从 at 匀速（"线"）飞到 to，层的 duration 'travel' 跟着它
  travel?: number;
  arc?: number; // 飞行弧线中点抬高
  sweep?: Vec3Like; // 没给目标时的默认挥动：从 at - sweep/2 飞到 at + sweep/2
  layers: readonly Layer[];
};
