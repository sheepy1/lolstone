// 渲染舞台（spec 5.4、5.10、6.1）：WebGL2 渲染器、固定透视镜头、阴影、ACES 色调映射、sRGB 输出、bloom。
// 画布按 16:9 等比缩放到窗口里最大的矩形，居中；设备像素比上限 2。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ASPECT, CAMERA } from '../presentation/layout';

export type FrameHook = (dt: number, t: number) => void;

const MAX_DPR = 2;
export const BLOOM_THRESHOLD = 2.2;
const MIN_WIDTH = 1280;

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  private hooks = new Set<FrameHook>();
  private clock = new THREE.Clock();
  // 镜头的基准位置；震屏在它上面加偏移
  readonly cameraBase = new THREE.Vector3(CAMERA.pos.x, CAMERA.pos.y, CAMERA.pos.z);
  readonly cameraShake = new THREE.Vector3();

  constructor(private readonly host: HTMLElement) {
    const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;
    host.appendChild(r.domElement);
    r.domElement.style.display = 'block';

    this.scene.background = new THREE.Color(0x06100c);
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, ASPECT, 0.1, 120);
    this.camera.position.copy(this.cameraBase);
    this.camera.lookAt(CAMERA.target.x, CAMERA.target.y, CAMERA.target.z);

    // 后处理用多重采样的半精度渲染目标：抗锯齿 + bloom 需要超过 1 的亮度
    const target = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(r, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // 阈值高于受光照最亮的表面（约 1.9），只有自发光材质（发光边、准星、水晶、法力宝石）超过它、产生泛光
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.15, BLOOM_THRESHOLD);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

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
    // bloom 在半分辨率上算，省帧预算
    this.bloom.resolution.set(w / 2, h / 2);
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
  frame(): void {
    const dt = Math.min(0.1, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    for (const fn of this.hooks) fn(dt, t);
    this.camera.position.copy(this.cameraBase).add(this.cameraShake);
    this.composer.render();
  }

  get rendererName(): string {
    return this.renderer.capabilities.isWebGL2 ? 'webgl2' : 'webgl';
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.host.removeChild(this.renderer.domElement);
    this.renderer.dispose();
  }
}
