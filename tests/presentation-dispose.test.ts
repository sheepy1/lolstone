// 显存释放（scene/dispose.ts 的 releaseGpu）：一局结束时这一局自己的几何体、材质、贴图、阴影贴图都要放掉，
// 共用的（模块级缓存、舞台的反射贴图、troika 的字体图集）不能放。漏放的后果是每开一局再回主菜单，GPU 纹理净增几张。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { releaseGpu, shared } from '../src/scene/dispose';

// 记下哪些对象收到了 dispose 事件
function watch<T extends THREE.EventDispatcher<{ dispose: object }>>(x: T, log: Set<unknown>): T {
  x.addEventListener('dispose', () => log.add(x));
  return x;
}

describe('releaseGpu', () => {
  it('材质上的所有贴图都放掉（包括法线、粗糙度这些），共用的不放', () => {
    const log = new Set<unknown>();
    const tex = () => watch(new THREE.Texture(), log);
    const map = tex();
    const normalMap = tex();
    const roughnessMap = tex();
    const envMap = shared(tex());
    const mat = watch(new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap, envMap }), log);
    const geo = watch(new THREE.BoxGeometry(), log);
    const root = new THREE.Group().add(new THREE.Mesh(geo, mat));
    releaseGpu(root);
    expect(log.has(map)).toBe(true);
    expect(log.has(normalMap)).toBe(true);
    expect(log.has(roughnessMap)).toBe(true);
    expect(log.has(envMap)).toBe(false);
    expect(log.has(mat)).toBe(true);
    expect(log.has(geo)).toBe(true);
  });

  it('着色器 uniform 里的贴图不放（troika 文字的 SDF 字体图集是全局共用的）', () => {
    const log = new Set<unknown>();
    const atlas = watch(new THREE.Texture(), log);
    const mat = new THREE.ShaderMaterial({ uniforms: { atlas: { value: atlas } } });
    releaseGpu(new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(), mat)));
    expect(log.has(atlas)).toBe(false);
  });

  it('投影灯光的阴影贴图放掉', () => {
    const log = new Set<unknown>();
    const sun = new THREE.DirectionalLight();
    sun.castShadow = true;
    // 渲染器第一次画阴影时才建阴影贴图，这里手动放一个
    sun.shadow.map = watch(new THREE.WebGLRenderTarget(4, 4), log);
    releaseGpu(new THREE.Group().add(sun));
    expect(log.size).toBe(1);
  });

  it('共用的材质整个跳过', () => {
    const log = new Set<unknown>();
    const map = watch(new THREE.Texture(), log);
    const mat = shared(watch(new THREE.MeshBasicMaterial({ map }), log));
    releaseGpu(new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(), mat)));
    expect(log.size).toBe(0);
  });
});
