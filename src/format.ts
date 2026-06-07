export function parseTime(s: string | null | undefined): number | null {
  s = (s || '').trim();
  if (!s) return null;
  const p = s.split(':');
  if (p.some(x => x === '' || isNaN(Number(x)))) return null;
  if (p.length === 3) return +p[0] * 3600 + +p[1] * 60 + +p[2];
  if (p.length === 2) return +p[0] * 60 + +p[1];
  if (p.length === 1) return +p[0];
  return null;
}

export function num(s: string | null | undefined): number | null {
  s = (s || '').trim();
  if (s === '') return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

export function trimNum(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

export function fmtClock(t: number): string {
  const neg = t < 0;
  t = Math.abs(t);
  const m = Math.floor(t / 60), s = Math.floor(t % 60), d = Math.floor((t * 10) % 10);
  return (neg ? '-' : '') + m + ':' + String(s).padStart(2, '0') + '.' + d;
}

export function fmtClean(t: number): string {
  if (t < 0) t = 0;
  const m = Math.floor(t / 60), s = Math.round(t % 60);
  return m + ':' + String(Math.min(59, s)).padStart(2, '0');
}

export function fmtHMS(t: number): string {
  if (t < 0) t = 0;
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60);
  const s = t - h * 3600 - m * 60, is = Math.floor(s + 1e-6), f = Math.round((s - is) * 10);
  let str = h + ':' + String(m).padStart(2, '0') + ':' + String(is).padStart(2, '0');
  if (f > 0) str += '.' + f;
  return str;
}

export function esc(s: string): string {
  return String(s).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] ?? m));
}

export function cdHTML(sec: number): string {
  if (sec >= 15) return '<span class="cd-int">' + fmtClean(sec) + '</span><span class="cd-dec"></span>';
  const s = Math.floor(sec), d = Math.floor((sec - s) * 10);
  return '<span class="cd-int">' + s + '</span><span class="cd-dec">.' + d + '</span>';
}
