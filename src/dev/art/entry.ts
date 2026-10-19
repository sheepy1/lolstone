// /dev/art 的入口：?view=board 是按对局镜头摆的固定局面（board.ts），其余是配图总览（main.ts）。
if (new URLSearchParams(location.search).get('view') === 'board') {
  document.getElementById('bar')!.remove();
  document.getElementById('out')!.remove();
  await import('./board');
} else {
  document.getElementById('stage')!.remove();
  await import('./main');
}
export {};
