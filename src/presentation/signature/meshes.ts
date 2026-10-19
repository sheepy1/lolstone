// 招牌特效里粒子之外的 3D 物件：旋风锥、地面冰、光柱、巨剑、地面光环、刀光条、暗影、冰棺。
// 几何体和贴图都是模块级共用的（shared，用 DataTexture 程序生成，不依赖 DOM）；材质按次新建，同一份着色器代码
// three 只编译一次。warmSignatureFx 在对局场景建好后在后台把这些着色器编译好，第一次放大招时不卡帧。
import * as THREE from 'three';
import { shared } from '../../scene/dispose';
import type { TableScene } from '../../scene/table';
import { fresnelMaterial, glowMaterial, hdr, markBloom } from '../fx/materials';

// ---------- 程序贴图 ----------

function dataTexture(w: number, h: number, f: (u: number, v: number) => number): THREE.DataTexture {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = Math.max(0, Math.min(1, f((x + 0.5) / w, (y + 0.5) / h)));
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = data[i + 3] = Math.round(a * 255);
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return shared(t);
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 刀光条：横向两头尖、竖向中间一条亮芯
let streakTex: THREE.DataTexture | null = null;
function streakTexture(): THREE.DataTexture {
  return (streakTex ??= dataTexture(128, 32, (u, v) => {
    const along = smooth(0, 0.35, u) * (1 - smooth(0.75, 1, u));
    const across = Math.exp(-Math.pow((v - 0.5) / (0.09 + 0.12 * along), 2));
    return along * across;
  }));
}

// 柔边方块：暗影的轮廓
let softSquareTex: THREE.DataTexture | null = null;
function softSquareTexture(): THREE.DataTexture {
  return (softSquareTex ??= dataTexture(64, 64, (u, v) => {
    const d = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2;
    return 1 - smooth(0.55, 1, d);
  }));
}

// ---------- 着色器材质 ----------

const RIM_VERT = /* glsl */ `
  varying vec2 vUv;
  varying float vRim;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vRim = 1.0 - abs(dot(n, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
  }`;

// 旋风锥的侧面：几道螺旋风痕绕竖轴转，上下两头淡出，轮廓处更亮。uTime 由动画推进
export function windMaterial(color: number, intensity = 1.6): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: hdr(color, intensity) }, uTime: { value: 0 }, uOpacity: { value: 0 }, uTwist: { value: 9 } },
    vertexShader: RIM_VERT,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uOpacity;
      uniform float uTwist;
      varying vec2 vUv;
      varying float vRim;
      void main() {
        float a = vUv.x * 6.2832;
        float s1 = sin(a * 3.0 + vUv.y * uTwist - uTime * 16.0);
        float s2 = sin(a * 5.0 - vUv.y * uTwist * 0.7 - uTime * 11.0 + 1.3);
        float streak = smoothstep(0.55, 1.0, s1) + 0.6 * smoothstep(0.75, 1.0, s2);
        float h = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.65, 1.0, vUv.y));
        float alpha = (streak * (0.3 + 0.7 * vRim) + 0.06 * vRim) * h * uOpacity;
        gl_FragColor = vec4(uColor, alpha);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// 竖直光柱：底部最亮、往上淡出，几道光纹往下流
export function beamMaterial(color: number, intensity = 1.2): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: hdr(color, intensity) }, uTime: { value: 0 }, uOpacity: { value: 0 } },
    vertexShader: RIM_VERT,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uOpacity;
      varying vec2 vUv;
      varying float vRim;
      void main() {
        float fall = pow(1.0 - vUv.y, 1.6);
        float rays = 0.65 + 0.35 * sin(vUv.x * 6.2832 * 7.0 + vUv.y * 3.0 + uTime * 2.0);
        float flow = 0.75 + 0.25 * sin(vUv.y * 24.0 + uTime * 18.0);
        float alpha = fall * rays * flow * (0.25 + 0.75 * vRim) * uOpacity;
        gl_FragColor = vec4(uColor, alpha);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// 贴地的冰面：从 uOrigin 向外按半径 uRadius 长出来，带冰裂纹和一圈发亮的前沿，平面四边淡出。
// 用世界坐标算花纹，平面怎么摆都对得上。冰裂纹是 cells()：到最近两个格点的距离差，沿格子边界是 0
// （着色器字符串里不写中文注释：字体子集的扫描会把它当成界面文字）
export function frostSheetMaterial(color: number, intensity = 1.2): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: hdr(color, intensity) },
      uOrigin: { value: new THREE.Vector2() },
      uRadius: { value: 0 },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vW;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec2 uOrigin;
      uniform float uRadius;
      uniform float uOpacity;
      varying vec2 vW;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float cells(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float d1 = 8.0;
        float d2 = 8.0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y));
            vec2 o = vec2(hash(i + g), hash(i + g + 17.3));
            vec2 r = g + o - f;
            float d = dot(r, r);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
          }
        }
        return sqrt(d2) - sqrt(d1);
      }
      void main() {
        float jag = hash(floor(vW * 2.5)) - 0.5;
        float d = distance(vW, uOrigin) + jag * 0.45;
        float inside = 1.0 - smoothstep(uRadius - 0.12, uRadius, d);
        float edge = smoothstep(uRadius - 0.55, uRadius - 0.05, d) * inside;
        float crack = 1.0 - smoothstep(0.0, 0.07, cells(vW * 1.4));
        float fine = 1.0 - smoothstep(0.0, 0.05, cells(vW * 3.7 + 5.0));
        vec2 b = smoothstep(0.0, 0.14, vUv) * smoothstep(0.0, 0.14, 1.0 - vUv);
        float a = (0.22 + 0.55 * crack + 0.25 * fine + 1.3 * edge) * inside * b.x * b.y * uOpacity;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

// ---------- 共用几何体 ----------

const geo = {
  cone: null as THREE.CylinderGeometry | null,
  beam: null as THREE.CylinderGeometry | null,
  plane: null as THREE.PlaneGeometry | null,
  ring: null as THREE.RingGeometry | null,
  tomb: null as THREE.BufferGeometry | null,
};

// 旋风锥：上粗下细的开口圆筒，高 1，底在 y = 0
export function coneGeometry(): THREE.CylinderGeometry {
  if (!geo.cone) {
    const g = new THREE.CylinderGeometry(1, 0.28, 1, 40, 8, true);
    g.translate(0, 0.5, 0);
    geo.cone = shared(g);
  }
  return geo.cone;
}

// 光柱：直筒，高 1，底在 y = 0
export function beamGeometry(): THREE.CylinderGeometry {
  if (!geo.beam) {
    const g = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true);
    g.translate(0, 0.5, 0);
    geo.beam = shared(g);
  }
  return geo.beam;
}

// 1 × 1 的平面（在 xy 平面上，法线 +z）
export function planeGeometry(): THREE.PlaneGeometry {
  return (geo.plane ??= shared(new THREE.PlaneGeometry(1, 1)));
}

export function ringGeometry(): THREE.RingGeometry {
  return (geo.ring ??= shared(new THREE.RingGeometry(0.9, 1, 96)));
}

// ---------- 物件 ----------

// 旋风：两层反向转的锥，外层宽、内层窄。tick(dt) 推进风痕，opacity 0 到 1
export type Tornado = THREE.Group & { tick: (dt: number) => void; opacity: number };
export function makeTornado(color: number): Tornado {
  const g = new THREE.Group() as Tornado;
  const outer = new THREE.Mesh(coneGeometry(), windMaterial(color, 2.4));
  const inner = new THREE.Mesh(coneGeometry(), windMaterial(color, 3));
  outer.scale.set(0.95, 2.3, 0.95);
  inner.scale.set(0.55, 2.0, 0.55);
  inner.material.uniforms.uTwist!.value = 13;
  g.add(outer, inner);
  let time = 0;
  let opacity = 0;
  g.tick = (dt) => {
    time += dt;
    outer.material.uniforms.uTime!.value = time;
    inner.material.uniforms.uTime!.value = -time * 1.3;
    outer.rotation.y += dt * 9;
    inner.rotation.y -= dt * 13;
  };
  Object.defineProperty(g, 'opacity', {
    get: () => opacity,
    set: (v: number) => {
      opacity = v;
      outer.material.uniforms.uOpacity!.value = v;
      inner.material.uniforms.uOpacity!.value = v * 0.8;
    },
  });
  return g;
}

// 地面冰：w × d 的平面平躺在台面上方一点。uniforms 直接改
export function makeFrostSheet(w: number, d: number, color: number, intensity = 1.2): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  const m = new THREE.Mesh(planeGeometry(), frostSheetMaterial(color, intensity));
  m.rotation.x = -Math.PI / 2;
  m.scale.set(w, d, 1);
  m.position.y = 0.02;
  m.renderOrder = 1;
  return m;
}

// 光柱：半径 r、高 h
export function makeBeam(r: number, h: number, color: number): THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial> {
  const m = new THREE.Mesh(beamGeometry(), beamMaterial(color));
  m.scale.set(r, h, r);
  return m;
}

// 贴地光环（进泛光）：半径 1，改 scale 扩散，改材质 opacity 淡出
export function makeGroundRing(color: number, intensity = 2.2): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> {
  const m = new THREE.Mesh(
    ringGeometry(),
    new THREE.MeshBasicMaterial({ color: hdr(color, intensity), transparent: true, blending: THREE.AdditiveBlending, depthWrite: true, toneMapped: false, side: THREE.DoubleSide }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  markBloom(m);
  return m;
}

// 刀光条：长 len、粗 thick 的发光条，竖着朝向镜头一侧
export function makeStreak(len: number, thick: number, color: number, intensity = 3): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const m = new THREE.Mesh(
    planeGeometry(),
    new THREE.MeshBasicMaterial({ map: streakTexture(), color: hdr(color, intensity), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
  );
  m.scale.set(len, thick, 1);
  m.rotation.x = -0.55; // 稍微仰向镜头
  return m;
}

// 贴地的暗影（劫的影子）：柔边的深紫黑方块
export function makeShadowPatch(size: number): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const m = new THREE.Mesh(planeGeometry(), new THREE.MeshBasicMaterial({ color: 0x07040d, alphaMap: softSquareTexture(), transparent: true, opacity: 0, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.scale.set(size, size, 1);
  m.position.y = 0.025;
  m.renderOrder = 1;
  return m;
}

// ---------- 巨剑 ----------

// 德玛西亚巨剑：钢刃、刃中一道发光的符文槽、金色护手、深色握把、蓝宝石剑首。剑尖在原点，剑身朝 +y。
// 材质共用（剑同一时刻只有一把）；glow 是符文槽和宝石的材质，动画改它的颜色亮度
export const SWORD = { blade: 3.4, width: 0.52, thick: 0.12, guard: 1.3 };

type SwordParts = { group: THREE.Group; glow: THREE.MeshBasicMaterial; steel: THREE.MeshStandardMaterial };
let swordMats: { steel: THREE.MeshStandardMaterial; gold: THREE.MeshStandardMaterial; grip: THREE.MeshStandardMaterial } | null = null;
let swordGeo: { blade: THREE.BufferGeometry; fuller: THREE.PlaneGeometry; guard: THREE.BoxGeometry; grip: THREE.CylinderGeometry; pommel: THREE.SphereGeometry } | null = null;

export function makeSword(scene: TableScene, glowColor: number): SwordParts {
  const S = SWORD;
  swordMats ??= {
    steel: shared(new THREE.MeshStandardMaterial({ color: 0xe4ebf2, metalness: 1, roughness: 0.2, envMap: scene.stage.reflections, envMapIntensity: 1.4, emissive: 0x9fc4ff, emissiveIntensity: 0.15 })),
    gold: shared(new THREE.MeshStandardMaterial({ color: 0xc8aa6e, metalness: 1, roughness: 0.3, envMap: scene.stage.reflections, envMapIntensity: 1.2 })),
    grip: shared(new THREE.MeshStandardMaterial({ color: 0x2a3550, metalness: 0.2, roughness: 0.7 })),
  };
  if (!swordGeo) {
    const s = new THREE.Shape();
    const w = S.width / 2;
    s.moveTo(0, 0);
    s.lineTo(w, 0.55);
    s.lineTo(w * 0.86, S.blade);
    s.lineTo(-w * 0.86, S.blade);
    s.lineTo(-w, 0.55);
    s.closePath();
    const blade = new THREE.ExtrudeGeometry(s, { depth: S.thick, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.05, bevelSegments: 1 });
    blade.translate(0, 0, -S.thick / 2);
    swordGeo = {
      blade: shared(blade),
      fuller: shared(new THREE.PlaneGeometry(0.08, S.blade - 0.9)),
      guard: shared(new THREE.BoxGeometry(S.guard, 0.17, 0.26)),
      grip: shared(new THREE.CylinderGeometry(0.075, 0.085, 0.66, 12)),
      pommel: shared(new THREE.SphereGeometry(0.15, 16, 12)),
    };
  }
  const m = swordMats;
  const G = swordGeo;
  const glow = glowMaterial(glowColor, 2.4);
  const group = new THREE.Group();
  const blade = new THREE.Mesh(G.blade, m.steel);
  blade.castShadow = true;
  const f1 = new THREE.Mesh(G.fuller, glow);
  f1.position.set(0, 0.55 + (S.blade - 0.9) / 2 + 0.15, S.thick / 2 + 0.045);
  const f2 = f1.clone();
  f2.position.z = -f1.position.z;
  f2.rotation.y = Math.PI;
  const guard = new THREE.Mesh(G.guard, m.gold);
  guard.position.y = S.blade + 0.085;
  guard.castShadow = true;
  const grip = new THREE.Mesh(G.grip, m.grip);
  grip.position.y = S.blade + 0.17 + 0.33;
  const pommel = new THREE.Mesh(G.pommel, glow);
  pommel.position.y = S.blade + 0.17 + 0.66 + 0.1;
  markBloom(f1);
  markBloom(f2);
  markBloom(pommel);
  group.add(blade, f1, f2, guard, grip, pommel);
  return { group, glow, steel: m.steel };
}

// ---------- 冰棺 ----------

let tombMats: { body: THREE.MeshStandardMaterial; rim: THREE.ShaderMaterial } | null = null;

// 丽桑卓的冰棺：棺形（六边形、头宽脚窄）的冰柱，±0.5 的单位尺寸，挂在随从的冰层下面跟着冰层长、跟着冰层退
export function makeTomb(scene: TableScene): THREE.Group {
  if (!geo.tomb) {
    const s = new THREE.Shape();
    s.moveTo(-0.34, -0.5);
    s.lineTo(0.34, -0.5);
    s.lineTo(0.5, 0.12);
    s.lineTo(0.4, 0.5);
    s.lineTo(-0.4, 0.5);
    s.lineTo(-0.5, 0.12);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 1 });
    g.rotateX(-Math.PI / 2);
    g.computeBoundingBox();
    const b = g.boundingBox!;
    g.translate(0, -(b.min.y + b.max.y) / 2, 0);
    g.scale(1, 1 / (b.max.y - b.min.y), 1);
    geo.tomb = shared(g);
  }
  tombMats ??= {
    // 反射贴图压得很低：光滑的冰面正对 RoomEnvironment 的灯板时会整面反成白色（两侧的冰棺最明显）
    body: shared(new THREE.MeshStandardMaterial({ color: 0xa8dcff, transparent: true, opacity: 0.16, roughness: 0.35, metalness: 0, envMap: scene.stage.reflections, envMapIntensity: 0.35, emissive: 0x1d5a86, emissiveIntensity: 0.5, depthWrite: false })),
    rim: shared(fresnelMaterial(hdr(0xbfeaff, 0.9), 0.0, 0.8, 2.8)),
  };
  const group = new THREE.Group();
  const body = new THREE.Mesh(geo.tomb, tombMats.body);
  const rim = new THREE.Mesh(geo.tomb, tombMats.rim);
  rim.scale.setScalar(1.02);
  body.renderOrder = 3;
  rim.renderOrder = 4;
  group.add(body, rim);
  return group;
}

// ---------- 预编译 ----------

const warmed = new WeakSet<TableScene>();
// 预编译用的那一份物件留着不释放：three 在最后一个用到某个着色器程序的材质释放时就把程序删掉，
// 预编译完把材质释放掉等于白编译，每次放招牌特效还是现编译（实测暴风雪主步第一帧卡 67ms）
let keepers: THREE.Group | null = null;

// 对局场景建好后第一次进导演钩子时调：把招牌特效的着色器和材质在后台编译好（compileAsync），编译完从场景里拿掉
export function warmSignatureFx(scene: TableScene): void {
  if (warmed.has(scene)) return;
  warmed.add(scene);
  const r = scene.stage?.renderer as (THREE.WebGLRenderer & { compileAsync?: (o: THREE.Object3D, c: THREE.Camera, s?: THREE.Scene) => Promise<unknown> }) | undefined;
  if (!r?.compileAsync) return; // 测试里的假场景
  if (!keepers) {
    keepers = new THREE.Group();
    keepers.add(makeTornado(0xffffff), makeFrostSheet(1, 1, 0xffffff), makeBeam(1, 1, 0xffffff), makeGroundRing(0xffffff), makeStreak(1, 1, 0xffffff), makeShadowPatch(1));
    keepers.add(makeSword(scene, 0xffffff).group, makeTomb(scene));
    keepers.traverse((o) => {
      const m = o as THREE.Mesh;
      for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) shared(mat);
    });
    keepers.position.set(0, -50, 0);
  }
  const g = keepers;
  scene.layers.fx.add(g);
  r.compileAsync(g, scene.stage.camera, scene.stage.scene)
    .catch(() => {})
    .finally(() => g.removeFromParent());
}
