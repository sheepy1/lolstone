// 卡牌配图总览 /dev/art（只进开发构建）：把卡池里每张卡（含衍生物）和四个英雄技能排成一张大图，每张卡三处显示：
// 悬停大卡（左）、手牌（右上，和大卡是同一个 CardView，只是缩小）、场上随从（右下，按对局镜头的俯角倾斜）。
// 英雄技能的右侧是台面上的技能按钮。灯光、材质、色调映射和对局一致（半球光 0.85 + 方向光 1.9，ACES），没有泛光。
// 地址参数：?page=N（从 1 开始，每页 PER 张）；?only=generate 只看小图放大、以后要生成大图的卡；?only=long 只看正文最长的。
// ?view=board 是按对局镜头摆的固定局面（board.ts）。
// 页面上"保存"把整页存到 .dev-output/art-gallery-<页>.png。
import * as THREE from 'three';
import map from '../../../scripts/data/card-art.json';
import { cardArtOf, heroPowerIconUrl, keywordIconUrl, mappedKeywords } from '../../assets/cardArt';
import { loadManifest } from '../../assets/loader';
import { iconUrl, loadingArtUrl, type AssetEntry } from '../../assets/manifest';
import { installDefaultPool } from '../../cards';
import { allCards, allHeroClasses, getCard, type CardDef, type HeroClass, type Keyword } from '../../engine';
import { CAMERA_PITCH } from '../../presentation/layout';
import { CardView } from '../../scene/cardView';
import { approxMeasure } from '../../scene/cardTextLayout';
import { preloadCardFont } from '../../scene/cardText';
import { HeroPowerView } from '../../scene/heroView';
import { MinionView } from '../../scene/minionView';

installDefaultPool();

const PER = 16;
const COLS = 4;
const CELL_W = 480;
const CELL_H = 500;
const PPU = 100; // 每个世界单位多少像素
const BIG = 1.95; // 悬停大卡的缩放（layout.ts 的 inspectSlot）

type Item = { kind: 'card'; def: CardDef } | { kind: 'power'; cls: HeroClass; def: CardDef };

const CLASS_ORDER = ['demacia', 'noxus', 'ionia', 'freljord', 'neutral'];
const powerIds = new Set(allHeroClasses().map((c) => c.heroPower));
const cards = allCards()
  .filter((d) => !powerIds.has(d.id) && d.id !== '__hidden__' && !d.id.startsWith('__'))
  .sort((a, b) => Number(!!a.token) - Number(!!b.token) || CLASS_ORDER.indexOf(a.class) - CLASS_ORDER.indexOf(b.class) || a.cost - b.cost || a.id.localeCompare(b.id));
const items: Item[] = [
  ...cards.map((def) => ({ kind: 'card' as const, def })),
  ...allHeroClasses().map((c) => ({ kind: 'power' as const, cls: c.id, def: getCard(c.heroPower) })),
];
const params = new URLSearchParams(location.search);
// ?only=generate 只排映射表标了"以后生成大图"的卡（小图放大的那几张），按生成先后排
const onlyGenerate = params.get('only') === 'generate';
// ?only=long 只排正文最长的 16 张（检查卡面正文折行和缩字号）
const onlyLong = params.get('only') === 'long';
if (onlyLong) {
  const keep = items.filter((it) => it.kind === 'card').sort((a, b) => approxMeasure(b.def.text) - approxMeasure(a.def.text)).slice(0, PER);
  items.splice(0, items.length, ...keep);
}
if (onlyGenerate) {
  const prio = (id: string) => (map.cards as Record<string, { generatePriority?: number }>)[id]?.generatePriority ?? 99;
  const keep = items.filter((it) => cardArtOf(it.def.id)?.generate).sort((a, b) => prio(a.def.id) - prio(b.def.id));
  items.splice(0, items.length, ...keep);
}
const only = params.get('only');
const pages = Math.ceil(items.length / PER) + (only ? 0 : 1); // 最后一页是关键词图标
const page = Math.min(pages, Math.max(1, Number(params.get('page') ?? 1)));
const keywordPage = !only && page === pages;

const SOURCE: Record<string, string> = {
  lor: '符文之地传说原画',
  'ddragon-splash': '皮肤原画',
  cdragon: '峡谷头像 128',
  'ddragon-item': '物品图标 64',
  'ddragon-spell': '技能图标 64',
  'ddragon-passive': '被动图标 64',
};
const raw = map.cards as Record<string, { art: { type: string }; icon: { type: string } | null; generate?: string }>;

function describe(it: Item): string {
  if (it.kind === 'power') return '英雄技能图标 64';
  const d = it.def;
  if (d.champion) return `英雄卡：竖版原画 · ${d.champion}`;
  const r = raw[d.id];
  if (!r) return '没有映射';
  const art = SOURCE[r.art.type] ?? r.art.type;
  const icon = r.icon ? (r.icon.type === r.art.type && !r.generate ? '' : ` · 头像 ${SOURCE[r.icon.type] ?? r.icon.type}`) : ' · 头像从原画裁';
  return `${art}${icon}${r.generate ? ' · 以后生成大图' : ''}`;
}

// 预载这一页要用的图（和对局加载页同一个加载器）
function entriesFor(list: Item[]): AssetEntry[] {
  const out: AssetEntry[] = [];
  for (const it of list) {
    const d = it.def;
    if (d.champion) {
      out.push({ kind: 'icon', key: d.champion, url: iconUrl(d.champion) }, { kind: 'loading', key: d.champion, url: loadingArtUrl(d.champion) });
    }
    const a = cardArtOf(d.id);
    if (a) {
      out.push({ kind: 'card_art', key: d.id, url: a.art });
      if (a.icon) out.push({ kind: 'card_icon', key: d.id, url: a.icon });
    }
    if (it.kind === 'power') out.push({ kind: 'hero_power', key: it.cls, url: heroPowerIconUrl(it.cls)! });
  }
  for (const k of mappedKeywords()) out.push({ kind: 'keyword', key: k, url: keywordIconUrl(k)! });
  return out;
}

const list = items.slice((page - 1) * PER, page * PER);
const rows = keywordPage ? 2 : Math.ceil(list.length / COLS);
const W = CELL_W * COLS;
const H = Math.max(1, rows) * CELL_H;

const bar = document.getElementById('bar')!;
bar.innerHTML =
  `<b>卡牌配图总览</b> 第 ${page} / ${pages} 页（共 ${cards.length} 张卡 + 4 个英雄技能）` +
  Array.from({ length: pages }, (_, i) => `<a href="?page=${i + 1}${only ? `&only=${only}` : ''}">${i + 1}</a>`).join(' ') +
  ` <button id="save">保存整页 PNG</button> <span id="status">加载中…</span>`;
const status = document.getElementById('status')!;

const report = await loadManifest(entriesFor(list), () => {});
await preloadCardFont(list.map((it) => it.def.name + it.def.text).join('') + '0123456789+');

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1410);
const camera = new THREE.OrthographicCamera(0, W / PPU, 0, -H / PPU, -50, 50);
camera.position.set(0, 0, 20);
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x2a2418, 0.85));
const sun = new THREE.DirectionalLight(0xfff0d8, 1.9);
sun.position.set(-7, 9, 16); // 对局里的方向光从左上方、镜头这一侧打过来
scene.add(sun);

const labels: { x: number; y: number; text: string; sub: string; warn: boolean }[] = [];
const u = (px: number) => px / PPU;

list.forEach((it, i) => {
  const cx = (i % COLS) * CELL_W;
  const cy = Math.floor(i / COLS) * CELL_H;
  // 悬停大卡
  const big = new CardView(-1, it.def.id);
  big.scale.setScalar(BIG);
  big.setMatte(); // 和对局里的悬停大卡一样不带清漆
  big.position.set(u(cx + 20 + 150 * BIG / 2), -u(cy + 56 + 210 * BIG / 2), 0);
  scene.add(big);
  const rx = cx + 20 + 150 * BIG + 18;
  if (it.kind === 'power') {
    const p = new HeroPowerView(it.cls, 0);
    p.scale.setScalar(1.3);
    p.rotation.x = CAMERA_PITCH;
    p.position.set(u(rx + 75), -u(cy + 160), 0);
    p.setUsable(true);
    scene.add(p);
  } else {
    // 手牌（原尺寸）
    const hand = new CardView(-2, it.def.id);
    hand.position.set(u(rx + 75), -u(cy + 56 + 105), 0);
    scene.add(hand);
    if (it.def.type === 'minion') {
      const m = new MinionView(
        {
          instanceId: -3 - i,
          cardId: it.def.id,
          attack: it.def.attack ?? 0,
          health: it.def.health ?? 0,
          maxHealth: it.def.health ?? 0,
          keywords: [...((it.def.keywords ?? []) as Keyword[])],
          frozen: false,
          silenced: false,
        },
        0,
      );
      m.rotation.x = CAMERA_PITCH;
      m.position.set(u(rx + 75), -u(cy + 56 + 210 + 110), 0);
      scene.add(m);
    }
  }
  const a = cardArtOf(it.def.id);
  const missing = report.missing.filter((url) => (a && (url === a.art || url === a.icon)) || (it.def.champion && url.includes(`/${it.def.champion.toLowerCase()}/`)));
  labels.push({
    x: cx + 20,
    y: cy + 30,
    text: `${it.def.name}  ${it.def.id}`,
    sub: describe(it) + (missing.length ? ` · 缺图 ${missing.length}` : ''),
    warn: missing.length > 0 || !!a?.generate,
  });
});

const out = document.getElementById('out') as HTMLCanvasElement;
out.width = W;
out.height = H;
const g = out.getContext('2d')!;

function compose(): void {
  renderer.render(scene, camera);
  g.drawImage(renderer.domElement, 0, 0);
  for (const l of labels) {
    g.font = '600 17px "PingFang SC", sans-serif';
    g.fillStyle = '#f0e6c8';
    g.fillText(l.text, l.x, l.y - 6);
    g.font = '13px "PingFang SC", sans-serif';
    g.fillStyle = l.warn ? '#ffb070' : '#9fb8a8';
    g.fillText(l.sub, l.x, l.y + 12);
  }
  if (keywordPage) drawKeywordPage();
}

// 最后一页：11 个关键词图标的原图（64×64 放大到 96）和名字
function drawKeywordPage(): void {
  const kws = mappedKeywords();
  const names = map.keywords as Record<string, { name: string }>;
  g.fillStyle = '#0b1410';
  g.fillRect(0, 0, W, H);
  g.font = '600 22px "PingFang SC", sans-serif';
  g.fillStyle = '#f0e6c8';
  g.fillText('关键词图标（场上随从底座上沿那一排，实际显示 54×50）', 20, 40);
  kws.forEach((k, i) => {
    const x = 20 + (i % 6) * 300;
    const y = 80 + Math.floor(i / 6) * 220;
    const img = new Image();
    img.src = keywordIconUrl(k)!;
    img.onload = () => {
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, x, y, 128, 128);
    };
    g.font = '18px "PingFang SC", sans-serif';
    g.fillStyle = '#f0e6c8';
    g.fillText(`${names[k]?.name ?? k}  ${k}`, x, y + 160);
  });
}

// troika 的文字异步排版，多渲染几次等它们都出来
for (let n = 0; n < 12; n++) {
  compose();
  await new Promise((r) => setTimeout(r, 150));
}
compose();
status.textContent = `完成，缺图 ${report.missing.length} 个`;
(window as unknown as { galleryReady: boolean }).galleryReady = true;

async function save(): Promise<string> {
  compose();
  await new Promise((r) => setTimeout(r, 300));
  const url = out.toDataURL('image/png');
  const r = await fetch(`/__dev/screenshot?name=art-gallery-${only ? `${only}-` : ''}${page}`, { method: 'POST', body: url });
  return r.text();
}
document.getElementById('save')!.onclick = () => void save().then((f) => (status.textContent = `已保存 ${f}`));
(window as unknown as { saveGallery: () => Promise<string> }).saveGallery = save;
