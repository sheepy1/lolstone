// troika-three-text 自带的类型声明不准（Text 没有继承 Mesh、anchorX 只有 number），这里按实际用到的部分重新声明。
declare module 'troika-three-text' {
  import type { Color, Material, Mesh } from 'three';

  type Anchor = number | string;

  export class Text extends Mesh {
    text: string;
    font: string | null;
    fontSize: number;
    color: number | string | Color;
    anchorX: Anchor;
    anchorY: Anchor;
    maxWidth: number;
    textAlign: 'left' | 'right' | 'center' | 'justify';
    lineHeight: number | 'normal';
    outlineWidth: number | string;
    letterSpacing: number;
    fillOpacity: number;
    outlineOpacity: number;
    clipRect: [number, number, number, number] | null;
    outlineColor: number | string | Color;
    sdfGlyphSize: number | null;
    depthOffset: number;
    material: Material;
    sync(callback?: () => void): void;
    dispose(): void;
  }

  export function preloadFont(options: { font?: string; characters?: string | string[]; sdfGlyphSize?: number }, callback: () => void): void;
}
