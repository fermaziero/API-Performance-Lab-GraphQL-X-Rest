import * as F from './format.js';

const { isNum, esc } = F;

export const SWEEP_LATENCIES = [0, 20, 50, 100];
export const SWEEP_MAX_ITERATIONS = 30;
export const SWEEP_MAX_WARMUP = 10;
export const TIE = 0.03;

export function netParams(config) {
  const c = config || {};
  const latency = isNum(c.simulatedLatencyMs) && c.simulatedLatencyMs > 0 ? c.simulatedLatencyMs : 0;
  const bandwidth = isNum(c.simulatedBandwidthMbps) && c.simulatedBandwidthMbps > 0 ? c.simulatedBandwidthMbps : null;
  return { latency, bandwidth, on: latency > 0 || bandwidth !== null };
}

export function netLabel(config) {
  const n = netParams(config);
  if (!n.on) return 'loopback';
  const bw = n.bandwidth === null ? 'banda livre' : `${F.num(n.bandwidth, 0, 2)} Mbps`;
  return `${F.int(n.latency)} ms · ${bw}`;
}

export const transferMs = (bytes, mbps) => (bytes * 8) / (mbps * 1e6) * 1000;

export const fmtX = (x) => F.num(x, 0, x < 1 ? 2 : x < 10 ? 1 : 0);

export function simOf(v) {
  return v && isNum(v.simulatedNetworkMsPerOperation) ? v.simulatedNetworkMsPerOperation : null;
}

export function traceSimSum(trace) {
  return (Array.isArray(trace) ? trace : []).reduce((a, r) => a + (isNum(r.simulatedDelayMs) ? r.simulatedDelayMs : 0), 0);
}

// Os atrasos só são aditivos (dá para subtrair da mediana) quando nada se sobrepõe no tempo.
export function additive(config) {
  const c = config || {};
  return !c.restParallel && !(isNum(c.concurrency) && c.concurrency > 1);
}

/* ------------------------------------------------------------- cruzamentos */

// Cruzamentos entre duas séries (mesmos x). Um cruzamento só é "sustentado" quando, nos dois lados,
// o ponto decisivo mais próximo (diferença maior que `tie`) tem o sinal oposto: evita contar ruído.
export function findCrossings(xs, ya, yb, tie = TIE) {
  const n = xs.length;
  const d = new Array(n).fill(null);
  const sign = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (!isNum(ya[i]) || !isNum(yb[i])) continue;
    d[i] = ya[i] - yb[i];
    const base = Math.min(ya[i], yb[i]);
    const rel = base > 0 ? Math.abs(d[i]) / base : (d[i] === 0 ? 0 : Infinity);
    sign[i] = rel <= tie ? 0 : Math.sign(d[i]);
  }
  const valid = [];
  for (let i = 0; i < n; i++) if (d[i] !== null) valid.push(i);
  const nz = valid.filter((i) => d[i] !== 0);
  const out = [];
  for (let k = 1; k < nz.length; k++) {
    const p = nz[k - 1];
    const q = nz[k];
    if (Math.sign(d[p]) === Math.sign(d[q])) continue;
    const zeros = valid.filter((i) => i > p && i < q);
    let x;
    let y;
    if (zeros.length) {
      x = xs[zeros[0]];
      y = ya[zeros[0]];
    } else {
      const t = d[p] / (d[p] - d[q]);
      x = xs[p] + t * (xs[q] - xs[p]);
      y = ya[p] + t * (ya[q] - ya[p]);
    }
    let sl = 0;
    for (let i = p; i >= 0 && sl === 0; i--) if (sign[i]) sl = sign[i];
    let sr = 0;
    for (let i = q; i < n && sr === 0; i++) if (sign[i]) sr = sign[i];
    out.push({ x, y, from: p, to: q, supported: sl !== 0 && sr !== 0 && sl === -sr, leftSign: sl });
  }
  return out;
}

function slopeOf(xs, ys) {
  const pts = xs.map((x, i) => [x, ys[i]]).filter(([, y]) => isNum(y));
  if (pts.length < 2) return null;
  const mx = pts.reduce((a, [x]) => a + x, 0) / pts.length;
  const my = pts.reduce((a, [, y]) => a + y, 0) / pts.length;
  const sxx = pts.reduce((a, [x]) => a + (x - mx) ** 2, 0);
  if (!(sxx > 0)) return null;
  return pts.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0) / sxx;
}

// series: [{ id, label, ys: [mediana por x | null] }]
export function sweepAnalysis(series, xs) {
  const crossings = [];
  for (let a = 0; a < series.length; a++) {
    for (let b = a + 1; b < series.length; b++) {
      for (const c of findCrossings(xs, series[a].ys, series[b].ys)) {
        const aSlower = c.leftSign > 0;
        crossings.push({ ...c, before: aSlower ? series[b] : series[a], after: aSlower ? series[a] : series[b] });
      }
    }
  }
  crossings.sort((p, q) => p.x - q.x);
  const supported = crossings.filter((c) => c.supported);
  supported.forEach((c, i) => { c.n = i + 1; });

  const leaders = xs.map((_, i) => {
    const vals = series.map((s) => s.ys[i]).filter(isNum);
    if (!vals.length) return [];
    const best = Math.min(...vals);
    return series.filter((s) => isNum(s.ys[i]) && s.ys[i] <= best * (1 + TIE));
  });
  const slopes = series.map((s) => slopeOf(xs, s.ys));
  return { crossings, supported, unsupported: crossings.length - supported.length, leaders, slopes };
}

const val = (s) => `<span class="rv">${esc(s)}</span>`;

function joinList(arr) {
  if (arr.length <= 1) return arr.join('');
  return `${arr.slice(0, -1).join(', ')} e ${arr[arr.length - 1]}`;
}

// Leitura em texto do gráfico, gerada só dos números medidos.
export function sweepReading(series, xs, an, ctx) {
  const paras = [];
  if (xs.length < 2 || series.length < 2) {
    paras.push(['Cruzamentos', ctx.active ? 'Aguardando pelo menos duas etapas da varredura para comparar as variantes.' : 'Menos de duas etapas concluídas: não há como comparar as variantes nem procurar cruzamentos.']);
  } else if (an.supported.length) {
    const multi = an.supported.length > 1;
    const sentences = an.supported.map((c) => `${multi ? `<strong>(${c.n})</strong> ` : ''}Até ~${val(`${fmtX(c.x)} ms`)} de rede por requisição, ${esc(c.before.label)} é mais rápido; acima disso, ${esc(c.after.label)} passa à frente (mediana ≈ ${val(F.ms(c.y))} no cruzamento).`);
    paras.push(['Cruzamentos', sentences.join(' ')]);
  } else {
    let common = series.filter((s) => an.leaders.every((l) => l.includes(s)));
    const last = xs.length - 1;
    const lastVals = series.map((s) => s.ys[last]).filter(isNum);
    let tail = '';
    if (lastVals.length > 1) {
      const lo = Math.min(...lastVals);
      const hi = Math.max(...lastVals);
      const fast = series.find((s) => s.ys[last] === lo);
      const slow = series.find((s) => s.ys[last] === hi);
      if (lo > 0 && hi / lo > 1 + TIE) tail = ` Em ${val(`${fmtX(xs[last])} ms`)}, ${esc(fast.label)} fica ${val(F.ratio(hi / lo))} à frente de ${esc(slow.label)} (${val(F.ms(lo))} contra ${val(F.ms(hi))}).`;
    }
    let body;
    if (common.length === 1) {
      const tiedAt = xs.filter((_, i) => an.leaders[i].length > 1);
      const rivals = series.filter((s) => s !== common[0] && an.leaders.some((l) => l.includes(s) && l.length > 1));
      body = tiedAt.length
        ? `Nenhum cruzamento entre ${val(`${fmtX(xs[0])} e ${fmtX(xs[last])} ms`)} de rede: ${esc(common[0].label)} esteve à frente em todas as latências testadas, mas em ${joinList(tiedAt.map((x) => val(`${fmtX(x)} ms`)))} a diferença para ${joinList(rivals.map((s) => esc(s.label)))} ficou abaixo de ${val(F.pct(TIE, 0))} (empate técnico).`
        : `Nenhum cruzamento entre ${val(`${fmtX(xs[0])} e ${fmtX(xs[last])} ms`)} de rede: ${esc(common[0].label)} foi a variante mais rápida em todas as latências testadas.`;
    } else if (common.length > 1) {
      body = `Nenhum cruzamento entre ${val(`${fmtX(xs[0])} e ${fmtX(xs[last])} ms`)} de rede: ${joinList(common.map((s) => esc(s.label)))} ficaram juntas na frente (diferença abaixo de ${val(F.pct(TIE, 0))}, empate técnico) em todas as latências testadas.`;
    } else {
      body = `Nenhum cruzamento sustentado pelos dados entre ${val(`${fmtX(xs[0])} e ${fmtX(xs[last])} ms`)} de rede: as diferenças que se alternaram ficaram abaixo de ${val(F.pct(TIE, 0))} (empate técnico).`;
    }
    paras.push(['Cruzamentos', body + tail]);
  }

  const slopeItems = series
    .map((s, i) => ({ s, k: an.slopes[i] }))
    .filter((e) => isNum(e.k))
    .map((e) => {
      const rq = ctx.requests && ctx.requests[e.s.id];
      const reqs = isNum(rq) ? ` (${F.count(rq)} ${rq === 1 ? 'requisição' : 'requisições'} por operação)` : '';
      return `${esc(e.s.label)} ${val(`+${F.ms(e.k * 10)}`)}${reqs}`;
    });
  if (slopeItems.length) {
    const overlap = ctx.overlap ? ' Com requisições em paralelo ou concorrência maior que 1 os atrasos se sobrepõem, então a inclinação fica abaixo do número de requisições.' : '';
    paras.push(['Inclinação', `A cada +10 ms de latência de rede, a mediana sobe: ${joinList(slopeItems)}.${overlap}`]);
  }

  const notes = [];
  if (an.supported.length) notes.push('Os pontos de cruzamento são interpolados em linha reta entre duas medições vizinhas.');
  if (ctx.reduced) notes.push(`Cada ponto é um run próprio com ${val(F.int(ctx.iterations))} iterações e warm-up ${val(F.int(ctx.warmup))} (reduzidos para a varredura): é uma indicação do formato da curva; repita com mais iterações para confirmar.`);
  else notes.push(`Cada ponto é um run próprio com ${val(F.int(ctx.iterations))} iterações e warm-up ${val(F.int(ctx.warmup))}.`);
  if (an.unsupported > 0) notes.push(`${F.int(an.unsupported)} inversão(ões) ocorreram dentro do empate técnico (${F.pct(TIE, 0)}) e não foram marcadas como cruzamento.`);
  if (ctx.partial) notes.push('Varredura incompleta: o gráfico mostra só as etapas concluídas.');
  if (ctx.errorVariants && ctx.errorVariants.length) notes.push(`Houve operações com erro em: ${joinList(ctx.errorVariants.map(esc))}. Compare com cautela.`);
  paras.push(['Observações', notes.join(' ')]);
  return paras;
}
