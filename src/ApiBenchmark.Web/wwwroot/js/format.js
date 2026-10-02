const formatters = new Map();

function nf(min, max) {
  const key = `${min}:${max}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max });
    formatters.set(key, f);
  }
  return f;
}

export const DASH = '—';
export const NBSP = ' ';

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function num(v, min = 0, max = min) {
  return isNum(v) ? nf(min, max).format(v) : DASH;
}

export function int(v) {
  return num(v, 0, 0);
}

export function count(v) {
  return num(v, 0, 2);
}

function adaptiveDigits(abs) {
  if (abs >= 100) return 0;
  if (abs >= 10) return 1;
  return 2;
}

const roundTo = (v, digits) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

export function msParts(ms) {
  if (!isNum(ms)) return { value: DASH, unit: '' };
  const abs = Math.abs(ms);
  if (abs === 0) return { value: '0', unit: 'ms' };
  if (abs < 0.001) return { value: '< 1', unit: 'µs' };
  if (abs < 1) {
    const us = ms * 1000;
    const d = adaptiveDigits(Math.abs(us));
    if (roundTo(Math.abs(us), d) < 1000) return { value: num(us, 0, d), unit: 'µs' };
  }
  if (abs < 1000) {
    const d = adaptiveDigits(abs);
    if (roundTo(abs, d) < 1000) return { value: num(ms, 0, d), unit: 'ms' };
  }
  const s = ms / 1000;
  return { value: num(s, 0, adaptiveDigits(Math.abs(s))), unit: 's' };
}

export function ms(v) {
  const p = msParts(v);
  return p.unit ? `${p.value}${NBSP}${p.unit}` : p.value;
}

export function bytesParts(b) {
  if (!isNum(b)) return { value: DASH, unit: '' };
  const abs = Math.abs(b);
  if (abs < 1024) {
    const d = abs < 10 && b % 1 !== 0 ? 1 : 0;
    if (roundTo(abs, d) < 1024) return { value: num(b, 0, d), unit: 'B' };
  }
  if (abs < 1024 * 1024) {
    const k = b / 1024;
    const d = adaptiveDigits(Math.abs(k));
    if (roundTo(Math.abs(k), d) < 1024) return { value: num(k, 0, d), unit: 'KB' };
  }
  const m = b / (1024 * 1024);
  return { value: num(m, 0, adaptiveDigits(Math.abs(m))), unit: 'MB' };
}

export function bytes(v) {
  const p = bytesParts(v);
  return p.unit ? `${p.value}${NBSP}${p.unit}` : p.value;
}

export function pct(rate, digits = 2) {
  return isNum(rate) ? `${num(rate * 100, 0, digits)}%` : DASH;
}

export function ratio(r) {
  if (!isNum(r)) return DASH;
  if (r >= 10) return `${num(r, 0, 0)}×`;
  return `${r < 1.1 ? num(r, 2, 2) : num(r, 1, 1)}×`;
}

export function perSecond(v) {
  return isNum(v) ? `${num(v, 0, v >= 100 ? 0 : 1)}${NBSP}/s` : DASH;
}

export function duration(msValue) {
  if (!isNum(msValue)) return DASH;
  if (msValue < 1000) return ms(msValue);
  const totalSec = msValue / 1000;
  if (roundTo(totalSec, 1) < 60) return `${num(totalSec, 1, 1)}${NBSP}s`;
  const wholeSeconds = Math.round(totalSec);
  const min = Math.floor(wholeSeconds / 60);
  const sec = wholeSeconds % 60;
  return `${min}${NBSP}min ${String(sec).padStart(2, '0')}${NBSP}s`;
}

export function clock(iso) {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

export function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  const rank = Math.min(sortedAsc.length, Math.max(1, Math.ceil(p * sortedAsc.length)));
  return sortedAsc[rank - 1];
}
