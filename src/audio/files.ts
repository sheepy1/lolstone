// 音频文件地址。scripts/normalize-audio.ts 按 scripts/data/audio-sources.json 选定的候选生成：
// audio/sfx/<音效 id>.ogg|mp3、audio/music/<曲目 id>.ogg|mp3。先给 ogg，老版本 Safari 不支持 ogg 时 Howler 用 mp3。

const base = (): string => {
  const b = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return b.endsWith('/') ? b : `${b}/`;
};

export function sfxSrc(id: string): string[] {
  return [`${base()}audio/sfx/${id}.ogg`, `${base()}audio/sfx/${id}.mp3`];
}

export function musicSrc(id: string): string[] {
  return [`${base()}audio/music/${id}.ogg`, `${base()}audio/music/${id}.mp3`];
}

/** 语音的 mp3 兜底和 ogg 同目录同名（normalize-audio 处理语音时生成）。 */
export function withMp3(oggUrl: string): string[] {
  return oggUrl.endsWith('.ogg') ? [oggUrl, `${oggUrl.slice(0, -4)}.mp3`] : [oggUrl];
}
