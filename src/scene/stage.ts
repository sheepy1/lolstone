// 渲染舞台（spec 5.4、5.10、6.1）：WebGL2 渲染器、固定透视镜头、阴影、ACES 色调映射、sRGB 输出、选择性泛光。
// 画布按 16:9 等比缩放到窗口里最大的矩形，居中；设备像素比上限 2。
// 后处理用 pmndrs 的 postprocessing：只有打开了 BLOOM_LAYER 图层的物件泛光（发光边、准星、水晶、法力宝石、特效），
// 受光照的表面、白色的血条和数字不参与，不管它们有多亮。
import {
  EffectComposer,
  EffectPass,
  RenderPass,
  SelectiveBloomEffect,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ASPECT, CAMERA } from '../presentation/layout';
import { BLOOM_LAYER } from '../presentation/fx/materials';

export type FrameHook = (dt: number, t: number) => void;

const MAX_DPR = 2;
const MIN_WIDTH = 1280;

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly bloom: SelectiveBloomEffect;
  private hooks = new Set<FrameHook>();
  private clock = new THREE.Clock();
  // 镜头的基准位置；震屏在它上面加偏移
  readonly cameraBase = new THREE.Vector3(CAMERA.pos.x, CAMERA.pos.y, CAMERA.pos.z);
  readonly cameraShake = new THREE.Vector3();
  // 给少数玻璃、金属小件单独用的反射贴图（一间亮灯的房间预滤波成 PMREM）。不设成场景的 environment，
  // 其余物件的光照不变；随舞台一直留着，换局不释放
  readonly reflections: THREE.Texture;

  constructor(private readonly host: HTMLElement) {
    // postprocessing 自己做抗锯齿（多重采样）和色调映射，渲染器本身关掉这两样
    const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, depth: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.NoToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;
    host.appendChild(r.domElement);
    r.domElement.style.display = 'block';

    this.scene.background = new THREE.Color(0x06100c);
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, ASPECT, 0.1, 120);
    this.camera.position.copy(this.cameraBase);
    this.camera.lookAt(CAMERA.target.x, CAMERA.target.y, CAMERA.target.z);

    // 设备像素比 2 时画面本身已经是超采样，不再开多重采样：4K 的半精度缓冲开 4 倍采样会吃掉几百 MB 显存
    const msaa = r.getPixelRatio() >= 1.5 ? 0 : 4;
    this.composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: msaa });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new SelectiveBloomEffect(this.scene, this.camera, {
      intensity: 1.0,
      luminanceThreshold: 0, // 选中的物件全部参与，没选中的一律不参与
      luminanceSmoothing: 0.1,
      mipmapBlur: true,
      radius: 0.55,
    });
    this.bloom.selection.layer = BLOOM_LAYER;
    this.bloom.ignoreBackground = true;
    this.composer.addPass(new EffectPass(this.camera, this.bloom, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })));

    const pmrem = new THREE.PMREMGenerator(r);
    this.reflections = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.resize();
    window.addEventListener('resize', () => this.resize());
    r.setAnimationLoop(() => this.frame());
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  // 画布在窗口里的 16:9 矩形
  resize(): void {
    const ww = window.innerWidth;
    const wh = window.innerHeight;
    let w = Math.max(Math.min(ww, wh * ASPECT), Math.min(MIN_WIDTH, ww));
    let h = w / ASPECT;
    if (h > wh) {
      h = wh;
      w = h * ASPECT;
    }
    w = Math.floor(w);
    h = Math.floor(h);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    const c = this.renderer.domElement;
    c.style.position = 'absolute';
    c.style.left = `${Math.floor((ww - w) / 2)}px`;
    c.style.top = `${Math.floor((wh - h) / 2)}px`;
  }

  onFrame(fn: FrameHook): () => void {
    this.hooks.add(fn);
    return () => this.hooks.delete(fn);
  }

  // 渲染一帧。动画循环每帧调；测试时页面不可见、requestAnimationFrame 停了，可以手动调。
  // fixedDt 给定时按固定步长推进每帧逻辑（录逐帧画面用），不看真实时间。
  frame(fixedDt?: number): void {
    const real = Math.min(0.1, this.clock.getDelta());
    const dt = fixedDt ?? real;
    const t = this.clock.elapsedTime;
    for (const fn of this.hooks) fn(dt, t);
    this.camera.position.copy(this.cameraBase).add(this.cameraShake);
    this.composer.render(dt);
  }

  get rendererName(): string {
    return this.renderer.capabilities.isWebGL2 ? 'webgl2' : 'webgl';
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.composer.dispose();
    this.host.removeChild(this.renderer.domElement);
    this.renderer.dispose();
  }
}
