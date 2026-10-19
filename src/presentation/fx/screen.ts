// 画面级反馈（m4-storyboard 1.4）：震屏 S1 到 S3、边缘泛红、棋盘闪、S3 的白闪。
// - 震屏是镜头位置上叠加的衰减噪声，写进 stage.cameraShake。同一时刻只有一个震屏在跑：新的比正在跑的剩余幅度大才替换，
//   所以同一帧的多个震屏取最大、不叠加。
// - 频率限制：S2 以上每回合不超过 3 次，同一秒内不重复；超出的降一档。回合按 scene.view.turn 算，时间按全局时间线
//   （跟着快进和慢放走）。
// - 泛红、白闪、棋盘闪画在一块覆盖全屏的四边形上（裁剪空间直接输出，不受镜头影响、不进泛光），挂在场景的 top 层。
import gsap from 'gsap';
import * as THREE from 'three';
import type { TableScene } from '../../scene/table';

export type ShakeLevel = 0 | 1 | 2 | 3;

// 分镜 1.4 的数值。amp 是画面高的比例，换算成镜头位移：镜头离台面约 21 单位、视角 38°，画面高约 14.5 单位
export const SCREEN = {
  viewHeight: 14.5,
  shake: {
    1: { amp: 0.003, time: 0.12 },
    2: { amp: 0.008, time: 0.2 },
    3: { amp: 0.015, time: 0.32 },
  } as Record<1 | 2 | 3, { amp: number; time: number }>,
  shakeHz: 28, // 噪声频率
  heavyPerTurn: 3, // S2 以上每回合最多几次
  heavyGap: 1, // S2 以上两次之间至少隔几秒
  whiteFlash: 0.15, // S3 白闪峰值
  whiteFlashTime: 0.06,
  edgeRed: 0.35, // 边缘泛红峰值
  edgeIn: 0.1,
  edgeOut: 0.4,
  edgeInner: 0.45, // 泛红从画面中心往外多远开始（1 是左右边缘的正中）
  edgeOuter: 1.15,
  edgeGain: 0.5, // 泛红的颜色强度（线性空间，见着色器里的说明）
  flashGain: 0.35, // 白闪、棋盘闪的颜色强度
  boardFlash: 0.12, // 棋盘闪峰值
  boardFlashIn: 0.08,
  boardFlashOut: 0.2,
};

type ShakeState = { amp: number; left: number; total: number; tween: gsap.core.Tween | null; heavy: { turn: number; n: number; last: number } };
const states = new WeakMap<TableScene, ShakeState>();

function stateOf(scene: TableScene): ShakeState {
  let s = states.get(scene);
  if (!s) {
    s = { amp: 0, left: 0, total: 0, tween: null, heavy: { turn: -1, n: 0, last: -Infinity } };
    states.set(scene, s);
  }
  return s;
}

// 频率限制后的实际档位（会记账，只在真要震时调用）
export function allowShake(scene: TableScene, level: ShakeLevel, now = gsap.globalTimeline.time()): ShakeLevel {
  const h = stateOf(scene).heavy;
  const turn = scene.view.turn;
  if (h.turn !== turn) Object.assign(h, { turn, n: 0, last: -Infinity });
  let l = level;
  while (l >= 2 && (h.n >= SCREEN.heavyPerTurn || now - h.last < SCREEN.heavyGap)) l = (l - 1) as ShakeLevel;
  if (l >= 2) {
    h.n++;
    h.last = now;
  }
  return l;
}

// 震一下屏。返回实际的档位（受频率限制可能降档，0 表示没震）
export function screenShake(scene: TableScene, level: ShakeLevel): ShakeLevel {
  if (level <= 0) return 0;
  const l = allowShake(scene, level);
  if (l <= 0) return 0;
  const def = SCREEN.shake[l as 1 | 2 | 3];
  const amp = def.amp * SCREEN.viewHeight;
  const s = stateOf(scene);
  const remaining = s.total > 0 ? s.amp * (s.left / s.total) : 0;
  if (amp < remaining) return l;
  s.tween?.kill();
  const cam = scene.stage.cameraShake;
  const seed = Math.random() * 100;
  const st = { k: 1 };
  s.amp = amp;
  s.total = def.time;
  s.left = def.time;
  s.tween = gsap.to(st, {
    k: 0,
    duration: def.time,
    ease: 'none',
    onUpdate: () => {
      const t = (1 - st.k) * def.time;
      s.left = st.k * def.time;
      const a = amp * st.k * st.k; // 二次衰减
      const w = t * SCREEN.shakeHz * Math.PI * 2;
      cam.set(a * (Math.sin(w + seed) * 0.7 + Math.sin(w * 2.3 + seed * 1.7) * 0.3), a * (Math.sin(w * 1.3 + seed * 2.1) * 0.7 + Math.sin(w * 2.9 + seed) * 0.3), 0);
    },
    onComplete: () => {
      cam.set(0, 0, 0);
      s.total = 0;
      s.tween = null;
    },
  });
  if (l === 3) overlayOf(scene).pulse('white', 0xffffff, SCREEN.whiteFlash, 0, SCREEN.whiteFlashTime);
  return l;
}

// 我方英雄受重伤时四边泛红
export function edgeRed(scene: TableScene, peak = SCREEN.edgeRed): void {
  overlayOf(scene).pulse('edge', 0xff1a10, peak, SCREEN.edgeIn, SCREEN.edgeOut);
}

// 全屏加色闪一下（群体法术、群体冻结）
export function boardFlash(scene: TableScene, color: number, peak = SCREEN.boardFlash): void {
  overlayOf(scene).pulse('board', color, peak, SCREEN.boardFlashIn, SCREEN.boardFlashOut);
}

type Channel = 'edge' | 'white' | 'board';

class ScreenOverlay {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private tweens: Partial<Record<Channel, gsap.core.Timeline>> = {};

  constructor() {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        edgeColor: { value: new THREE.Color(0xff1a10) },
        edge: { value: 0 },
        whiteColor: { value: new THREE.Color(0xffffff) },
        white: { value: 0 },
        boardColor: { value: new THREE.Color(0xffffff) },
        board: { value: 0 },
        shape: { value: new THREE.Vector4(SCREEN.edgeInner, SCREEN.edgeOuter, SCREEN.edgeGain, SCREEN.flashGain) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      // 输出预乘过的颜色，加色和普通混合一次搞定：泛红是普通混合（边缘压暗再染一点红），闪光是加色。
      // 这块四边形画在色调映射之前的线性 HDR 缓冲里：底下的台面亮度只有 0.05 左右，直接叠 35% 的纯红经过 ACES 后
      // 会变成满屏通红，所以颜色按 gain 压低，透明度主要用来压暗边缘
      fragmentShader: `
        uniform vec3 edgeColor; uniform float edge;
        uniform vec3 whiteColor; uniform float white;
        uniform vec3 boardColor; uniform float board;
        uniform vec4 shape; // 泛红内径、外径、泛红颜色强度、闪光颜色强度
        varying vec2 vUv;
        void main() {
          vec2 d = (vUv - 0.5) * 2.0 * vec2(1.0, 0.85);
          float v = smoothstep(shape.x, shape.y, length(d));
          float a = edge * v;
          vec3 add = (whiteColor * white + boardColor * board) * shape.w;
          gl_FragColor = vec4(edgeColor * a * shape.z + add, a);
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1000;
    this.mesh.visible = false;
  }

  pulse(ch: Channel, color: number, peak: number, rise: number, fall: number): void {
    const u = this.mesh.material.uniforms;
    (u.shape.value as THREE.Vector4).set(SCREEN.edgeInner, SCREEN.edgeOuter, SCREEN.edgeGain, SCREEN.flashGain);
    const key = ch === 'edge' ? 'edge' : ch === 'white' ? 'white' : 'board';
    (u[`${key}Color`].value as THREE.Color).setHex(color);
    this.tweens[ch]?.kill();
    const t = gsap.timeline({ onUpdate: () => this.refresh(), onComplete: () => this.refresh() });
    const p = u[key];
    if (rise > 0) t.fromTo(p, { value: Math.max(p.value as number, 0) }, { value: peak, duration: rise, ease: 'power2.out' });
    else t.set(p, { value: peak });
    t.to(p, { value: 0, duration: fall, ease: 'power1.in' });
    this.tweens[ch] = t;
    this.refresh();
  }

  // 预编译结束：没有闪光在跑就藏起来
  settle(): void {
    this.refresh();
  }

  private refresh(): void {
    const u = this.mesh.material.uniforms;
    this.mesh.visible = (u.edge.value as number) > 0.001 || (u.white.value as number) > 0.001 || (u.board.value as number) > 0.001;
  }
}

const overlays = new WeakMap<TableScene, ScreenOverlay>();

function overlayOf(scene: TableScene): ScreenOverlay {
  let o = overlays.get(scene);
  if (!o) {
    o = new ScreenOverlay();
    scene.layers.top.add(o.mesh);
    overlays.set(scene, o);
  }
  return o;
}

// 预先编译画面反馈用的着色器（全屏四边形是自定义着色器，第一次用时现编译会卡一帧）。对局场景建好时调一次，
// 用 compileAsync 在后台编译，编译完把四边形藏起来
export function warmScreenFx(scene: TableScene): void {
  const o = overlayOf(scene);
  o.mesh.visible = true;
  const r = scene.stage.renderer;
  const done = () => o.settle();
  r.compileAsync(o.mesh, scene.stage.camera, scene.stage.scene).then(done, done);
}
