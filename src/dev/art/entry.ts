// /dev/art 的入口：?view=board 是按对局镜头摆的固定局面（board.ts），?view=frames 是卡框和卡背的对照（frames.ts），
// 其余是配图总览（main.ts）。
const view = new URLSearchParams(location.search).get('view');
if (view === 'board' || view === 'frames') {
  document.getElementById('bar')!.remove();
  document.getElementById('out')!.remove();
  await import(view === 'board' ? './board' : './frames');
} else {
  document.getElementById('stage')!.remove();
  await import('./main');
}
export {};
