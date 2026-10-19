/** Persisted preferences. */
export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  name: string;
  lang: 'ru' | 'en';
  micId: string;
  sensitivity: number;
  master: number;
  voice: number;
  quality: Quality;
  colorSeed: number;
  showHelp: boolean;
}

const KEY = 'pinpin2.settings.v1';

const ADJ = ['ТИХИЙ', 'СЕРЫЙ', 'ЛЕСНОЙ', 'НОЧНОЙ', 'РЖАВЫЙ', 'ДИКИЙ', 'ХОЛОДНЫЙ', 'ПОСЛЕДНИЙ'];
const NOUN = ['ВОЛК', 'ВОРОН', 'МОХ', 'ПЕНЬ', 'СОСНА', 'ГЛУХАРЬ', 'КАМЕНЬ', 'ЕЛЬ'];

export function randomName(): string {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const b = NOUN[Math.floor(Math.random() * NOUN.length)];
  return `${a} ${b}`;
}

export function defaultSettings(): Settings {
  return {
    name: randomName(),
    lang: 'ru',
    micId: '',
    sensitivity: 1,
    master: 0.8,
    voice: 0.9,
    quality: 'high',
    colorSeed: Math.floor(Math.random() * 1e6),
    showHelp: true,
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSettings();
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...defaultSettings(), ...parsed };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}

/** Stable player colour from a seed. */
export function playerColor(seed: number): number {
  const palette = [0x8a5a44, 0x557a5f, 0x6b5a42, 0x4a5f74, 0x7a4a52, 0x5f6b7a, 0x7a6a3a, 0x4c6b62];
  return palette[Math.abs(seed) % palette.length];
}
