// 合批绘制的粒子系统（分镜表 1.5，spec 5.10、6.1）。
//
// - 全部粒子放在一个固定大小的池里（结构化数组，MAX_PARTICLES = 2000 格），池满时新粒子不生成，记在 dropped 里。
//   每帧只读写这些数组，不分配对象；emit 时才分配句柄和每层的发射状态。
// - 画的时候按混合方式分三批，每批一个 InstancedMesh（一次绘制调用）：
//     alpha 普通透明混合（烟、尘、碎片、纸屑），按远到近排序；
//     add   加法混合、不进泛光（大闪光、光柱、冲击环）；
//     bloom 加法混合、进泛光（火花、光点），另有一个只写深度的同形网格给选择性泛光对像素（见 material.ts）。
//   朝向、拉伸、翻转在 CPU 上算进实例矩阵：泛光的深度通道用 MeshDepthMaterial 重画，只认实例矩阵。
// - 时间：update(dt) 由调用方每帧驱动（gsap.ts 的 driveWithGsap 接到 GSAP 的时钟上，跟随全局时间线的快进和慢放），
//   系统自己有 timeScale，每次发射的句柄也有 timeScale。
// - 资源：几何体、材质、图集贴图都归系统所有，dispose() 一起释放。系统的物件树不要交给 scene/dispose.ts 的
//   releaseGpu 去放（它不认 ShaderMaterial 里的贴图），一局结束时调 dispose()。
import * as THREE from 'three';
import { BLOOM_LAYER } from '../materials';
import { createAtlas } from './atlas';
import { colorLut, compilePreset, lut1, paletteOf, Rng, type CompiledLayer, type CompiledPreset } from './compile';
import { createParticleMaterial } from './material';
import { PRESETS, type PresetName } from './presets';
import type { DirMode, PresetDef, Vec3Like } from './types';

export const MAX_PARTICLES = 2000; // spec 5.10

export type EmitOptions = {
  at: Vec3Like;
  // 目标：飞弹、挥砍从 at 飞到 to；其他预设的方向朝它（dir toward）
  to?: Vec3Like;
  count?: number;
  dir?: 'up' | 'out' | 'in' | 'toward';
  color?: number | string;
  scale?: number;
  // 飞行时长（秒），覆盖预设的 travel
  duration?: number;
  // 每帧取发射点（跟随正在动的物件，比如冲锋中的随从）；给了就不按 at → to 飞行
  follow?: () => Vec3Like;
  timeScale?: number;
};

export type ParticleStats = {
  live: number;
  dropped: number; // 累计因为池满没生成的粒子
  handles: number;
  drawCalls: number;
  updateMs: number; // 上一帧 update 的耗时
};

type SystemOptions = {
  camera: THREE.Camera;
  capacity?: number;
  seed?: number;
  // 每层数量的随机浮动比例（spec 5.5 "粒子数量小幅随机"），0 关掉
  countJitter?: number;
  groundY?: number;
};

const compiled = new WeakMap<PresetDef, CompiledPreset>();
function compiledOf(def: PresetDef): CompiledPreset {
  let c = compiled.get(def);
  if (!c) {
    c = compilePreset(def);
    compiled.set(def, c);
  }
  return c;
}

const ALPHA = 0;
const ADD = 1;
const BLOOM = 2;

class Run {
  emitted = 0;
  live = 0;
  constructor(
    readonly id: number,
    readonly layer: CompiledLayer,
    readonly handle: ParticleHandle,
    readonly total: number,
    readonly emitDuration: number,
    readonly delay: number,
    readonly dirMode: DirMode,
    readonly lut: Float32Array,
    readonly palette: Float32Array | null,
    readonly batch: number,
  ) {}
}

// 一次发射的句柄：可以 await（全部粒子消失后完成）、kill（立刻清掉）、stop（不再发射，已有的放完）、改时间缩放。
// origin 是发射点，可以直接交给 GSAP 去补间（gsap.to(handle.origin, {...})）。
export class ParticleHandle implements PromiseLike<void> {
  readonly origin = new THREE.Vector3();
  readonly prev = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly dir = new THREE.Vector3(0, 1, 0);
  readonly runs: Run[] = [];
  spawned = 0;
  dropped = 0;
  live = 0;
  elapsed = 0;
  stopped = false;
  finished = false;
  ts = 1;
  start: THREE.Vector3 | null = null;
  end: THREE.Vector3 | null = null;
  travelTime = 0;
  arc = 0;
  private readonly promise: Promise<void>;
  private resolveFn!: () => void;

  constructor(
    private readonly system: ParticleSystem,
    readonly name: string,
    readonly scale: number,
    readonly duration: number, // 预计总时长（秒，未计时间缩放）
    readonly follow: (() => Vec3Like) | null,
  ) {
    this.promise = new Promise((r) => (this.resolveFn = r));
  }

  timeScale(): number;
  timeScale(v: number): this;
  timeScale(v?: number): number | this {
    if (v === undefined) return this.ts;
    this.ts = Math.max(0, v);
    return this;
  }

  kill(): void {
    this.system.kill(this);
  }

  stop(): void {
    this.stopped = true;
  }

  then<A = void, B = never>(onOk?: ((v: void) => A | PromiseLike<A>) | null, onErr?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.promise.then(onOk, onErr);
  }

  // 系统内部用
  resolve(): void {
    this.finished = true;
    this.resolveFn();
  }
}

type Batch = {
  mesh: THREE.InstancedMesh;
  core: THREE.InstancedMesh | null;
  matrix: Float32Array;
  color: Float32Array;
  misc: Float32Array;
  colorAttr: THREE.InstancedBufferAttribute;
  miscAttr: THREE.InstancedBufferAttribute;
  // 排序用的暂存（alpha、bloom 两批按远到近）
  sorted: boolean;
  sMatrix: Float32Array;
  sColor: Float32Array;
  sMisc: Float32Array;
  keys: Float32Array;
  order: Int32Array;
  n: number;
};

export class ParticleSystem {
  readonly object = new THREE.Group();
  readonly capacity: number;
  timeScale = 1;
  readonly atlas: THREE.DataTexture;
  private readonly camera: THREE.Camera;
  private readonly rng: Rng;
  private readonly countJitter: number;
  private readonly groundY: number;
  private readonly batches: Batch[];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.ShaderMaterial[] = [];
  private disposed = false;

  // 粒子池（每个数组一格一个粒子）
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  private readonly flip: Float32Array;
  private readonly flipRate: Float32Array;
  private readonly seed: Float32Array;
  private readonly tint: Float32Array; // rgb
  private readonly slotRun: Int32Array; // -1 空闲
  private readonly freeStack: Int32Array;
  private freeTop: number;

  private readonly runs: (Run | null)[] = [];
  private readonly freeRunIds: number[] = [];
  private readonly active: ParticleHandle[] = [];
  private liveCount = 0;
  private droppedCount = 0;
  private lastUpdateMs = 0;

  // 镜头基向量（每帧从 camera.matrixWorld 取）
  private rx = 1;
  private ry = 0;
  private rz = 0;
  private ux = 0;
  private uy = 1;
  private uz = 0;
  private fx = 0;
  private fy = 0;
  private fz = 1;
  private cx = 0;
  private cy = 0;
  private cz = 0;

  constructor(opts: SystemOptions) {
    this.camera = opts.camera;
    this.capacity = opts.capacity ?? MAX_PARTICLES;
    this.rng = new Rng(opts.seed ?? 0x5eed);
    this.countJitter = opts.countJitter ?? 0.1;
    this.groundY = opts.groundY ?? 0;
    const n = this.capacity;
    const f = () => new Float32Array(n);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.age = f();
    this.life = f();
    this.size = f();
    this.rot = f();
    this.spin = f();
    this.flip = f();
    this.flipRate = f();
    this.seed = f();
    this.tint = new Float32Array(n * 3);
    this.slotRun = new Int32Array(n).fill(-1);
    this.freeStack = new Int32Array(n);
    for (let i = 0; i < n; i++) this.freeStack[i] = n - 1 - i;
    this.freeTop = n;

    this.atlas = createAtlas();
    this.object.name = 'particles';
    this.batches = [this.makeBatch(ALPHA, 40), this.makeBatch(ADD, 43), this.makeBatch(BLOOM, 42)];
  }

  private makeBatch(kind: number, renderOrder: number): Batch {
    const n = this.capacity;
    const geo = new THREE.PlaneGeometry(1, 1);
    const color = new Float32Array(n * 4);
    const misc = new Float32Array(n);
    const colorAttr = new THREE.InstancedBufferAttribute(color, 4).setUsage(THREE.DynamicDrawUsage);
    const miscAttr = new THREE.InstancedBufferAttribute(misc, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iColor', colorAttr);
    geo.setAttribute('iMisc', miscAttr);
    const mat = createParticleMaterial(kind === ALPHA ? 'alpha' : 'add', this.atlas);
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;
    mesh.count = 0;
    mesh.visible = false;
    mesh.name = `particles-${['alpha', 'add', 'bloom'][kind]}`;
    this.object.add(mesh);
    this.geometries.push(geo);
    this.materials.push(mat);
    let core: THREE.InstancedMesh | null = null;
    if (kind === BLOOM) {
      const coreMat = createParticleMaterial('core', this.atlas);
      core = new THREE.InstancedMesh(geo, coreMat, 1);
      core.instanceMatrix = mesh.instanceMatrix; // 和颜色网格共用实例数据
      core.frustumCulled = false;
      core.renderOrder = renderOrder - 1;
      core.count = 0;
      core.visible = false;
      core.layers.enable(BLOOM_LAYER);
      core.name = 'particles-bloom-depth';
      this.object.add(core);
      this.materials.push(coreMat);
    }
    const sorted = kind !== ADD;
    return {
      mesh,
      core,
      matrix: mesh.instanceMatrix.array as Float32Array,
      color,
      misc,
      colorAttr,
      miscAttr,
      sorted,
      sMatrix: sorted ? new Float32Array(n * 16) : new Float32Array(0),
      sColor: sorted ? new Float32Array(n * 4) : new Float32Array(0),
      sMisc: sorted ? new Float32Array(n) : new Float32Array(0),
      keys: sorted ? new Float32Array(n) : new Float32Array(0),
      order: sorted ? new Int32Array(n) : new Int32Array(0),
      n: 0,
    };
  }

  get live(): number {
    return this.liveCount;
  }

  get dropped(): number {
    return this.droppedCount;
  }

  get stats(): ParticleStats {
    let drawCalls = 0;
    for (const b of this.batches) if (b.n > 0) drawCalls += b.core ? 2 : 1;
    return { live: this.liveCount, dropped: this.droppedCount, handles: this.active.length, drawCalls, updateMs: this.lastUpdateMs };
  }

  // 测试用：池里空闲的格子数、每格属于哪个发射层
  get debug(): { free: number; slotRun: Int32Array; runSlots: number } {
    return { free: this.freeTop, slotRun: this.slotRun, runSlots: this.runs.length };
  }

  emit(preset: PresetName | PresetDef, opts: EmitOptions): ParticleHandle {
    const def = typeof preset === 'string' ? PRESETS[preset] : preset;
    if (!def) throw new Error(`没有这个粒子预设：${String(preset)}`);
    const name = typeof preset === 'string' ? preset : 'custom';
    const cp = compiledOf(def);
    const scale = opts.scale ?? 1;
    const main = opts.color === undefined ? def.color : typeof opts.color === 'number' ? opts.color : new THREE.Color(opts.color).getHex();
    const ratio = Math.max(0, (opts.count ?? def.count) / def.count);
    const to = opts.to ?? null;
    const travel = opts.duration ?? def.travel ?? 0;
    let override: DirMode | null = opts.dir ?? (to && !def.travel ? 'toward' : null);
    if (override === 'toward' && !to) override = null;

    const h = new ParticleHandle(this, name, scale, presetDuration(def, opts), opts.follow ?? null);
    h.ts = opts.timeScale ?? 1;
    h.travelTime = travel;
    h.arc = (def.arc ?? 0) * scale;
    const at = opts.follow ? opts.follow() : opts.at;
    h.origin.set(at.x, at.y, at.z);
    if (def.travel && !opts.follow) {
      if (to) {
        h.start = new THREE.Vector3(at.x, at.y, at.z);
        h.end = new THREE.Vector3(to.x, to.y, to.z);
      } else if (def.sweep) {
        const s = def.sweep;
        h.start = new THREE.Vector3(at.x - (s.x * scale) / 2, at.y - (s.y * scale) / 2, at.z - (s.z * scale) / 2);
        h.end = new THREE.Vector3(at.x + (s.x * scale) / 2, at.y + (s.y * scale) / 2, at.z + (s.z * scale) / 2);
      }
      if (h.start) h.origin.copy(h.start);
    }
    h.prev.copy(h.origin);
    if (to) {
      h.dir.set(to.x - at.x, to.y - at.y, to.z - at.z);
      if (h.dir.lengthSq() < 1e-8) h.dir.set(0, 1, 0);
      h.dir.normalize();
    }
    if (this.disposed) {
      h.resolve();
      return h;
    }

    for (const layer of cp.layers) {
      const src = layer.src;
      let total = src.count;
      if (!src.fixed) total = Math.round(src.count * ratio * (1 + this.countJitter * (this.rng.next() * 2 - 1)));
      if (total <= 0) continue;
      const id = this.freeRunIds.length > 0 ? this.freeRunIds.pop()! : this.runs.length;
      const dirMode = override && src.followDir ? override : src.dir;
      const emitDuration = src.duration === 'travel' ? travel : (src.duration ?? 0);
      const batch = src.blend === 'alpha' ? ALPHA : src.bloom ? BLOOM : ADD;
      const run = new Run(id, layer, h, total, emitDuration, src.delay ?? 0, dirMode, colorLut(layer, main), paletteOf(layer, main), batch);
      this.runs[id] = run;
      h.runs.push(run);
    }
    this.active.push(h);
    return h;
  }

  kill(h: ParticleHandle): void {
    if (h.finished) return;
    if (h.live > 0) {
      for (let i = 0; i < this.capacity; i++) {
        const r = this.slotRun[i]!;
        if (r >= 0 && this.runs[r]!.handle === h) this.free(i);
      }
    }
    h.stopped = true;
    const k = this.active.indexOf(h);
    if (k >= 0) this.finish(k);
  }

  // 清掉所有正在播的发射
  killAll(): void {
    while (this.active.length > 0) this.kill(this.active[this.active.length - 1]!);
  }

  update(dt: number): void {
    if (this.disposed) return;
    const t0 = now();
    const sdt = Math.min(Math.max(dt, 0), 0.1) * this.timeScale;
    this.readCamera();

    // 1. 各次发射：移动发射点，按进度补发粒子
    for (let k = 0; k < this.active.length; k++) {
      const h = this.active[k]!;
      const hdt = sdt * h.ts;
      h.elapsed += hdt;
      this.moveOrigin(h, hdt);
      if (!h.stopped) {
        for (const run of h.runs) this.emitRun(run);
      }
      h.prev.copy(h.origin);
    }

    // 2. 粒子：积分、回收、写实例数据
    for (const b of this.batches) b.n = 0;
    const gY = this.groundY;
    for (let i = 0; i < this.capacity; i++) {
      const ri = this.slotRun[i]!;
      if (ri < 0) continue;
      const run = this.runs[ri]!;
      const h = run.handle;
      const L = run.layer;
      const src = L.src;
      const pdt = sdt * h.ts;
      const a = this.age[i]! + pdt;
      if (a >= this.life[i]!) {
        this.free(i);
        continue;
      }
      this.age[i] = a;
      const s = h.scale;
      let vx = this.vx[i]!;
      let vy = this.vy[i]!;
      let vz = this.vz[i]!;
      if (src.gravity) vy += src.gravity * s * pdt;
      if (src.turbulence) {
        const T = src.turbulence * s * pdt;
        const sd = this.seed[i]!;
        vx += T * Math.sin(a * 3.1 + sd * 40 + this.py[i]! * 1.7);
        vy += T * 0.5 * Math.sin(a * 2.3 + sd * 17);
        vz += T * Math.cos(a * 2.7 + sd * 29 + this.px[i]! * 1.7);
      }
      if (src.drag) {
        const d = Math.max(0, 1 - src.drag * pdt);
        vx *= d;
        vy *= d;
        vz *= d;
      }
      const ox = this.px[i]!;
      const oy = this.py[i]!;
      const oz = this.pz[i]!;
      let x = ox + vx * pdt;
      let y = oy + vy * pdt;
      let z = oz + vz * pdt;
      if (src.swirl) {
        const ang = src.swirl * pdt;
        const c = Math.cos(ang);
        const sn = Math.sin(ang);
        const ccx = src.local ? 0 : h.origin.x;
        const ccz = src.local ? 0 : h.origin.z;
        const dx = x - ccx;
        const dz = z - ccz;
        x = ccx + dx * c - dz * sn;
        z = ccz + dx * sn + dz * c;
        const nvx = vx * c - vz * sn;
        vz = vx * sn + vz * c;
        vx = nvx;
      }
      if (src.floor && !src.local && y < gY) {
        y = gY;
        if (vy < 0) vy = -vy * 0.3;
        vx *= 0.6;
        vz *= 0.6;
        this.spin[i] = this.spin[i]! * 0.5;
        this.flipRate[i] = this.flipRate[i]! * 0.5;
      }
      this.px[i] = x;
      this.py[i] = y;
      this.pz[i] = z;
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.vz[i] = vz;
      this.rot[i] = this.rot[i]! + this.spin[i]! * pdt;
      this.flip[i] = this.flip[i]! + this.flipRate[i]! * pdt;

      // 朝向用这一帧的实际位移（含绕转），没有位移时用速度
      let mvx = vx;
      let mvy = vy;
      let mvz = vz;
      if (pdt > 0) {
        mvx = (x - ox) / pdt;
        mvy = (y - oy) / pdt;
        mvz = (z - oz) / pdt;
      }
      const t = a / this.life[i]!;
      const wx = src.local ? x + h.origin.x : x;
      const wy = src.local ? y + h.origin.y : y;
      const wz = src.local ? z + h.origin.z : z;
      this.writeInstance(run, i, t, wx, wy, wz, mvx, mvy, mvz);
    }

    // 3. 排序、上传
    for (const b of this.batches) this.flush(b);

    // 4. 放完的发射结束
    for (let k = this.active.length - 1; k >= 0; k--) {
      const h = this.active[k]!;
      if (h.live > 0) continue;
      let done = h.stopped;
      if (!done) {
        done = true;
        for (const run of h.runs) {
          if (run.emitted < run.total) {
            done = false;
            break;
          }
        }
      }
      if (done) this.finish(k);
    }
    this.lastUpdateMs = now() - t0;
  }

  private readCamera(): void {
    const e = this.camera.matrixWorld.elements;
    this.rx = e[0]!;
    this.ry = e[1]!;
    this.rz = e[2]!;
    this.ux = e[4]!;
    this.uy = e[5]!;
    this.uz = e[6]!;
    this.fx = e[8]!;
    this.fy = e[9]!;
    this.fz = e[10]!;
    this.cx = e[12]!;
    this.cy = e[13]!;
    this.cz = e[14]!;
    // 镜头矩阵可能带缩放，基向量归一化
    const rl = Math.hypot(this.rx, this.ry, this.rz) || 1;
    const ul = Math.hypot(this.ux, this.uy, this.uz) || 1;
    const fl = Math.hypot(this.fx, this.fy, this.fz) || 1;
    this.rx /= rl;
    this.ry /= rl;
    this.rz /= rl;
    this.ux /= ul;
    this.uy /= ul;
    this.uz /= ul;
    this.fx /= fl;
    this.fy /= fl;
    this.fz /= fl;
  }

  private moveOrigin(h: ParticleHandle, hdt: number): void {
    if (h.follow) {
      const p = h.follow();
      h.origin.set(p.x, p.y, p.z);
    } else if (h.start && h.end) {
      const k = h.travelTime > 0 ? Math.min(1, h.elapsed / h.travelTime) : 1;
      h.origin.lerpVectors(h.start, h.end, k);
      h.origin.y += h.arc * Math.sin(Math.PI * k);
    }
    if (hdt > 0) {
      h.vel.set((h.origin.x - h.prev.x) / hdt, (h.origin.y - h.prev.y) / hdt, (h.origin.z - h.prev.z) / hdt);
    }
  }

  private emitRun(run: Run): void {
    if (run.emitted >= run.total) return;
    const h = run.handle;
    const t = h.elapsed - run.delay;
    if (t < 0) return;
    const target = run.emitDuration <= 0 ? run.total : Math.min(run.total, Math.ceil((run.total * t) / run.emitDuration));
    const n = target - run.emitted;
    for (let k = 0; k < n; k++) this.spawn(run, (k + 1) / n);
  }

  private spawn(run: Run, f: number): void {
    const h = run.handle;
    run.emitted++;
    if (this.freeTop === 0) {
      this.droppedCount++;
      h.dropped++;
      return;
    }
    const i = this.freeStack[--this.freeTop]!;
    const rng = this.rng;
    const L = run.layer;
    const src = L.src;
    const s = h.scale;

    // 发射点在上一帧和这一帧之间插值，快速移动的发射点也是连续的拖尾
    const off = src.offset;
    const bx = h.prev.x + (h.origin.x - h.prev.x) * f + (off ? off.x * s : 0);
    const by = h.prev.y + (h.origin.y - h.prev.y) * f + (off ? off.y * s : 0);
    const bz = h.prev.z + (h.origin.z - h.prev.z) * f + (off ? off.z * s : 0);

    // 形状上的偏移
    let ox = 0;
    let oy = 0;
    let oz = 0;
    const shape = src.shape;
    let radialY = true;
    if (shape.kind === 'sphere') {
      const u = rng.next() * 2 - 1;
      const th = rng.next() * Math.PI * 2;
      const q = Math.sqrt(1 - u * u);
      const r = shape.radius * s * (shape.surface ? 1 : Math.cbrt(rng.next()));
      ox = q * Math.cos(th) * r;
      oy = (shape.hemi ? Math.abs(u) : u) * r;
      oz = q * Math.sin(th) * r;
    } else if (shape.kind === 'disc') {
      const th = rng.next() * Math.PI * 2;
      const r = shape.radius * s * (shape.edge ? 1 : Math.sqrt(rng.next()));
      ox = Math.cos(th) * r;
      oz = Math.sin(th) * r;
      oy = rng.range(L.hMin, L.hMax) * s;
      radialY = false;
    } else if (shape.kind === 'box') {
      ox = (rng.next() - 0.5) * shape.size[0] * s;
      oy = (rng.next() - 0.5) * shape.size[1] * s;
      oz = (rng.next() - 0.5) * shape.size[2] * s;
      radialY = false;
    }
    const x = bx + ox;
    const y = by + oy;
    const z = bz + oz;

    const life = rng.range(L.lifeMin, L.lifeMax);
    let vx = 0;
    let vy = 0;
    let vz = 0;
    const mode = run.dirMode;
    if (mode === 'in') {
      const k = rng.range(L.speedMin, L.speedMax) / life;
      vx = -ox * k;
      vy = -oy * k;
      vz = -oz * k;
    } else if (mode !== 'none') {
      let dx = 0;
      let dy = 1;
      let dz = 0;
      if (mode === 'down') dy = -1;
      else if (mode === 'out') {
        const rx = ox;
        const ry = radialY ? oy : 0;
        const rz = oz;
        const l = Math.hypot(rx, ry, rz);
        if (l > 1e-5) {
          dx = rx / l;
          dy = ry / l;
          dz = rz / l;
        } else {
          const u = rng.next() * 2 - 1;
          const th = rng.next() * Math.PI * 2;
          const q = Math.sqrt(1 - u * u);
          dx = q * Math.cos(th);
          dy = u;
          dz = q * Math.sin(th);
        }
      } else if (mode === 'toward') {
        dx = h.dir.x;
        dy = h.dir.y;
        dz = h.dir.z;
      } else if (mode === 'back') {
        const l = h.vel.length();
        if (l > 1e-4) {
          dx = -h.vel.x / l;
          dy = -h.vel.y / l;
          dz = -h.vel.z / l;
        }
      }
      if (src.lift) dy += src.lift;
      const sp = src.spread ?? 0;
      if (sp > 0) {
        dx += (rng.next() * 2 - 1) * sp;
        dy += (rng.next() * 2 - 1) * sp;
        dz += (rng.next() * 2 - 1) * sp;
      }
      const l = Math.hypot(dx, dy, dz) || 1;
      const speed = rng.range(L.speedMin, L.speedMax) * s;
      vx = (dx / l) * speed;
      vy = (dy / l) * speed;
      vz = (dz / l) * speed;
    }
    if (src.inherit) {
      vx += h.vel.x * src.inherit;
      vy += h.vel.y * src.inherit;
      vz += h.vel.z * src.inherit;
    }

    if (src.local) {
      this.px[i] = x - h.origin.x;
      this.py[i] = y - h.origin.y;
      this.pz[i] = z - h.origin.z;
    } else {
      this.px[i] = x;
      this.py[i] = y;
      this.pz[i] = z;
    }
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i] = rng.range(L.sizeMin, L.sizeMax) * s;
    this.rot[i] = rng.next() * Math.PI * 2;
    this.spin[i] = rng.range(L.spinMin, L.spinMax) * (rng.next() < 0.5 ? -1 : 1);
    this.flip[i] = rng.next() * Math.PI * 2;
    this.flipRate[i] = rng.range(L.flipMin, L.flipMax);
    this.seed[i] = rng.next();
    const bj = src.brightJitter ? 1 + src.brightJitter * (rng.next() * 2 - 1) : 1;
    const pal = run.palette;
    if (pal) {
      const p = Math.floor(rng.next() * (pal.length / 3)) * 3;
      this.tint[i * 3] = pal[p]! * bj;
      this.tint[i * 3 + 1] = pal[p + 1]! * bj;
      this.tint[i * 3 + 2] = pal[p + 2]! * bj;
    } else {
      this.tint[i * 3] = bj;
      this.tint[i * 3 + 1] = bj;
      this.tint[i * 3 + 2] = bj;
    }
    this.slotRun[i] = run.id;
    run.live++;
    h.live++;
    h.spawned++;
    this.liveCount++;
  }

  private free(i: number): void {
    const run = this.runs[this.slotRun[i]!]!;
    run.live--;
    run.handle.live--;
    this.liveCount--;
    this.slotRun[i] = -1;
    this.freeStack[this.freeTop++] = i;
  }

  private finish(k: number): void {
    const h = this.active[k]!;
    const last = this.active.pop()!;
    if (k < this.active.length) this.active[k] = last;
    for (const run of h.runs) {
      this.runs[run.id] = null;
      this.freeRunIds.push(run.id);
    }
    h.resolve();
  }

  private writeInstance(run: Run, i: number, t: number, wx: number, wy: number, wz: number, mvx: number, mvy: number, mvz: number): void {
    const L = run.layer;
    const src = L.src;
    const b = this.batches[run.batch]!;
    const n = b.n++;
    const M = b.sorted ? b.sMatrix : b.matrix;
    const C = b.sorted ? b.sColor : b.color;
    const X = b.sorted ? b.sMisc : b.misc;
    const size = this.size[i]! * lut1(L.sizeLut, t);
    const alpha = lut1(L.alphaLut, t);
    let bright = 1;

    // 两个基向量 (ax, ay, az)、(bx, by, bz)，第三列是法线
    let ax: number, ay: number, az: number, bx: number, by: number, bz: number;
    let nx = this.fx;
    let ny = this.fy;
    let nz = this.fz;
    const align = src.align;
    if (align === 'velocity') {
      const dot = mvx * this.fx + mvy * this.fy + mvz * this.fz;
      let dx = mvx - this.fx * dot;
      let dy = mvy - this.fy * dot;
      let dz = mvz - this.fz * dot;
      const len = Math.hypot(dx, dy, dz);
      if (len > 1e-4) {
        dx /= len;
        dy /= len;
        dz /= len;
      } else {
        dx = this.ux;
        dy = this.uy;
        dz = this.uz;
      }
      const length = Math.max(size * (src.aspect ?? 1), len * (src.stretch ?? 0));
      ax = dx * length;
      ay = dy * length;
      az = dz * length;
      // 宽度方向 = 法线 × 长度方向
      bx = (this.fy * dz - this.fz * dy) * size;
      by = (this.fz * dx - this.fx * dz) * size;
      bz = (this.fx * dy - this.fy * dx) * size;
    } else if (align === 'ground') {
      const c = Math.cos(this.rot[i]!);
      const sn = Math.sin(this.rot[i]!);
      ax = c * size;
      ay = 0;
      az = sn * size;
      bx = sn * size;
      by = 0;
      bz = -c * size;
      nx = 0;
      ny = 1;
      nz = 0;
    } else {
      const c = Math.cos(this.rot[i]!);
      const sn = Math.sin(this.rot[i]!);
      let w = size;
      if (align === 'tumble') {
        const fk = Math.cos(this.flip[i]!);
        w = size * fk;
        const af = Math.abs(fk);
        bright = 0.6 + 0.4 * af + 0.6 * af ** 12; // 正对镜头时闪一下
      }
      ax = (this.rx * c + this.ux * sn) * w;
      ay = (this.ry * c + this.uy * sn) * w;
      az = (this.rz * c + this.uz * sn) * w;
      bx = (-this.rx * sn + this.ux * c) * size;
      by = (-this.ry * sn + this.uy * c) * size;
      bz = (-this.rz * sn + this.uz * c) * size;
    }
    const m = n * 16;
    M[m] = ax;
    M[m + 1] = ay;
    M[m + 2] = az;
    M[m + 3] = 0;
    M[m + 4] = bx;
    M[m + 5] = by;
    M[m + 6] = bz;
    M[m + 7] = 0;
    M[m + 8] = nx;
    M[m + 9] = ny;
    M[m + 10] = nz;
    M[m + 11] = 0;
    M[m + 12] = wx;
    M[m + 13] = wy;
    M[m + 14] = wz;
    M[m + 15] = 1;

    const lut = run.lut;
    const f = t * 31;
    const li = f | 0;
    const lk = f - li;
    const l0 = Math.min(li, 31) * 3;
    const l1 = Math.min(li + 1, 31) * 3;
    const ci = n * 4;
    C[ci] = (lut[l0]! + (lut[l1]! - lut[l0]!) * lk) * this.tint[i * 3]! * bright;
    C[ci + 1] = (lut[l0 + 1]! + (lut[l1 + 1]! - lut[l0 + 1]!) * lk) * this.tint[i * 3 + 1]! * bright;
    C[ci + 2] = (lut[l0 + 2]! + (lut[l1 + 2]! - lut[l0 + 2]!) * lk) * this.tint[i * 3 + 2]! * bright;
    C[ci + 3] = alpha;
    X[n] = L.cell + (src.soft ? 8 : 0);

    if (b.sorted) {
      // 镜头前方是 -f，越远 key 越小，升序排就是远到近
      b.keys[n] = (wx - this.cx) * this.fx + (wy - this.cy) * this.fy + (wz - this.cz) * this.fz;
      b.order[n] = n;
    }
  }

  private flush(b: Batch): void {
    const n = b.n;
    if (b.sorted && n > 0) {
      sortByKey(b.order, b.keys, n);
      for (let k = 0; k < n; k++) {
        const j = b.order[k]!;
        const sm = j * 16;
        const dm = k * 16;
        for (let e = 0; e < 16; e++) b.matrix[dm + e] = b.sMatrix[sm + e]!;
        const c = j * 4;
        const d = k * 4;
        b.color[d] = b.sColor[c]!;
        b.color[d + 1] = b.sColor[c + 1]!;
        b.color[d + 2] = b.sColor[c + 2]!;
        b.color[d + 3] = b.sColor[c + 3]!;
        b.misc[k] = b.sMisc[j]!;
      }
    }
    b.mesh.count = n;
    b.mesh.visible = n > 0;
    if (b.core) {
      b.core.count = n;
      b.core.visible = n > 0;
    }
    if (n === 0) return;
    const im = b.mesh.instanceMatrix;
    im.clearUpdateRanges();
    im.addUpdateRange(0, n * 16);
    im.needsUpdate = true;
    b.colorAttr.clearUpdateRanges();
    b.colorAttr.addUpdateRange(0, n * 4);
    b.colorAttr.needsUpdate = true;
    b.miscAttr.clearUpdateRanges();
    b.miscAttr.addUpdateRange(0, n);
    b.miscAttr.needsUpdate = true;
  }

  // 软粒子用场景深度贴图（可选）。不给时软粒子按离台面的高度淡出。
  setSoftDepth(depth: THREE.Texture | null, camera?: THREE.PerspectiveCamera, width = 1, height = 1): void {
    for (const m of this.materials) {
      const had = m.defines.SOFT_DEPTH !== undefined;
      if (depth) m.defines.SOFT_DEPTH = '';
      else delete m.defines.SOFT_DEPTH;
      if (had !== !!depth) m.needsUpdate = true;
      m.uniforms.uDepth!.value = depth;
      (m.uniforms.uResolution!.value as THREE.Vector2).set(width, height);
      if (camera) {
        m.uniforms.uNear!.value = camera.near;
        m.uniforms.uFar!.value = camera.far;
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.killAll();
    this.disposed = true;
    this.object.removeFromParent();
    for (const b of this.batches) {
      b.mesh.removeFromParent();
      b.mesh.dispose();
      b.core?.removeFromParent();
      b.core?.dispose();
    }
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.atlas.dispose();
  }
}

// 预计总时长：每层 延迟 + 发射时长 + 最长寿命，取最大
export function presetDuration(def: PresetDef, opts: { duration?: number } = {}): number {
  const travel = opts.duration ?? def.travel ?? 0;
  let d = 0;
  for (const l of def.layers) {
    const em = l.duration === 'travel' ? travel : (l.duration ?? 0);
    const life = typeof l.life === 'number' ? l.life : l.life[1];
    d = Math.max(d, (l.delay ?? 0) + em + life);
  }
  return d;
}

// 按 key 升序排 order 的前 n 项（原地快排，小段插入排序，不分配）
function sortByKey(order: Int32Array, keys: Float32Array, n: number): void {
  quick(order, keys, 0, n - 1);
}

function quick(o: Int32Array, k: Float32Array, lo: number, hi: number): void {
  while (hi - lo > 16) {
    const mid = (lo + hi) >> 1;
    const p = k[o[mid]!]!;
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (k[o[i]!]! < p) i++;
      while (k[o[j]!]! > p) j--;
      if (i <= j) {
        const t = o[i]!;
        o[i] = o[j]!;
        o[j] = t;
        i++;
        j--;
      }
    }
    // 先递归短的一边，长的一边循环，栈深度有界
    if (j - lo < hi - i) {
      quick(o, k, lo, j);
      lo = i;
    } else {
      quick(o, k, i, hi);
      hi = j;
    }
  }
  for (let i = lo + 1; i <= hi; i++) {
    const v = o[i]!;
    const kv = k[v]!;
    let j = i - 1;
    while (j >= lo && k[o[j]!]! > kv) {
      o[j + 1] = o[j]!;
      j--;
    }
    o[j + 1] = v;
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
