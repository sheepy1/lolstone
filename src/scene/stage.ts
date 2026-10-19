// 渲染舞台（spec 5.4、5.10、6.1）：WebGL2 渲染器、固定透视镜头、阴影、ACES 色调映射、sRGB 输出、选择性泛光。
// 画布按 16:9 等比缩放到窗口里最大的矩形，居中；设备像素比上限 2。
// 后处理用 pmndrs 的 postprocessing：只有打开了 BLOOM_LAYER 图层的物件泛光（发光边、准星、水晶、法力宝石、特效），
// 受光照的表面、白色的血条和数字不参与，不管它们有多亮。
import {
  Effect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  RenderPass,
  SelectiveBloomEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ASPECT, CAMERA, fitCanvas } from '../presentation/layout';
import { BLOOM_LAYER } from '../presentation/fx/materials';
import { shared } from './dispose';

export type FrameHook = (dt: number, t: number) => void;

// 整体明暗：brightness < 0 时按比例压暗（乘），> 0 时加亮（白闪用，加）。不用 postprocessing 的 BrightnessContrastEffect：
// 它是加减偏移，压暗时暗处的颜色变成负数，后面转 sRGB 时成了白色，整个画面反而发白
class GainEffect extends Effect {
  constructor() {
    super('GainEffect', 'uniform float gain;uniform float lift;void mainImage(const in vec4 inputColor,const in vec2 uv,out vec4 outputColor){outputColor=vec4(max(inputColor.rgb*gain+vec3(lift),0.0),inputColor.a);}', {
      uniforms: new Map<string, THREE.Uniform>([
        ['gain', new THREE.Uniform(1)],
        ['lift', new THREE.Uniform(0)],
      ]),
    });
  }

  set brightness(b: number) {
    this.uniforms.get('gain')!.value = b < 0 ? 1 + b : 1;
    this.uniforms.get('lift')!.value = b > 0 ? b : 0;
  }
}

const MAX_DPR = 2;

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
  // 镜头看向的点。平时是 CAMERA.target；开局推镜头时由动画改。震屏同时平移位置和看向点，所以只是平移
  readonly cameraTarget = new THREE.Vector3(CAMERA.target.x, CAMERA.target.y, CAMERA.target.z);
  // 整个画面的调色（胜负演出用，spec 5.6 E28、E29）：亮度 -1 到 1（白闪也用它），饱和度 -1 到 1，四边暗角 0 到 1。
  // 都是普通数字，动画直接补间它们，每帧写进后处理
  readonly look = { brightness: 0, saturation: 0, vignette: 0 };
  private readonly gradeBC = new GainEffect();
  private readonly gradeHS = new HueSaturationEffect();
  private readonly gradeVignette = new VignetteEffect({ offset: 0.35, darkness: 0 });
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
    // 爆牌的溶解用材质自己的裁切平面
    r.localClippingEnabled = true;
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
    this.composer.addPass(
      new EffectPass(this.camera, this.bloom, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }), this.gradeBC, this.gradeHS, this.gradeVignette),
    );

    const pmrem = new THREE.PMREMGenerator(r);
    // 跟着舞台一直留着、各局的材质共用，标成共用，释放一局的物件时不连带它
    this.reflections = shared(pmrem.fromScene(new RoomEnvironment(), 0.04).texture);
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
    const { w, h, left, top } = fitCanvas(window.innerWidth, window.innerHeight);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    const c = this.renderer.domElement;
    c.style.position = 'absolute';
    c.style.left = `${left}px`;
    c.style.top = `${top}px`;
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
    this.camera.lookAt(this.cameraTarget.x + this.cameraShake.x, this.cameraTarget.y + this.cameraShake.y, this.cameraTarget.z + this.cameraShake.z);
    this.gradeBC.brightness = this.look.brightness;
    this.gradeHS.saturation = this.look.saturation;
    this.gradeVignette.darkness = this.look.vignette;
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
