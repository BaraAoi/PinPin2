/** Shared gameplay/world type definitions. */

export type Vec3Lite = [number, number, number];

export type TreeType = 'pine' | 'birch' | 'dead' | 'giant';

export interface TreeInst {
  x: number;
  z: number;
  y: number;
  scale: number;
  rot: number;
  type: TreeType;
  tint: number;
  /** collision radius, metres */
  r: number;
  /** canopy radius, for sonar highlight */
  cr: number;
  id: number;
}

export interface RockInst {
  x: number;
  z: number;
  y: number;
  scale: number;
  rot: number;
  r: number;
  tint: number;
}

export interface BushInst {
  x: number;
  z: number;
  y: number;
  scale: number;
  rot: number;
  tint: number;
}

export type PoiKind =
  | 'camp'
  | 'lumber'
  | 'plane'
  | 'chapel'
  | 'cabin'
  | 'tower'
  | 'mounds'
  | 'bunker'
  | 'shrine'
  | 'stones'
  | 'watchtower'
  | 'carwreck'
  | 'well';

export interface LootSpot {
  id: string;
  x: number;
  z: number;
  y: number;
  item: string;
  qty: number;
  /** loot is sitting in/on a container prop */
  container: 'crate' | 'bag' | 'body' | 'shelf' | 'ground' | 'drawer';
  locked?: boolean;
}

export interface PoiLight {
  x: number;
  y: number;
  z: number;
  color: number;
  intensity: number;
  distance: number;
  flicker: number;
}

export interface Poi {
  id: string;
  kind: PoiKind;
  x: number;
  z: number;
  y: number;
  radius: number;
  angle: number;
  rot: number;
  loot: LootSpot[];
  lights: PoiLight[];
  /** named landmark for the map / subtitles */
  discovered: boolean;
}

export interface TrailPoint {
  x: number;
  z: number;
}

export interface WorldData {
  seed: number;
  size: number;
  /** terrain half extent */
  half: number;
  res: number;
  n: number;
  heights: Float32Array;
  waterLevel: number;
  trees: TreeInst[];
  rocks: RockInst[];
  bushes: BushInst[];
  pois: Poi[];
  trails: TrailPoint[][];
  spawn: { x: number; z: number; y: number };
  lake: { x: number; z: number; r: number };
  /** objective tapes: item ids placed in pois */
  tapes: { poi: string; x: number; z: number; y: number }[];
  /** big landmark that ends the run */
  finalPoi: { x: number; z: number };
}

export interface ItemDef {
  id: string;
  nameRu: string;
  nameEn: string;
  descRu: string;
  descEn: string;
  kind: 'utility' | 'consumable' | 'quest' | 'treasure';
  /** grid footprint in the 3D backpack */
  w: number;
  h: number;
  color: number;
  accent: number;
  /** mesh builder id */
  mesh: 'medkit' | 'stone' | 'flare' | 'battery' | 'tape' | 'key' | 'coin' | 'compass' | 'cassette' | 'film' | 'knife' | 'can' | 'rope' | 'fragment' | 'lantern' | 'letter';
  stack: number;
  usable?: boolean;
}

export const ITEMS: Record<string, ItemDef> = {
  medkit: {
    id: 'medkit', nameRu: 'Бинт и антисептик', nameEn: 'Bandage kit',
    descRu: 'Восстанавливает здоровье. Осторожно: шуршит упаковка.', descEn: 'Restores health. The wrapper rustles.',
    kind: 'consumable', w: 2, h: 2, color: 0xd7d2c2, accent: 0xb03a3a, mesh: 'medkit', stack: 1, usable: true,
  },
  stone: {
    id: 'stone', nameRu: 'Эхо-камень', nameEn: 'Echo stone',
    descRu: 'Разбить — и лес ответит громким импульсом. Слышат все.', descEn: 'Crack it and the forest answers with a loud pulse. Everyone hears.',
    kind: 'consumable', w: 1, h: 1, color: 0x63e8ff, accent: 0x0d4a5a, mesh: 'stone', stack: 3, usable: true,
  },
  flare: {
    id: 'flare', nameRu: 'Фальшфейер', nameEn: 'Hand flare',
    descRu: 'Яркий химический огонь на пару минут. Пахнет серой.', descEn: 'Bright chemical fire for a couple of minutes. Smells of sulphur.',
    kind: 'consumable', w: 1, h: 3, color: 0xff5a2a, accent: 0xffd166, mesh: 'flare', stack: 2, usable: true,
  },
  battery: {
    id: 'battery', nameRu: 'Батарейка', nameEn: 'Battery',
    descRu: 'CR2032 для часов. Военные берегут их как зеницу ока.', descEn: 'CR2032 for the watch. Soldiers guard them like their eyes.',
    kind: 'utility', w: 1, h: 1, color: 0xd8c26a, accent: 0x2b2b2b, mesh: 'battery', stack: 4,
  },
  tape: {
    id: 'tape', nameRu: 'Кассета с записью', nameEn: 'Recorded tape',
    descRu: 'Голос из прошлого. На радиовышке её можно проиграть.', descEn: 'A voice from the past. Play it at the radio tower.',
    kind: 'quest', w: 2, h: 1, color: 0x2a2a2e, accent: 0xd9d5c8, mesh: 'cassette', stack: 6,
  },
  key: {
    id: 'key', nameRu: 'Ржавый ключ', nameEn: 'Rusty key',
    descRu: 'Отпирает чей-то ящик. Такие не теряют случайно.', descEn: 'Opens somebody\u2019s footlocker. Not lost by accident.',
    kind: 'utility', w: 1, h: 1, color: 0xa9814a, accent: 0x4a3a2a, mesh: 'key', stack: 2,
  },
  coin: {
    id: 'coin', nameRu: 'Жетон', nameEn: 'Token',
    descRu: 'Латунный жетон с выбитым номером части.', descEn: 'A brass token stamped with a unit number.',
    kind: 'treasure', w: 1, h: 1, color: 0xc9a227, accent: 0x6b5310, mesh: 'coin', stack: 12,
  },
  compass: {
    id: 'compass', nameRu: 'Компас', nameEn: 'Compass',
    descRu: 'Стрелка дрожит, но север знает. Работает всегда.', descEn: 'The needle trembles but knows north. Always works.',
    kind: 'utility', w: 2, h: 2, color: 0x8b8f94, accent: 0xe8e3d0, mesh: 'compass', stack: 1, usable: true,
  },
  film: {
    id: 'film', nameRu: 'Фотоплёнка', nameEn: 'Photo film',
    descRu: 'Кадры ночного леса. Кто-то фотографировал их.', descEn: 'Frames of the night forest. Someone photographed them.',
    kind: 'treasure', w: 1, h: 1, color: 0x1b1b1d, accent: 0xe8c547, mesh: 'film', stack: 3,
  },
  knife: {
    id: 'knife', nameRu: 'Нож', nameEn: 'Knife',
    descRu: 'Тусклый, но всё ещё острый. Пахнет машинным маслом.', descEn: 'Dull but still sharp. Smells of machine oil.',
    kind: 'utility', w: 1, h: 3, color: 0x6f7378, accent: 0x3a2a1e, mesh: 'knife', stack: 1, usable: true,
  },
  can: {
    id: 'can', nameRu: 'Консервы', nameEn: 'Canned food',
    descRu: 'Восстанавливает силы. Открывать — шумно.', descEn: 'Restores stamina. Opening it is loud.',
    kind: 'consumable', w: 2, h: 2, color: 0x9aa0a6, accent: 0x2f6b4f, mesh: 'can', stack: 2, usable: true,
  },
  rope: {
    id: 'rope', nameRu: 'Верёвка', nameEn: 'Rope',
    descRu: 'Десять метров. Пахнет смолой.', descEn: 'Ten metres. Smells of tar.',
    kind: 'utility', w: 2, h: 2, color: 0xb59a6a, accent: 0x6d5836, mesh: 'rope', stack: 1,
  },
  fragment: {
    id: 'fragment', nameRu: 'Обрывок карты', nameEn: 'Map fragment',
    descRu: 'Отмечает на твоей карте одно интересное место.', descEn: 'Marks one point of interest on your map.',
    kind: 'utility', w: 2, h: 2, color: 0xd9c9a3, accent: 0x7a6a48, mesh: 'fragment', stack: 1, usable: true,
  },
  lantern: {
    id: 'lantern', nameRu: 'Масляный фонарь', nameEn: 'Oil lantern',
    descRu: 'Тёплый свет. Враг видит его издалека.', descEn: 'Warm light. The enemy sees it from afar.',
    kind: 'utility', w: 2, h: 3, color: 0xe0b25b, accent: 0x3a2f22, mesh: 'lantern', stack: 1, usable: true,
  },
  letter: {
    id: 'letter', nameRu: 'Письмо', nameEn: 'Letter',
    descRu: 'Записка, написанная второпях.', descEn: 'A note written in a hurry.',
    kind: 'treasure', w: 1, h: 2, color: 0xe7e0cd, accent: 0x8a7a58, mesh: 'letter', stack: 5,
  },
};

export const LOOT_TABLES: Record<string, [string, number][]> = {
  common: [['coin', 5], ['letter', 4], ['battery', 3], ['can', 3], ['film', 2], ['medkit', 2], ['rope', 1], ['key', 1]],
  camp: [['medkit', 3], ['can', 3], ['battery', 2], ['coin', 2], ['letter', 2], ['fragment', 1]],
  lumber: [['rope', 3], ['can', 2], ['coin', 2], ['knife', 1], ['battery', 2], ['letter', 1]],
  plane: [['fragment', 2], ['medkit', 2], ['flare', 2], ['battery', 3], ['letter', 2], ['tape', 1]],
  chapel: [['letter', 4], ['tape', 3], ['coin', 2], ['film', 2], ['medkit', 1]],
  cabin: [['medkit', 3], ['can', 2], ['battery', 2], ['letter', 2], ['knife', 1], ['lantern', 1]],
  tower: [['battery', 4], ['tape', 3], ['flare', 2], ['letter', 1], ['fragment', 2]],
  mounds: [['coin', 4], ['tape', 3], ['letter', 2], ['film', 2], ['stone', 2]],
  bunker: [['tape', 3], ['flare', 3], ['medkit', 2], ['battery', 3], ['letter', 2], ['key', 1]],
  shrine: [['stone', 4], ['coin', 2], ['film', 2], ['tape', 2]],
  stones: [['stone', 3], ['fragment', 2], ['film', 2], ['letter', 1]],
  watchtower: [['flare', 3], ['compass', 2], ['battery', 2], ['letter', 2], ['tape', 1]],
  carwreck: [['medkit', 3], ['can', 2], ['battery', 2], ['letter', 2], ['key', 1]],
  well: [['coin', 3], ['stone', 2], ['letter', 1], ['film', 1]],
  hidden: [['stone', 3], ['film', 2], ['coin', 3], ['key', 2], ['tape', 2]],
};

export function itemName(id: string, lang: 'ru' | 'en'): string {
  const def = ITEMS[id];
  if (!def) return id;
  return lang === 'en' ? def.nameEn : def.nameRu;
}

export function itemDesc(id: string, lang: 'ru' | 'en'): string {
  const def = ITEMS[id];
  if (!def) return '';
  return lang === 'en' ? def.descEn : def.descRu;
}
