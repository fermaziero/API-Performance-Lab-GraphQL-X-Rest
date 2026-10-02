import { esc, isNum, num, int, ms as fmtMs, percentile } from './format.js';
import { fmtX } from './net.js';

const models = new Map();

export function empty(message) {
  return `<div class="chart-empty" role="status">${esc(message)}</div>`;
}

export function swatch(st) {
  return `<svg class="sw" viewBox="0 0 26 14" width="26" height="14" aria-hidden="true"><rect x="1" y="1" width="24" height="12" rx="2" fill="${st.pattern}" style="stroke:${st.color}" stroke-width="1.5"/></svg>`;
}

export function legend(items) {
  return `<ul class="legend">${items
    .map((it) => `<li>${swatch(it.st)}<span>${esc(it.label)}${it.v && !it.v.latency ? ' <em class="nodata">(sem amostras)</em>' : ''}</span></li>`)
    .join('')}</ul>`;
}

function timeUnit(maxMs) {
  if (maxMs < 1) return { f: 1000, u: 'µs' };
  if (maxMs >= 5000) return { f: 0.001, u: 's' };
  return { f: 1, u: 'ms' };
}

export function niceScale(min, max, target = 5) {
  if (!(max > min)) max = min + 1;
  const raw = (max - min) / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(12)));
  return { lo, hi, step, ticks };
}

function logTicks(lo, hi) {
  const ticks = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    for (const m of [1, 2, 5]) {
      const v = m * Math.pow(10, e);
      if (v >= lo * 0.999 && v <= hi * 1.001) ticks.push(v);
    }
  }
  return ticks.length >= 2 ? ticks : [lo, hi];
}

const f1 = (n) => (Math.round(n * 10) / 10).toString();

function axes({ W, H, m, yTicks, yLabel, xLabel }) {
  const ih = H - m.t - m.b;
  const iw = W - m.l - m.r;
  let out = '';
  for (const t of yTicks) {
    out += `<line class="grid" x1="${m.l}" x2="${m.l + iw}" y1="${f1(t.y)}" y2="${f1(t.y)}"/>`;
    out += `<text class="tick" x="${m.l - 9}" y="${f1(t.y + 4.5)}" text-anchor="end">${esc(t.label)}</text>`;
  }
  out += `<line class="axis" x1="${m.l}" x2="${m.l + iw}" y1="${m.t + ih}" y2="${m.t + ih}"/>`;
  out += `<line class="axis" x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${m.t + ih}"/>`;
  out += `<text class="axlabel" x="${m.l + iw / 2}" y="${H - 8}" text-anchor="middle">${esc(xLabel)}</text>`;
  out += `<text class="axlabel" transform="translate(20 ${m.t + ih / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`;
  return out;
}

export function lineChart(items, { id, mode = 'auto' }) {
  const series = items.filter((it) => it.v.samples && it.v.samples.length);
  if (!series.length) return empty('Aguardando as primeiras amostras de latência…');

  const W = 640;
  const H = 340;
  const m = { l: 78, r: 32, t: 20, b: 56 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;

  const xmax = Math.max(...series.map((it) => Math.max(it.v.completed || 0, it.v.samples.length)));
  const pooled = series.flatMap((it) => it.v.samples).filter(isNum).sort((a, b) => a - b);
  if (!pooled.length) return empty('Sem amostras de latência válidas.');
  const maxAll = pooled[pooled.length - 1];
  const cap = percentile(pooled, 0.995) * 1.25;
  const yTop = maxAll > cap ? cap : maxAll;
  const unit = timeUnit(yTop);
  const meds = series.map((it) => it.v.latency && it.v.latency.median).filter((x) => isNum(x) && x > 0);
  const useLog = mode === 'log' || (mode === 'auto' && meds.length > 1 && Math.max(...meds) / Math.min(...meds) > 6);

  let yMax;
  let Y;
  let yTicks;
  if (useLog) {
    const lo = Math.max(pooled[0] * 0.85, yTop * 1e-4, 1e-6);
    yMax = yTop * 1.1;
    const span = Math.log(yMax) - Math.log(lo);
    Y = (v) => m.t + ih - (Math.min(1, Math.max(0, (Math.log(Math.max(v, lo)) - Math.log(lo)) / span))) * ih;
    yTicks = logTicks(lo, yMax).map((t) => ({ y: Y(t), label: num(t * unit.f, 0, 3) }));
  } else {
    const sc = niceScale(0, Math.max(yTop * unit.f * 1.05, 1e-9), 5);
    yMax = sc.hi / unit.f;
    Y = (v) => m.t + ih - (Math.min(v, yMax) / yMax) * ih;
    yTicks = sc.ticks.map((t) => ({ y: m.t + ih - (t / sc.hi) * ih, label: num(t, 0, 3) }));
  }

  const X = (op) => m.l + (op / xmax) * iw;
  let svg = axes({ W, H, m, yTicks, yLabel: `Latência (${unit.u})${useLog ? ' — log' : ''}`, xLabel: 'Iteração (operação medida, em ordem de execução)' });

  const xs = xmax < 6
    ? Array.from({ length: Math.floor(xmax) + 1 }, (_, i) => i)
    : niceScale(0, xmax, 6).ticks.filter((t) => t <= xmax * 1.0001);
  for (const t of xs) {
    svg += `<line class="tickmark" x1="${f1(X(t))}" x2="${f1(X(t))}" y1="${m.t + ih}" y2="${m.t + ih + 5}"/>`;
    svg += `<text class="tick" x="${f1(X(t))}" y="${m.t + ih + 21}" text-anchor="middle">${esc(int(t))}</text>`;
  }

  let clippedPoints = 0;
  const model = { type: 'line', W, m, iw, ih, xmax, yMax, unit, Y, series: [] };
  for (const it of series) {
    const s = it.v.samples;
    const total = Math.max(it.v.completed || 0, s.length);
    let d = '';
    let drawn = 0;
    let lone = '';
    for (let i = 0; i < s.length; i++) {
      if (!isNum(s[i])) continue;
      if (s[i] > yMax) clippedPoints++;
      const x = X(((i + 0.5) / s.length) * total);
      d += `${d ? 'L' : 'M'}${f1(x)},${f1(Y(s[i]))}`;
      lone = `<circle cx="${f1(x)}" cy="${f1(Y(s[i]))}" r="4" style="fill:${it.st.color}"/>`;
      drawn++;
    }
    const med = it.v.latency && it.v.latency.median;
    if (isNum(med) && med <= yMax) {
      svg += `<line class="median-line" style="stroke:${it.st.color}" x1="${m.l}" x2="${m.l + iw}" y1="${f1(Y(med))}" y2="${f1(Y(med))}"/>`;
    }
    svg += `<path class="series" d="${d}" style="stroke:${it.st.color}" ${it.st.dash ? `stroke-dasharray="${it.st.dash}"` : ''}/>`;
    if (drawn === 1) svg += lone;
    model.series.push({ label: it.label, samples: s, total, st: it.st });
  }

  svg += `<line class="guide" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>`;
  model.series.forEach((s, i) => {
    svg += `<circle class="hdot" data-i="${i}" r="4.5" visibility="hidden" style="fill:${s.st.color}"/>`;
  });
  svg += `<rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}"/>`;

  models.set(id, model);
  const note = clippedPoints > 0
    ? `<p class="chart-note">Eixo limitado a ${esc(fmtMs(yMax))}: ${esc(int(clippedPoints))} ponto(s) mais lentos ficaram acima do gráfico. Linhas tracejadas finas = mediana.</p>`
    : `<p class="chart-note">Linhas tracejadas finas = mediana de cada variante.</p>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" data-model="${esc(id)}" role="img" aria-label="Latência por iteração">${svg}</svg>${note}`;
}

export function histogram(items, { id, mode = 'auto' }) {
  const series = items.filter((it) => it.v.samples && it.v.samples.length);
  if (!series.length) return empty('Aguardando as primeiras amostras de latência…');

  const W = 640;
  const H = 340;
  const m = { l: 72, r: 32, t: 20, b: 56 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;

  let lo = Infinity;
  const p99s = [];
  for (const it of series) {
    const sorted = it.v.samples.filter(isNum).slice().sort((a, b) => a - b);
    if (!sorted.length) continue;
    lo = Math.min(lo, sorted[0]);
    const p99 = it.v.latency && isNum(it.v.latency.p99) ? it.v.latency.p99 : percentile(sorted, 0.99);
    p99s.push(p99);
  }
  if (!p99s.length) return empty('Sem amostras de latência válidas.');
  let hi = Math.max(...p99s);
  if (!(hi > lo)) {
    const c = hi || 1;
    lo = c * 0.9;
    hi = c * 1.1;
  }
  const useLog = mode === 'log' || (mode === 'auto' && hi / Math.max(lo, 1e-9) > 6);
  if (useLog) lo = Math.max(lo, hi * 1e-4, 1e-6);

  const unit = timeUnit(hi);
  const nb = 36;
  const posOf = useLog
    ? (v) => (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))
    : (v) => (v - lo) / (hi - lo);
  const valAt = useLog
    ? (p) => Math.exp(Math.log(lo) + p * (Math.log(hi) - Math.log(lo)))
    : (p) => lo + p * (hi - lo);

  const stats = series.map((it) => {
    const counts = new Array(nb).fill(0);
    let cut = 0;
    const total = it.v.samples.filter(isNum).length;
    for (const s of it.v.samples) {
      if (!isNum(s)) continue;
      if (s > hi) {
        cut++;
        continue;
      }
      let idx = Math.floor(posOf(Math.max(s, lo)) * nb);
      idx = Math.min(nb - 1, Math.max(0, idx));
      counts[idx]++;
    }
    return { it, counts, cut, total, pct: counts.map((c) => (total ? (c / total) * 100 : 0)) };
  });

  const maxPct = Math.max(...stats.flatMap((s) => s.pct), 0.01);
  const sc = niceScale(0, maxPct * 1.08, 5);
  const X = (p) => m.l + p * iw;
  const Y = (pc) => m.t + ih - (pc / sc.hi) * ih;

  const yTicks = sc.ticks.map((t) => ({ y: Y(t), label: num(t, 0, 1) }));
  let svg = axes({ W, H, m, yTicks, yLabel: '% das amostras por faixa', xLabel: `Latência (${unit.u})${useLog ? ' — escala logarítmica' : ''}` });

  const xTickVals = useLog ? logTicks(lo, hi) : niceScale(lo, hi, 6).ticks.filter((t) => t >= lo - 1e-12 && t <= hi + 1e-12);
  for (const v of xTickVals) {
    const p = Math.min(1, Math.max(0, posOf(v)));
    svg += `<line class="tickmark" x1="${f1(X(p))}" x2="${f1(X(p))}" y1="${m.t + ih}" y2="${m.t + ih + 5}"/>`;
    svg += `<text class="tick" x="${f1(X(p))}" y="${m.t + ih + 21}" text-anchor="middle">${esc(num(v * unit.f, 0, 3))}</text>`;
  }

  for (const s of stats) {
    const st = s.it.st;
    let area = `M${f1(X(0))},${f1(Y(0))}`;
    let line = '';
    for (let i = 0; i < nb; i++) {
      const x0 = f1(X(i / nb));
      const x1 = f1(X((i + 1) / nb));
      const y = f1(Y(s.pct[i]));
      area += `L${x0},${y}L${x1},${y}`;
      line += `${i === 0 ? 'M' : 'L'}${x0},${y}L${x1},${y}`;
    }
    area += `L${f1(X(1))},${f1(Y(0))}Z`;
    svg += `<path d="${area}" style="fill:${st.color}" fill-opacity="0.2"/>`;
    svg += `<path class="series" d="${line}" style="stroke:${st.color}" ${st.dash ? `stroke-dasharray="${st.dash}"` : ''}/>`;
  }

  for (const s of stats) {
    const med = s.it.v.latency && s.it.v.latency.median;
    if (isNum(med) && med >= lo && med <= hi) {
      const x = f1(X(posOf(med)));
      svg += `<line class="median-line" style="stroke:${s.it.st.color}" x1="${x}" x2="${x}" y1="${m.t}" y2="${m.t + ih}"/>`;
    }
  }

  for (let i = 0; i < nb; i++) {
    const a = valAt(i / nb);
    const b = valAt((i + 1) / nb);
    const tip = [`${fmtMs(a)} a ${fmtMs(b)}`]
      .concat(stats.map((s) => `${s.it.label}: ${num(s.pct[i], 0, 1)}% (${int(s.counts[i])} amostras)`))
      .join('\n');
    svg += `<rect class="hit" x="${f1(X(i / nb))}" y="${m.t}" width="${f1(iw / nb)}" height="${ih}" data-tip="${esc(tip)}"/>`;
  }

  const cutText = stats
    .filter((s) => s.cut > 0)
    .map((s) => `${s.it.label} ${num((s.cut / s.total) * 100, 0, 1)}%`)
    .join(' · ');
  const note = `<p class="chart-note">Eixo cortado em ${esc(fmtMs(hi))} (maior P99 entre as variantes) para a cauda não achatar o gráfico.${cutText ? ` Amostras acima do corte: ${esc(cutText)}.` : ' Nenhuma amostra visível ficou acima do corte.'} Linhas verticais finas = mediana.</p>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Distribuição de latência">${svg}</svg>${note}`;
}

export function groupedBars(items, metrics, { id }) {
  const rows = items.filter((it) => it.v.latency);
  if (!rows.length) return empty('Aguardando as primeiras medições de latência…');

  const W = 640;
  const H = 340;
  const m = { l: 78, r: 32, t: 26, b: 56 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;

  const all = rows.flatMap((it) => metrics.map((mt) => it.v.latency[mt.key])).filter(isNum);
  if (!all.length) return empty('Sem valores de latência.');
  const maxV = Math.max(...all);
  const unit = timeUnit(maxV);
  const sc = niceScale(0, Math.max(maxV * unit.f * 1.12, 1e-9), 5);
  const Y = (v) => m.t + ih - ((v * unit.f) / sc.hi) * ih;

  const yTicks = sc.ticks.map((t) => ({ y: m.t + ih - (t / sc.hi) * ih, label: num(t, 0, 3) }));
  let svg = axes({ W, H, m, yTicks, yLabel: `Latência (${unit.u})`, xLabel: 'Estatística de latência' });

  const gw = iw / metrics.length;
  const inner = gw * 0.82;
  const bw = inner / rows.length;
  metrics.forEach((mt, gi) => {
    const gx = m.l + gi * gw + (gw - inner) / 2;
    svg += `<text class="grouplabel" x="${f1(m.l + gi * gw + gw / 2)}" y="${m.t + ih + 24}" text-anchor="middle">${esc(mt.label)}</text>`;
    rows.forEach((it, bi) => {
      const v = it.v.latency[mt.key];
      const x = gx + bi * bw;
      if (!isNum(v)) {
        svg += `<text class="barval" x="${f1(x + bw / 2)}" y="${m.t + ih - 6}" text-anchor="middle">—</text>`;
        return;
      }
      const y = Y(v);
      const h = Math.max(1, m.t + ih - y);
      const tip = `${it.label}\n${mt.label}: ${fmtMs(v)}`;
      svg += `<rect x="${f1(x + 1.5)}" y="${f1(y)}" width="${f1(Math.max(2, bw - 3))}" height="${f1(h)}" fill="${it.st.pattern}" style="stroke:${it.st.color}" stroke-width="1.5" data-tip="${esc(tip)}"/>`;
      const digits = v * unit.f >= 100 ? 0 : v * unit.f >= 10 ? 1 : 2;
      svg += `<text class="barval" x="${f1(x + bw / 2)}" y="${f1(y - 5)}" text-anchor="middle">${esc(num(v * unit.f, 0, digits))}</text>`;
    });
  });

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mediana, P95 e P99 por variante">${svg}</svg><p class="chart-note">Valores em ${unit.u} sobre cada barra. Padrões de preenchimento distinguem as variantes da mesma família.</p>`;
}

function wrapLabel(text, max = 20) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && (`${cur} ${w}`).length > max) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > 2) {
    const rest = lines.slice(1).join(' ');
    lines.length = 1;
    lines.push(rest);
  }
  return lines.map((l) => (l.length > max ? `${l.slice(0, max - 1)}…` : l));
}

export function hbars(rows, { title, tip, unitNote, emptyText = 'Sem dados ainda.' }) {
  const valid = rows.filter((r) => isNum(r.value));
  const head = `<h4 class="mini-title">${tip ? `<span class="mt" title="${esc(tip)}">${esc(title)}</span>` : esc(title)}</h4>`;
  if (!valid.length) return `${head}${empty(emptyText)}`;

  const W = 560;
  const left = 212;
  const right = 100;
  const rowH = 46;
  const H = rows.length * rowH + 12;
  const max = Math.max(...valid.map((r) => r.value), 1e-9);
  const bw = W - left - right;

  let svg = '';
  rows.forEach((r, i) => {
    const y = 6 + i * rowH;
    const lines = wrapLabel(r.label);
    const ty = y + rowH / 2 - (lines.length - 1) * 8 + 1;
    svg += `<text class="hlabel" x="${left - 12}" y="${f1(ty)}" text-anchor="end">${lines
      .map((l, k) => `<tspan x="${left - 12}" dy="${k === 0 ? 0 : 16}">${esc(l)}</tspan>`)
      .join('')}</text>`;
    if (!isNum(r.value)) {
      svg += `<text class="barval big" x="${left + 6}" y="${y + rowH / 2 + 5}">—</text>`;
      return;
    }
    const w = Math.max(r.value > 0 ? 3 : 0, (r.value / max) * bw);
    svg += `<rect x="${left}" y="${y + 6}" width="${f1(w)}" height="${rowH - 14}" rx="2" fill="${r.st.pattern}" style="stroke:${r.st.color}" stroke-width="1.5" data-tip="${esc(`${r.label}\n${r.text}`)}"/>`;
    svg += `<text class="barval big" x="${f1(left + w + 8)}" y="${y + rowH / 2 + 5}">${esc(r.text)}</text>`;
  });
  svg += `<line class="axis" x1="${left}" x2="${left}" y1="2" y2="${H - 4}"/>`;
  return `${head}<svg class="chart hbar" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${svg}</svg>${unitNote ? `<p class="chart-note">${esc(unitNote)}</p>` : ''}`;
}

const SHAPES = ['circle', 'square', 'diamond', 'triangle'];

function markerPath(shape, cx, cy, r) {
  if (shape === 'square') return `M${f1(cx - r)},${f1(cy - r)}h${f1(2 * r)}v${f1(2 * r)}h${f1(-2 * r)}z`;
  if (shape === 'diamond') {
    const k = r * 1.3;
    return `M${f1(cx)},${f1(cy - k)}L${f1(cx + k)},${f1(cy)}L${f1(cx)},${f1(cy + k)}L${f1(cx - k)},${f1(cy)}z`;
  }
  if (shape === 'triangle') return `M${f1(cx)},${f1(cy - r * 1.25)}L${f1(cx + r * 1.2)},${f1(cy + r * 0.95)}L${f1(cx - r * 1.2)},${f1(cy + r * 0.95)}z`;
  return `M${f1(cx - r)},${f1(cy)}a${f1(r)},${f1(r)} 0 1,0 ${f1(2 * r)},0a${f1(r)},${f1(r)} 0 1,0 ${f1(-2 * r)},0z`;
}

export function sweepLegend(series) {
  return `<ul class="legend">${series.map((s, i) => `<li><svg class="sw" viewBox="0 0 44 16" width="44" height="16" aria-hidden="true"><line x1="2" x2="42" y1="8" y2="8" style="stroke:${s.st.color}" stroke-width="3" ${s.st.dash ? `stroke-dasharray="${s.st.dash}"` : ''}/><path d="${markerPath(SHAPES[i % SHAPES.length], 22, 8, 5)}" style="fill:${s.st.color}" stroke-width="0"/></svg><span>${esc(s.label)}</span></li>`).join('')}</ul>`;
}

// model: { xs: [ms de rede], series: [{ label, st, pts: [{ y, sim }] }], crossings: [{ x, y, n, before, after }] }
// O SVG usa 1 unidade = 1 px (viewBox = largura do contêiner) para que a fonte efetiva seja exatamente `fontPx`.
export function sweepChart(model, { width, fontPx }) {
  const series = model.series.filter((s) => s.pts.some((p) => isNum(p.y)));
  const xs = model.xs;
  if (!series.length || !xs.length) return empty('Aguardando a primeira etapa da varredura…');

  const fs = fontPx;
  const W = Math.max(520, Math.round(width));
  const vh = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 800;
  const ih = Math.round(Math.min(520, Math.max(300, Math.min(W * 0.36, vh * 0.58))));
  const maxY = Math.max(...series.flatMap((s) => s.pts.map((p) => p.y)).filter(isNum), 1e-9);
  const unit = timeUnit(maxY);
  const sc = niceScale(0, Math.max(maxY * unit.f * 1.08, 1e-9), 5);
  const yTop = sc.hi / unit.f;
  const dec = (v) => (v * unit.f >= 100 ? 0 : v * unit.f >= 10 ? 1 : 2);

  const m = { l: Math.round(fs * 5.4), r: Math.round(fs * 5.2), t: Math.round(fs * 1.5) };
  const iw = W - m.l - m.r;
  const xTicks = [...new Set([...xs, ...(model.planned || [])])].sort((a, b) => a - b);
  const xmax = Math.max(...xTicks, 1e-9);
  const X = (x) => m.l + (x / xmax) * iw;
  const Y = (v) => m.t + ih - (Math.min(v, yTop) / yTop) * ih;

  const crossings = model.crossings || [];
  const labelOf = (c) => (crossings.length > 1 ? `${c.n} · ${fmtX(c.x)} ms` : `≈ ${fmtX(c.x)} ms`);
  const rowEnds = [];
  const placed = crossings.slice().sort((a, b) => a.x - b.x).map((c) => {
    const w = labelOf(c).length * fs * 0.62 + fs;
    const cx = Math.min(W - m.r + fs, Math.max(m.l - fs, X(c.x)));
    const left = cx - w / 2;
    let row = 0;
    while (row < rowEnds.length && rowEnds[row] > left - 6) row++;
    rowEnds[row] = left + w;
    return { c, cx, row };
  });
  const rows = rowEnds.length;
  const rowY = (row) => fs * 2.8 + row * fs * 1.55;
  const base = rows ? rowY(rows - 1) : fs * 1.45;
  const bottom = Math.round(base + fs * 1.8 + 8);
  const H = m.t + ih + bottom;

  const yTicks = sc.ticks.map((t) => ({ y: m.t + ih - (t / sc.hi) * ih, label: num(t, 0, 3) }));
  let svg = axes({ W, H, m: { ...m, b: bottom }, yTicks, yLabel: `Mediana da latência (${unit.u})`, xLabel: 'Latência de rede simulada por requisição (ms)' });
  svg = svg.replace('translate(20 ', `translate(${Math.round(fs * 1.1)} `);

  for (const x of xTicks) {
    svg += `<line class="grid" x1="${f1(X(x))}" x2="${f1(X(x))}" y1="${m.t}" y2="${m.t + ih}"/>`;
    svg += `<line class="tickmark" x1="${f1(X(x))}" x2="${f1(X(x))}" y1="${m.t + ih}" y2="${m.t + ih + 6}"/>`;
    svg += `<text class="tick" x="${f1(X(x))}" y="${f1(m.t + ih + fs * 1.45)}" text-anchor="middle">${esc(fmtX(x))}</text>`;
  }

  for (const s of series) {
    let d = '';
    s.pts.forEach((p, i) => {
      if (!isNum(p.y)) return;
      d += `${d ? 'L' : 'M'}${f1(X(xs[i]))},${f1(Y(p.y))}`;
    });
    svg += `<path class="series" d="${d}" style="stroke:${s.st.color}" ${s.st.dash ? `stroke-dasharray="${s.st.dash}"` : ''}/>`;
  }

  for (const { c, cx, row } of placed) {
    const cy = Y(c.y);
    svg += `<line class="xguide" x1="${f1(X(c.x))}" x2="${f1(X(c.x))}" y1="${f1(cy)}" y2="${m.t + ih}"/>`;
    svg += `<path class="xflag" d="M${f1(X(c.x) - 7)},${m.t + ih + 1}L${f1(X(c.x) + 7)},${m.t + ih + 1}L${f1(X(c.x))},${m.t + ih - 9}z"/>`;
    svg += `<text class="xlabel" x="${f1(cx)}" y="${f1(m.t + ih + rowY(row))}" text-anchor="middle">${esc(labelOf(c))}</text>`;
  }

  const ends = [];
  series.forEach((s, si) => {
    const shape = SHAPES[si % SHAPES.length];
    s.pts.forEach((p, i) => {
      if (!isNum(p.y)) return;
      const cx = X(xs[i]);
      const cy = Y(p.y);
      svg += `<path class="pt" d="${markerPath(shape, cx, cy, fs * 0.46)}" style="fill:${s.st.color}"/>`;
      const tip = [s.label, `rede ${fmtX(xs[i])} ms por requisição`, `mediana ${fmtMs(p.y)}`]
        .concat(isNum(p.sim) && p.sim > 0 ? [`rede simulada (soma): ${fmtMs(p.sim)}`] : [])
        .join('\n');
      svg += `<circle class="hit" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(fs * 0.9)}" data-tip="${esc(tip)}"/>`;
    });
    const last = s.pts[s.pts.length - 1];
    if (last && isNum(last.y)) ends.push({ y: Y(last.y), v: last.y });
  });

  ends.sort((a, b) => a.y - b.y);
  const gap = fs * 1.2;
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < gap) ends[i].y = ends[i - 1].y + gap;
  const xEnd = X(xs[xs.length - 1]) + fs * 1.0;
  for (const e of ends) svg += `<text class="endval" x="${f1(xEnd)}" y="${f1(e.y + fs * 0.35)}">${esc(num(e.v * unit.f, 0, dec(e.v)))}</text>`;

  const R = fs * 0.85;
  const rings = crossings.slice().sort((a, b) => a.x - b.x).map((c) => ({ c, px: X(c.x), py: Y(c.y), rx: X(c.x), ry: Y(c.y) }));
  rings.forEach((r, k) => {
    for (let guard = 0; guard < 8; guard++) {
      const hit = rings.slice(0, k).find((o) => Math.hypot(o.rx - r.rx, o.ry - r.ry) < R * 2.15);
      if (!hit) break;
      const up = hit.ry - R * 2.2;
      r.ry = up >= m.t + R ? up : hit.ry + R * 2.2;
    }
  });
  for (const r of rings) {
    const { c } = r;
    const moved = Math.hypot(r.rx - r.px, r.ry - r.py) > 2;
    const tip = `Cruzamento${crossings.length > 1 ? ` ${c.n}` : ''}: ${c.before.label} × ${c.after.label}\n≈ ${fmtX(c.x)} ms de rede por requisição\nmediana ≈ ${fmtMs(c.y)}\n(interpolado entre duas medições)`;
    if (moved) svg += `<line class="xlead" x1="${f1(r.px)}" y1="${f1(r.py)}" x2="${f1(r.rx)}" y2="${f1(r.ry)}"/><circle class="xdot" cx="${f1(r.px)}" cy="${f1(r.py)}" r="${f1(fs * 0.24)}"/>`;
    svg += `<circle class="xring" cx="${f1(r.rx)}" cy="${f1(r.ry)}" r="${f1(R)}" data-tip="${esc(tip)}"/>`;
    if (crossings.length > 1) svg += `<text class="xnum" x="${f1(r.rx)}" y="${f1(r.ry + fs * 0.36)}" text-anchor="middle">${c.n}</text>`;
    else svg += `<path class="xcross" d="M${f1(r.rx - fs * 0.4)},${f1(r.ry - fs * 0.4)}L${f1(r.rx + fs * 0.4)},${f1(r.ry + fs * 0.4)}M${f1(r.rx + fs * 0.4)},${f1(r.ry - fs * 0.4)}L${f1(r.rx - fs * 0.4)},${f1(r.ry + fs * 0.4)}"/>`;
  }

  const note = `<p class="chart-note">Pontos = medianas medidas, uma por etapa da varredura; a linha só os liga. ${crossings.length ? `Anel ${crossings.length > 1 ? 'numerado' : 'com ×'} = cruzamento interpolado, onde uma variante passa a ganhar da outra.` : 'Sem cruzamento marcado.'} Números à direita = mediana na maior latência.</p>`;
  return `<svg class="chart sweep" style="--sw-fs:${fs}px" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Mediana da latência em função da latência de rede simulada, uma linha por variante">${svg}</svg>${note}`;
}

export function initTooltips() {
  const tip = document.getElementById('tip');
  if (!tip) return;
  const hide = () => {
    if (tip.hidden) return;
    tip.hidden = true;
    document.querySelectorAll('svg.chart .guide, svg.chart .hdot').forEach((n) => n.setAttribute('visibility', 'hidden'));
  };

  const place = (e) => {
    const pad = 14;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  };

  const show = (text, e) => {
    tip.textContent = text;
    tip.hidden = false;
    place(e);
  };

  document.addEventListener('mousemove', (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const svg = target.closest('svg[data-model]');
    if (svg) {
      const model = models.get(svg.dataset.model);
      if (model && model.type === 'line' && target.classList.contains('hit')) {
        const rect = svg.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * model.W;
        const op = ((px - model.m.l) / model.iw) * model.xmax;
        const lines = [`Iteração ≈ ${int(Math.max(1, Math.round(op)))}`];
        const dots = svg.querySelectorAll('.hdot');
        model.series.forEach((s, i) => {
          const n = s.samples.length;
          let idx = Math.round((op / s.total) * n - 0.5);
          idx = Math.min(n - 1, Math.max(0, idx));
          const val = s.samples[idx];
          lines.push(`${s.label}: ${fmtMs(val)}`);
          const dot = dots[i];
          if (dot && isNum(val)) {
            const cx = model.m.l + (((idx + 0.5) / n) * s.total / model.xmax) * model.iw;
            dot.setAttribute('cx', cx.toFixed(1));
            dot.setAttribute('cy', model.Y(val).toFixed(1));
            dot.setAttribute('visibility', 'visible');
          }
        });
        const guide = svg.querySelector('.guide');
        if (guide) {
          guide.setAttribute('x1', px.toFixed(1));
          guide.setAttribute('x2', px.toFixed(1));
          guide.setAttribute('visibility', 'visible');
        }
        show(lines.join('\n'), e);
        return;
      }
    }
    const holder = target.closest('[data-tip]');
    if (holder) {
      show(holder.getAttribute('data-tip'), e);
      return;
    }
    hide();
  });
  document.addEventListener('mouseleave', hide);
  window.addEventListener('scroll', hide, { passive: true });
}
