/**
 * Casio-style LCD watch face. Used both by the 3D wrist watch texture and the
 * HUD/PiP overlay.
 */

export interface WatchData {
  time: string;
  seconds: number;
  date: string;
  phase: 'night' | 'dawn' | 'day' | 'dusk';
  phaseLabel: string;
  night: number;
  battery: number;
  noise: number;
  echoActive: boolean;
  temp: number;
}

const SEG_ON = '#c9f7e5';
const SEG_OFF = 'rgba(150,220,200,0.10)';
const CASE = '#1b211c';

/** Pixel-ish 14-segment digits, readable and very "watchy". */
function drawDigit(ctx: CanvasRenderingContext2D, ch: string, x: number, y: number, w: number, h: number, onColor: string, glow: boolean): void {
  const seg = Math.max(2, Math.round(w * 0.13));
  const g = seg * 0.6;
  const map: Record<string, string> = {
    '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
    '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abfgcd',
  };
  const s = map[ch] ?? '';
  const draw = (x1: number, y1: number, x2: number, y2: number): void => {
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
  };
  ctx.save();
  ctx.fillStyle = onColor;
  if (glow) {
    ctx.shadowColor = onColor;
    ctx.shadowBlur = seg * 1.2;
  }
  const L = x + g;
  const R = x + w - g;
  const T = y + g;
  const M = y + h / 2;
  const B = y + h - g;
  if (s.includes('a')) draw(L, y, R, T);
  if (s.includes('b')) draw(x + w - seg, T, x + w, M - seg * 0.4);
  if (s.includes('c')) draw(x + w - seg, M + seg * 0.4, x + w, B);
  if (s.includes('d')) draw(L, B, R, y + h);
  if (s.includes('e')) draw(x, M + seg * 0.4, x + seg, B);
  if (s.includes('f')) draw(x, T, x + seg, M - seg * 0.4);
  if (s.includes('g')) draw(L, M - seg / 2, R, M + seg / 2);
  ctx.restore();
}

export function drawWatchFace(canvas: HTMLCanvasElement, data: WatchData, detailed = false): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // resin case with a NATO strap hint
  const r = H * 0.16;
  roundRect(ctx, 0, 0, W, H, r);
  ctx.fillStyle = CASE;
  ctx.fill();
  const strapGrad = ctx.createLinearGradient(0, 0, W, 0);
  strapGrad.addColorStop(0, '#20251d');
  strapGrad.addColorStop(0.5, '#3a4030');
  strapGrad.addColorStop(1, '#20251d');
  ctx.fillStyle = strapGrad;
  ctx.fillRect(W * 0.06, H * 0.02, W * 0.88, H * 0.07);
  ctx.fillRect(W * 0.06, H * 0.91, W * 0.88, H * 0.07);

  // chrome bezel
  const pad = H * 0.08;
  roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, r * 0.7);
  const bez = ctx.createLinearGradient(0, pad, 0, H - pad);
  bez.addColorStop(0, '#9aa39d');
  bez.addColorStop(0.5, '#454d47');
  bez.addColorStop(1, '#20251f');
  ctx.fillStyle = bez;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // LCD
  const lx = pad * 1.55;
  const ly = pad * 1.7;
  const lw = W - lx * 2;
  const lh = H - ly * 2 - H * 0.02;
  roundRect(ctx, lx, ly, lw, lh, r * 0.35);
  const lcd = ctx.createLinearGradient(0, ly, 0, ly + lh);
  lcd.addColorStop(0, '#0e1c16');
  lcd.addColorStop(1, '#08120e');
  ctx.fillStyle = lcd;
  ctx.fill();

  // micro labels
  ctx.fillStyle = 'rgba(160,220,200,0.55)';
  ctx.font = `${Math.max(9, H * 0.045)}px monospace`;
  ctx.textAlign = 'left';
  ctx.fillText('PINPIN', lx + lw * 0.04, ly + lh * 0.16);
  ctx.textAlign = 'right';
  ctx.fillStyle = data.night > 0.5 ? '#ffcf6a' : 'rgba(160,220,200,0.8)';
  ctx.fillText(data.phaseLabel, lx + lw * 0.96, ly + lh * 0.16);

  // time digits
  const timeStr = data.time;
  const digitH = lh * 0.44;
  const digitW = digitH * 0.52;
  const colonW = digitW * 0.36;
  const total = digitW * 4 + colonW + lw * 0.10;
  let x = lx + (lw - total) / 2;
  const y = ly + lh * 0.25;
  const glow = data.night > 0.4;
  for (const ch of timeStr) {
    if (ch === ':') {
      ctx.fillStyle = SEG_ON;
      if (glow) {
        ctx.shadowColor = SEG_ON;
        ctx.shadowBlur = 8;
      }
      ctx.fillRect(x + colonW * 0.25, y + digitH * 0.24, colonW * 0.4, digitH * 0.16);
      ctx.fillRect(x + colonW * 0.25, y + digitH * 0.6, colonW * 0.4, digitH * 0.16);
      ctx.shadowBlur = 0;
      x += colonW;
    } else {
      ctx.fillStyle = SEG_OFF;
      drawDigit(ctx, ch, x + 2, y + 2, digitW, digitH, 'rgba(0,0,0,0.35)', false);
      drawDigit(ctx, ch, x, y, digitW, digitH, SEG_ON, glow);
      x += digitW;
    }
  }

  // seconds + date row
  ctx.font = `${Math.max(11, H * 0.075)}px monospace`;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(160,220,200,0.7)';
  ctx.fillText(`DA ${data.date}`, lx + lw * 0.04, ly + lh * 0.92);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#c9f7e5';
  ctx.fillText(`${String(data.seconds).padStart(2, '0')}`, lx + lw * 0.52, ly + lh * 0.92);
  // battery + noise bars
  const barsX = lx + lw * 0.66;
  const barsY = ly + lh * 0.78;
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < Math.round(data.battery * 5) ? '#c9f7e5' : 'rgba(200,240,230,0.14)';
    ctx.fillRect(barsX + i * lw * 0.032, barsY + (4 - i) * 2, lw * 0.022, lh * 0.14 - (4 - i) * 2);
  }
  if (data.echoActive) {
    ctx.fillStyle = '#6fe7ff';
    ctx.font = `bold ${Math.max(10, H * 0.06)}px monospace`;
    ctx.textAlign = 'right';
    ctx.fillText('ECHO', lx + lw * 0.96, ly + lh * 0.74);
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(160,220,200,0.55)';
  ctx.font = `${Math.max(9, H * 0.045)}px monospace`;
  ctx.fillText(`${Math.round(data.temp)}°`, lx + lw * 0.98, ly + lh * 0.94);

  if (detailed) {
    ctx.fillStyle = 'rgba(160,220,200,0.35)';
    ctx.textAlign = 'center';
    ctx.font = `${Math.max(9, H * 0.04)}px monospace`;
    ctx.fillText('ILLUMINATOR · WR50M', W / 2, H * 0.985);
  }

  // four buttons
  ctx.fillStyle = '#3a423a';
  for (const by of [0.26, 0.52]) {
    ctx.fillRect(W * 0.975, H * by, W * 0.02, H * 0.12);
    ctx.fillRect(W * 0.005, H * by, W * 0.02, H * 0.12);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
