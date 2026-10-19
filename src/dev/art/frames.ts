// /dev/art?view=frames：卡框和卡背的对照页（M4 美术）。用对局的舞台（反射贴图、色调映射、泛光）和对局的灯光，
// 卡牌立着朝镜头、往后仰一点（和手牌的倾角差不多），看得到倒角、厚度边和金属反光。
// &set=regions 五个地区各一张英雄随从、一张非英雄随从、一张法术；&set=hero 英雄卡和非英雄卡放大并排；
// &set=back 卡背放大，加一叠牌库和几张背面朝上的手牌。&art=old 看旧版。
// 控制台 saveFrames(name) 把画布原尺寸存到 .dev-output/<name>.png。
import * as THREE from 'three';
import { installDefaultPool } from '../../cards';
import { loadManifest } from '../../assets/loader';
import { matchManifest } from '../../assets/manifest';
import { getCard, HIDDEN_CARD_ID } from '../../engine';
import { CARD_H, CARD_W } from '../../presentation/layout';
import { CardView, useCardReflections } from '../../scene/cardView';
import { preloadCardFont } from '../../scene/cardText';
import { Stage } from '../../scene/stage';
import { DeckView } from '../../scene/tableParts';

installDefaultPool();

const SETS: Record<string, string[][]> = {
  regions: [
    ['demacia.lux', 'noxus.draven', 'ionia.yasuo', 'freljord.braum', 'neutral.teemo'],
    ['token.demacian_soldier', 'token.sion_undead', 'token.zed_shadow', 'token.anivia_egg', 'neutral.baron_nashor'],
    ['demacia.judgment', 'noxus.decimate', 'ionia.spirit_rush', 'freljord.blizzard', 'token.mana_potion'],
  ],
  hero: [['demacia.lux', 'token.demacian_soldier', 'neutral.velkoz', 'neutral.gromp']],
  back: [[HIDDEN_CARD_ID]],
};

const params = new URLSearchParams(location.search);
const set = params.get('set') ?? 'regions';
const rows = SETS[set] ?? SETS.regions!;
const ids = rows.flat().filter((c) => c !== HIDDEN_CARD_ID);
await loadManifest(matchManifest([ids], []), () => {});
await preloadCardFont(ids.map((c) => getCard(c).name + getCard(c).text).join('') + '0123456789');

const stage = new Stage(document.getElementById('stage')!);
useCardReflections(stage.reflections);
stage.scene.background = new THREE.Color(0x0b1410);
const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x2a2418, 0.85);
const sun = new THREE.DirectionalLight(0xfff0d8, 1.9);
sun.position.set(-7, 16, 9);
stage.scene.add(hemi, sun);

// 镜头从正前方看过去；卡牌往后仰 0.3 弧度
const LEAN = 0.3;
const scale = set === 'regions' ? 1 : set === 'hero' ? 1.55 : 2.2;
const gapX = CARD_W * scale * 1.18;
const gapY = CARD_H * scale * 1.08;
rows.forEach((row, r) => {
  row.forEach((id, c) => {
    const v = new CardView(1000 + r * 10 + c, id);
    v.position.set((c - (row.length - 1) / 2) * gapX, ((rows.length - 1) / 2 - r) * gapY, 0);
    v.rotation.x = -LEAN;
    v.scale.setScalar(scale);
    stage.scene.add(v);
  });
});
if (set === 'back') {
  // 一叠牌库、三张背面的手牌
  const deck = new DeckView(1);
  deck.set(20, 0);
  deck.position.set(-5.4, -1.6, 1);
  deck.rotation.x = 0.9;
  deck.scale.setScalar(1.4);
  stage.scene.add(deck);
  for (let i = 0; i < 3; i++) {
    const v = new CardView(2000 + i, HIDDEN_CARD_ID);
    v.position.set(5.4 + (i - 1) * 1.3, -1.2 - Math.abs(i - 1) * 0.15, 0.2 * i);
    v.rotation.set(-LEAN, 0, (1 - i) * 0.18);
    v.scale.setScalar(1.3);
    stage.scene.add(v);
  }
}
// 镜头距离：上下、左右都放得下
const tan = Math.tan(THREE.MathUtils.degToRad(stage.camera.fov / 2));
const spanY = rows.length * gapY;
const spanX = Math.max(...rows.map((r) => r.length)) * gapX + (set === 'back' ? 9 : 0);
const dist = Math.max(spanY / 2 / tan, spanX / 2 / (tan * stage.camera.aspect)) * 1.08 + 1;
stage.cameraBase.set(0, 0, dist);
stage.cameraTarget.set(0, 0, 0);
sun.target.position.set(0, 0, 0);

(window as unknown as { saveFrames: (name: string) => Promise<string> }).saveFrames = async (name: string) => {
  await new Promise((r) => setTimeout(r, 300));
  stage.frame();
  const url = stage.canvas.toDataURL('image/png');
  const r = await fetch(`/__dev/screenshot?name=${encodeURIComponent(name)}`, { method: 'POST', body: url });
  return r.text();
};
(window as unknown as { framesReady: boolean }).framesReady = true;
