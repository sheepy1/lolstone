// 水晶枢纽台座四周的一圈半球形小灯（spec 5.2、5.4 v0.6.7）。每颗灯嵌在六棱台一个侧面的正中，朝外、顺着侧面的斜度：
// - 一个暗色的凹槽，外面一圈凸起的金属灯座（和台座的金属沿同一种材质），看起来是嵌进去的；
// - 半球形玻璃罩：加色混合的两层，菲涅尔边缘亮光加只剩高光的清漆层（漫反射是黑色，加色混合后只看得到高光，
//   高光点随镜头角度移动）；玻璃罩不写深度、不进泛光；
// - 罩里一个小的自发光灯芯，我方蓝、对方红，只有灯芯进泛光。
// 灯芯的亮度每帧算：很慢的呼吸明暗，自己的回合亮一些、对方回合暗一些；生命低于 10 时从后往前逐颗熄灭，
// 剩下的灯快速不稳地闪。参数在 NEXUS_LAMP，调试台 /dev/fx 里可以现场调。
import * as THREE from 'three';
import { fresnelMaterial, hdr, markBloom } from '../presentation/fx/materials';
import { shared } from './dispose';

export const NEXUS_LAMP = {
  radius: 0.1, // 玻璃罩半径
  core: 1.8, // 灯芯基础亮度（HDR 倍数）。太高时 ACES 把亮暗两档都压成白色，看不出回合差别
  active: 1.0, // 自己回合的亮度系数
  idle: 0.3, // 对方回合的亮度系数
  period: 2.6, // 呼吸周期（秒）
  breath: 0.12, // 呼吸幅度（相对亮度）
  fade: 0.5, // 换回合时亮度过渡的时间常数（秒）
  low: 10, // 生命低于这个值进入危险状态
  lowPeriod: 0.7, // 危险时闪烁的周期
  lowBreath: 0.45, // 危险时闪烁的幅度
  off: 0.06, // 熄灭的灯剩下的亮度
  glass: 0.3, // 玻璃罩反射环境的强度
  rimGlass: 0.25, // 玻璃罩边缘本身的白光（灯灭时只剩它）
  rimGlow: 0.9, // 灯亮时边缘被灯芯染上的颜色强度
};

// 台座：CylinderGeometry(0.98, 1.1, 0.34, 6)，中心 y = 0.17。侧面在高度中点处离中心的距离（边心距）和侧面的外倾角度
const TOP_R = 0.98;
const BOTTOM_R = 1.1;
const PLINTH_H = 0.34;
const APOTHEM = ((TOP_R + BOTTOM_R) / 2) * Math.cos(Math.PI / 6);
const FACE_TILT = Math.atan((BOTTOM_R - TOP_R) / PLINTH_H);

const R = NEXUS_LAMP.radius;
const domeGeo = shared(new THREE.SphereGeometry(R, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2));
const coreGeo = shared(new THREE.SphereGeometry(R * 0.55, 16, 10));
const socketGeo = shared(new THREE.CircleGeometry(R * 1.02, 24));
const bezelGeo = shared(new THREE.TorusGeometry(R + 0.014, 0.019, 8, 28));
const socketMat = shared(new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 0.6, metalness: 0.4 }));
// 玻璃罩的高光层：漫反射为黑，加色混合后只留下太阳光的镜面高光和清漆高光
const glossMat = shared(
  new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    roughness: 0.12,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    envMapIntensity: NEXUS_LAMP.glass,
  }),
);

// 玻璃罩反射的环境（舞台的 reflections）。没有它时只剩太阳的一个小高光点，罩子读不出是玻璃
export function useLampReflections(env: THREE.Texture): void {
  if (glossMat.envMap === env) return;
  glossMat.envMap = env;
  glossMat.needsUpdate = true;
}

type Lamp = { root: THREE.Group; core: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; rim: THREE.ShaderMaterial };

export class NexusLamps extends THREE.Group {
  private readonly lamps: Lamp[] = [];
  private readonly team: THREE.Color;
  private readonly phase: number;
  private level = NEXUS_LAMP.idle; // 当前的亮度系数（平滑过渡）
  private active = false;
  private health = 30;
  private dim = 1;
  private lastT: number | null = null;
  private flared = false;

  constructor(teamColor: number, bezelMat: THREE.Material, phase = 0) {
    super();
    this.team = new THREE.Color(teamColor);
    this.phase = phase;
    // 六个侧面中心的方位角（three 的圆柱：x = r sin a，z = r cos a，a = 0 是正前方 +z）。按熄灭的先后排：
    // 先灭后排两颗，再灭左右两侧，最后是前排；右前那颗被生命徽章挡住一半，所以最后剩下的是左前那颗
    const order = [210, 150, 90, 270, 30, 330];
    for (const deg of order) {
      const a = (deg * Math.PI) / 180;
      const out = new THREE.Vector3(Math.sin(a) * Math.cos(FACE_TILT), Math.sin(FACE_TILT), Math.cos(a) * Math.cos(FACE_TILT));
      const root = new THREE.Group();
      root.position.set(Math.sin(a) * APOTHEM, PLINTH_H / 2, Math.cos(a) * APOTHEM).addScaledVector(out, 0.004);
      root.lookAt(root.position.clone().add(out)); // +z 朝外
      const socket = new THREE.Mesh(socketGeo, socketMat);
      const bezel = new THREE.Mesh(bezelGeo, bezelMat);
      bezel.position.z = 0.006;
      bezel.castShadow = true;
      const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: hdr(teamColor, NEXUS_LAMP.core), toneMapped: false }));
      core.position.z = R * 0.3;
      markBloom(core);
      const gloss = new THREE.Mesh(domeGeo, glossMat);
      // 玻璃罩的边缘亮光：每颗灯一份，颜色每帧按这颗灯的亮度算，灯亮时整个罩子透出灯的颜色，灯灭时只剩一圈淡白
      const rimMat = fresnelMaterial(new THREE.Color(), 0.05, 0.9, 2.5);
      const rim = new THREE.Mesh(domeGeo, rimMat);
      gloss.renderOrder = rim.renderOrder = 2; // 透明的罩在灯芯之后画
      root.add(socket, bezel, core, gloss, rim);
      this.add(root);
      this.lamps.push({ root, core, rim: rimMat });
    }
  }

  get roots(): THREE.Object3D[] {
    return this.lamps.map((l) => l.root);
  }

  // 是不是这一方的回合：自己的回合灯亮一些
  setActive(on: boolean): void {
    this.active = on;
  }

  setHealth(health: number): void {
    this.health = health;
  }

  // 不可选时整体压暗
  setDim(on: boolean): void {
    this.dim = on ? 0.45 : 1;
  }

  // 每帧调，t 是秒
  tick(t: number): void {
    if (this.flared) return;
    const P = NEXUS_LAMP;
    const dt = this.lastT === null ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    const target = this.active ? P.active : P.idle;
    glossMat.envMapIntensity = P.glass;
    this.level += (target - this.level) * (1 - Math.exp(-dt / Math.max(0.01, P.fade)));
    const low = this.health > 0 && this.health < P.low;
    // 危险时按生命比例留几颗亮着：9 到 1 点对应 6 到 1 颗
    const lit = low ? Math.max(1, Math.ceil((this.health / P.low) * this.lamps.length)) : this.lamps.length;
    const wave = (period: number, offset: number) => Math.sin(((t + offset) / period) * Math.PI * 2);
    this.lamps.forEach((lamp, i) => {
      let k: number;
      if (i < this.lamps.length - lit) k = P.off;
      else if (low) {
        // 两个周期不成整数比的波叠在一起，闪得不规则
        const w = 0.6 * wave(P.lowPeriod, this.phase + i * 0.13) + 0.4 * wave(P.lowPeriod * 0.37, this.phase + i * 0.29);
        k = Math.max(0.1, 1 + P.lowBreath * w);
      } else k = 1 + P.breath * wave(P.period, this.phase);
      const glow = this.level * this.dim * k;
      lamp.core.material.color.copy(this.team).multiplyScalar(P.core * glow);
      const rim = lamp.rim.uniforms.color.value as THREE.Color;
      rim.copy(this.team).multiplyScalar(P.rimGlow * glow);
      rim.r += P.rimGlass;
      rim.g += P.rimGlass;
      rim.b += P.rimGlass;
    });
  }

  // 输掉时：灯芯猛亮一下，然后整颗灯缩没（胜负动画里用）
  flare(): void {
    this.flared = true;
    for (const l of this.lamps) l.core.material.color.copy(this.team).multiplyScalar(NEXUS_LAMP.core * 2.5);
  }
}
