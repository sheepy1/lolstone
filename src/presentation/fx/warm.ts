// 战斗特效用到的着色器在对局场景建好时先在后台编译（compileAsync）。第一次用到时现编译会卡一帧：
// 实测第一次随从碎裂卡 60ms，全屏四边形、枢纽裂纹、冰壳同理。
import type { TableScene } from '../../scene/table';
import { warmIce } from './iceShell';
import { cracksOf } from './nexusCracks';
import { warmScreenFx } from './screen';

export function warmCombatFx(scene: TableScene): void {
  warmScreenFx(scene);
  for (const h of scene.heroes) cracksOf(h).warm(scene.stage.renderer, scene.stage.camera, scene.stage.scene);
  warmIce(scene.stage.renderer, scene.stage.camera, scene.stage.scene, scene.layers.fx, scene.stage.reflections);
}
