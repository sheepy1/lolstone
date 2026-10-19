// 粒子系统（分镜表 1.5，spec 5.10）：池复用、上限截断、生命周期结束回收、销毁时释放、预设齐全、时间缩放、GSAP 衔接。
// 不需要 WebGL：只检查池和实例缓冲里的数据。
import gsap from 'gsap';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  MAX_PARTICLES,
  ParticleSystem,
  PRESET_NAMES,
  PRESETS,
  particleTimeline,
  presetDuration,
  presetParticleCount,
  type PresetDef,
} from '../src/presentation/fx/particles';

const STEP = 1 / 60;

function makeSystem(opts: { capacity?: number } = {}): ParticleSystem {
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 120);
  camera.position.set(0, 18, 12.4);
  camera.lookAt(0, 0, 1.4);
  camera.updateMatrixWorld();
  return new ParticleSystem({ camera, countJitter: 0, seed: 7, ...opts });
}

function run(sys: ParticleSystem, seconds: number): void {
  for (let t = 0; t < seconds; t += STEP) sys.update(STEP);
}

// 一层、一次性迸发、固定寿命的测试预设
function burst(count: number, life = 0.5, extra: Partial<PresetDef['layers'][number]> = {}): PresetDef {
  return {
    count,
    dir: 'out',
    color: 0xffffff,
    layers: [
      {
        name: 'test',
        count,
        life,
        shape: { kind: 'point' },
        dir: 'out',
        speed: 1,
        size: 0.1,
        gradient: [[0, 'main', 1]],
        cell: 'glow',
        blend: 'add',
        align: 'billboard',
        ...extra,
      },
    ],
  };
}

const at = { x: 0, y: 0.5, z: 0 };

describe('粒子池', () => {
  it('放完的格子回到池里，下一次发射复用，不新开数组', () => {
    const sys = makeSystem();
    const slotRun = sys.debug.slotRun;
    const used = new Set<number>();
    for (let round = 0; round < 20; round++) {
      sys.emit(burst(50), { at });
      sys.update(STEP);
      expect(sys.live).toBe(50);
      for (let i = 0; i < sys.capacity; i++) if (slotRun[i]! >= 0) used.add(i);
      run(sys, 0.6);
      expect(sys.live).toBe(0);
      expect(sys.debug.free).toBe(sys.capacity);
    }
    // 20 轮各 50 个，用到的格子始终是同一批
    expect(used.size).toBe(50);
    expect(sys.debug.slotRun).toBe(slotRun);
    // 发射层的编号也复用
    expect(sys.debug.runSlots).toBe(1);
  });

  it('每帧实例数和活着的粒子数一致', () => {
    const sys = makeSystem();
    sys.emit('spark_heavy', { at });
    sys.emit('dust_land', { at });
    sys.update(STEP);
    const meshes = sys.object.children.filter((o) => o.name !== 'particles-bloom-depth') as THREE.InstancedMesh[];
    expect(meshes.reduce((n, m) => n + m.count, 0)).toBe(sys.live);
    expect(sys.stats.drawCalls).toBeLessThanOrEqual(4);
  });

  it('透明混合的一批按远到近排序', () => {
    const sys = makeSystem();
    sys.emit('dust_land', { at, count: 40 });
    run(sys, 0.2);
    const mesh = sys.object.children.find((o) => o.name === 'particles-alpha') as THREE.InstancedMesh;
    const cam = new THREE.Vector3(0, 18, 12.4);
    const forward = new THREE.Vector3(0, 0, 1.4).sub(cam).normalize();
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    let last = Infinity;
    expect(mesh.count).toBeGreaterThan(10);
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      const d = p.sub(cam).dot(forward); // 沿视线的深度
      expect(d).toBeLessThanOrEqual(last + 1e-3);
      last = d;
    }
  });
});

describe('上限 2000', () => {
  it('超出的粒子不生成，计数', async () => {
    const sys = makeSystem();
    expect(sys.capacity).toBe(MAX_PARTICLES);
    const a = sys.emit(burst(1500), { at });
    const b = sys.emit(burst(1500), { at });
    sys.update(STEP);
    expect(sys.live).toBe(2000);
    expect(sys.dropped).toBe(1000);
    expect(a.spawned + b.spawned).toBe(2000);
    expect(a.dropped + b.dropped).toBe(1000);
    // 截掉的那部分不会等池空了再补发
    run(sys, 0.6);
    expect(sys.live).toBe(0);
    await Promise.all([a, b]);
    // 放完后又能发满
    sys.emit(burst(2000), { at });
    sys.update(STEP);
    expect(sys.live).toBe(2000);
    expect(sys.dropped).toBe(1000);
  });

  it('打满时持续发射的预设只截掉超出的部分', () => {
    const sys = makeSystem({ capacity: 100 });
    sys.emit(burst(90, 5), { at });
    sys.update(STEP);
    const h = sys.emit(burst(30, 5, { duration: 0.3 }), { at });
    run(sys, 0.4);
    expect(sys.live).toBe(100);
    expect(h.spawned).toBe(10);
    expect(h.dropped).toBe(20);
  });
});

describe('生命周期', () => {
  it('寿命到了回收，句柄在最后一个粒子消失后完成', async () => {
    const sys = makeSystem();
    const h = sys.emit(burst(10, 0.3), { at });
    let done = false;
    void h.then(() => (done = true));
    run(sys, 0.25);
    await Promise.resolve();
    expect(done).toBe(false);
    expect(h.live).toBe(10);
    run(sys, 0.1);
    await h;
    expect(done).toBe(true);
    expect(h.live).toBe(0);
    expect(sys.stats.handles).toBe(0);
  });

  it('kill 立刻清掉，stop 只停止发射', async () => {
    const sys = makeSystem();
    const k = sys.emit('victory_confetti', { at });
    run(sys, 0.5);
    expect(k.live).toBeGreaterThan(0);
    k.kill();
    expect(k.live).toBe(0);
    expect(sys.live).toBe(0);
    await k;

    const s = sys.emit('victory_confetti', { at });
    run(sys, 0.3);
    const spawned = s.spawned;
    s.stop();
    run(sys, 0.5);
    expect(s.spawned).toBe(spawned);
    expect(s.live).toBe(spawned);
    run(sys, 3.5);
    await s;
    expect(sys.live).toBe(0);
  });

  it('句柄时间缩放 0.5 放完要两倍时间，系统时间缩放 0 冻住', () => {
    const sys = makeSystem();
    const h = sys.emit(burst(5, 0.4), { at, timeScale: 0.5 });
    run(sys, 0.6);
    expect(h.live).toBe(5);
    run(sys, 0.3);
    expect(h.live).toBe(0);

    sys.timeScale = 0;
    const f = sys.emit(burst(5, 0.1), { at });
    run(sys, 1);
    expect(f.live).toBe(5);
    sys.timeScale = 1;
    run(sys, 0.2);
    expect(f.live).toBe(0);
  });
});

describe('销毁', () => {
  it('释放几何体、材质、图集贴图，从场景摘下', () => {
    const sys = makeSystem();
    const scene = new THREE.Scene();
    scene.add(sys.object);
    sys.emit('nexus_burst', { at });
    sys.update(STEP);

    const disposed = new Set<unknown>();
    const watch = (x: THREE.EventDispatcher<{ dispose: object }>) => x.addEventListener('dispose', () => disposed.add(x));
    const expected = new Set<unknown>();
    sys.object.traverse((o) => {
      const m = o as THREE.InstancedMesh;
      if (!m.isInstancedMesh) return;
      for (const x of [m, m.geometry, m.material as THREE.Material]) {
        if (!expected.has(x)) watch(x as THREE.EventDispatcher<{ dispose: object }>);
        expected.add(x);
      }
    });
    watch(sys.atlas);
    expected.add(sys.atlas);

    sys.dispose();
    expect(disposed).toEqual(expected);
    // 三批 + 泛光深度网格；几何体三份（深度网格和泛光批共用），材质四份，图集一张
    expect(expected.size).toBe(4 + 3 + 4 + 1);
    expect(sys.object.parent).toBeNull();
    expect(sys.live).toBe(0);
    // 销毁后再发射、再更新都不出错，句柄直接完成
    const h = sys.emit('spark_light', { at });
    sys.update(STEP);
    expect(h.finished).toBe(true);
    sys.dispose();
  });
});

describe('预设', () => {
  it('分镜表 1.5 的 15 个名字加 burn_ash、nexus_burst，一共 18 个', () => {
    const storyboard = [
      'dust_land',
      'spark_light',
      'spark_heavy',
      'fire_bolt',
      'frost_spread',
      'ice_shatter',
      'holy_pillar',
      'shadow_gather',
      'slash_trail',
      'shield_break',
      'death_shards',
      'heal_motes',
      'buff_ring',
      'stealth_smoke',
      'summon_gather',
      'victory_confetti',
      'burn_ash',
      'nexus_burst',
    ];
    expect([...PRESET_NAMES].sort()).toEqual([...storyboard].sort());
    expect(Object.keys(PRESETS).sort()).toEqual([...storyboard].sort());
  });

  it.each(PRESET_NAMES)('%s 能发射，并在预计时长内放完', async (name) => {
    const sys = makeSystem();
    const h = sys.emit(name, { at, to: { x: 3, y: 0.5, z: -3 } });
    run(sys, 0.05);
    expect(h.spawned).toBeGreaterThan(0);
    run(sys, presetDuration(PRESETS[name]) + 0.1);
    await h;
    expect(sys.live).toBe(0);
    expect(h.dropped).toBe(0);
  });

  it('count 按比例缩放各层，fixed 的层不变', () => {
    const sys = makeSystem();
    const a = sys.emit('spark_heavy', { at });
    const b = sys.emit('spark_heavy', { at, count: 28 });
    const total = (h: typeof a) => h.runs.reduce((n, r) => n + r.total, 0);
    expect(total(a)).toBe(presetParticleCount('spark_heavy'));
    expect(total(b)).toBe(presetParticleCount('spark_heavy', 28));
    const fixed = PRESETS.spark_heavy.layers.filter((l) => l.fixed).reduce((n, l) => n + l.count, 0);
    expect(total(b) - fixed).toBe(2 * (total(a) - fixed));
  });

  it('color 覆盖主色，dir 覆盖主体层的方向', () => {
    const sys = makeSystem();
    const red = sys.emit('heal_motes', { at, color: '#ff0000' });
    const green = sys.emit('heal_motes', { at });
    expect(red.runs[0]!.lut).not.toEqual(green.runs[0]!.lut);
    const down = sys.emit('dust_land', { at, dir: 'in' });
    expect(down.runs.map((r) => r.dirMode)).toEqual(['in', 'in']);
    const toward = sys.emit('spark_light', { at, to: { x: 1, y: 0.5, z: 0 } });
    expect(toward.runs.map((r) => r.dirMode)).toEqual(['toward', 'none', 'none']);
    expect(toward.dir.x).toBeCloseTo(1);
  });

  it('fire_bolt 给了目标时从 at 飞到 to，飞行时长可改', () => {
    const sys = makeSystem();
    const to = { x: 4, y: 0.5, z: -2 };
    const h = sys.emit('fire_bolt', { at, to, duration: 0.3 });
    run(sys, 0.15);
    expect(h.origin.x).toBeGreaterThan(1);
    expect(h.origin.x).toBeLessThan(3);
    expect(h.origin.y).toBeGreaterThan(at.y); // 弧线
    run(sys, 0.2);
    expect(h.origin.distanceTo(new THREE.Vector3(to.x, to.y, to.z))).toBeLessThan(1e-6);
  });

  it('不用彩虹色：每个预设的主色和分镜表 1.8 的颜色表或 LoL 金色系对得上', () => {
    // 只核对几种有明确颜色的
    expect(PRESETS.heal_motes.color).toBe(0x3ddc84);
    expect(PRESETS.frost_spread.color).toBe(0x8fd8ff);
    expect(PRESETS.ice_shatter.color).toBe(0x8fd8ff);
    expect(PRESETS.fire_bolt.color).toBe(0xff7a1a);
    expect(PRESETS.holy_pillar.color).toBe(0xfff1b8);
    expect(PRESETS.shadow_gather.color).toBe(0x6b3fa0);
    expect(PRESETS.buff_ring.color).toBe(0xffc44d);
    expect(PRESETS.shield_break.color).toBe(0xf2f6ff);
    expect(PRESETS.slash_trail.color).toBe(0xd9d9d9);
  });
});

describe('GSAP 衔接', () => {
  it('时间线开始时发射，时长等于预设的预计时长；提前杀掉时粒子一起清掉', () => {
    const sys = makeSystem();
    const { tl, handle } = particleTimeline(sys, 'spark_heavy', { at });
    tl.pause();
    expect(tl.duration()).toBeCloseTo(presetDuration(PRESETS.spark_heavy));
    tl.progress(0.1);
    const h = handle();
    expect(h).not.toBeNull();
    sys.update(STEP);
    expect(h!.live).toBeGreaterThan(0);
    tl.kill();
    expect(h!.live).toBe(0);
    expect(h!.finished).toBe(true);
    gsap.globalTimeline.clear();
  });
});
