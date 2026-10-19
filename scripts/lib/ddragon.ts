// Data Dragon：版本号和英雄索引。地址见 docs/spec.md 5.9。

import { fetchJson } from './http.ts';

export const DDRAGON = 'https://ddragon.leagueoflegends.com';

export async function latestVersion(): Promise<string> {
  const versions = await fetchJson<string[]>(`${DDRAGON}/api/versions.json`);
  if (!Array.isArray(versions) || typeof versions[0] !== 'string') {
    throw new Error('Data Dragon 版本列表格式不对');
  }
  return versions[0];
}

export type ChampionInfo = {
  /** Data Dragon key，比如 JarvanIV。 */
  key: string;
  /** 数字 id，CommunityDragon 的语音按它命名。 */
  id: number;
  /** 中文名，比如 嘉文四世。 */
  name: string;
  /** 中文称号，比如 德玛西亚皇子。 */
  title: string;
};

type ChampionJson = {
  data: Record<string, { id: string; key: string; name: string; title: string }>;
};

/**
 * 读 zh_CN/champion.json。
 * 注意中文数据里 name 是称号（"迅捷斥候"），title 才是英雄名（"提莫"），和英文数据正好相反。
 */
export async function loadChampions(version: string): Promise<Map<string, ChampionInfo>> {
  const json = await fetchJson<ChampionJson>(`${DDRAGON}/cdn/${version}/data/zh_CN/champion.json`);
  const index = new Map<string, ChampionInfo>();
  for (const c of Object.values(json.data)) {
    index.set(c.id, { key: c.id, id: Number(c.key), name: c.title, title: c.name });
  }
  return index;
}

export type Resolved = {
  found: ChampionInfo[];
  /** 在 champion.json 里找不到的 key，带上大小写不同的候选。 */
  missing: { key: string; suggestion?: string }[];
};

export function resolveKeys(keys: readonly string[], index: Map<string, ChampionInfo>): Resolved {
  const byLower = new Map([...index.keys()].map((k) => [k.toLowerCase(), k]));
  const found: ChampionInfo[] = [];
  const missing: Resolved['missing'] = [];
  for (const key of keys) {
    const info = index.get(key);
    if (info) found.push(info);
    else missing.push({ key, suggestion: byLower.get(key.toLowerCase()) });
  }
  return { found, missing };
}

/** 有 key 拼错时打印清单并退出，不下载任何东西。 */
export function exitOnMissing(missing: Resolved['missing'], version: string): void {
  if (missing.length === 0) return;
  console.error(`\n错误：以下 ${missing.length} 个 key 在 Data Dragon ${version} 的 champion.json 里找不到：`);
  for (const m of missing) {
    console.error(`  - ${m.key}${m.suggestion ? `（是不是 ${m.suggestion}？）` : ''}`);
  }
  console.error('检查 scripts/lib/champions.ts 和 docs/cards-v1.md 的 key 列。');
  process.exit(1);
}
