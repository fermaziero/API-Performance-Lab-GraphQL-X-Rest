import { api } from './api.js';
import * as F from './format.js';
import * as C from './charts.js';
import * as N from './net.js';
import { GLOSSARY, TIPS } from './glossary.js';

const POLL_MS = 250;
const MAX_POLL_FAILS = 20;
const TIE = 0.03;
const NOISE_Z = 2;
const MIN_TAIL_SAMPLES = 100;
const PHASES = ['cold', 'warmup', 'benchmark', 'done'];
const STATUS_TEXT = { running: 'Em execução', completed: 'Concluído', failed: 'Falhou', cancelled: 'Cancelado' };
const DASHES = ['', '7 4', '2 4', '9 4 2 4'];

const { esc, isNum } = F;
const $ = (sel, root = document) => root.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kindName = (k) => (k === 'graphql' ? 'GraphQL' : 'REST');

const state = {
  info: null,
  scenarios: [],
  scenarioId: null,
  config: { iterations: 1000, warmup: 50, concurrency: 1, restParallel: false, simulatedLatencyMs: 0, simulatedBandwidthMbps: null },
  run: null,
  sweep: null,
  viewingHistory: false,
  history: [],
  starting: false,
  cancelling: false,
  batch: null,
  histMode: 'auto',
  lineMode: 'auto',
  benchStart: null,
  renderSig: '',
  traceSig: '',
};
let pollToken = 0;

/* ---------------------------------------------------------------- estilos */

function buildStyles(variants) {
  const counters = {};
  const out = {};
  for (const v of variants) {
    const kind = v.kind === 'graphql' ? 'graphql' : 'rest';
    counters[kind] = (counters[kind] ?? -1) + 1;
    const idx = counters[kind];
    const slot = `${kind === 'graphql' ? 'g' : 'r'}${idx % 4}`;
    out[v.id] = { slot, color: `var(--c-${slot})`, pattern: `url(#pt-${slot})`, dash: DASHES[idx % 4] };
  }
  return out;
}

const scenarioOf = (id) => state.scenarios.find((s) => s.id === id) || null;
const currentScenario = () => scenarioOf(state.scenarioId);
const sweepActive = () => !!(state.sweep && state.sweep.active);
const isBusy = () => state.starting || (state.run && state.run.status === 'running') || !!(state.batch && state.batch.active) || sweepActive();
const tipLabel = (key, text) => (TIPS[key] ? `<span class="mt" title="${esc(TIPS[key])}">${text}</span>` : text);

/* ------------------------------------------------------------------ tema */

function applyTheme(theme, persist) {
  document.documentElement.setAttribute('data-theme', theme);
  const dark = theme === 'dark';
  $('#theme-btn').setAttribute('aria-pressed', String(dark));
  $('#theme-label').textContent = dark ? 'Tema claro' : 'Tema escuro';
  $('#theme-icon').textContent = dark ? '☀' : '◐';
  if (persist) {
    try {
      localStorage.setItem('lab-theme', theme);
    } catch {
      /* armazenamento indisponível: preferência vale só nesta sessão */
    }
  }
}

function initTheme() {
  const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  applyTheme(t, false);
  $('#theme-btn').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next, true);
  });
}

/* ---------------------------------------------------------------- banners */

function showBanner(kind, message, { key, actions = [], dismiss = true } = {}) {
  const slot = $('#banner');
  if (key) removeBanner(key);
  const div = document.createElement('div');
  div.className = `banner ${kind}`;
  div.setAttribute('role', kind === 'info' ? 'status' : 'alert');
  if (key) div.dataset.key = key;
  const msg = document.createElement('span');
  msg.className = 'b-msg';
  msg.textContent = message;
  div.append(msg);
  for (const a of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn sm';
    b.textContent = a.label;
    b.addEventListener('click', a.onClick);
    div.append(b);
  }
  if (dismiss) {
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'btn sm';
    x.textContent = 'Fechar';
    x.addEventListener('click', () => div.remove());
    div.append(x);
  }
  slot.append(div);
  return div;
}

function removeBanner(key) {
  document.querySelectorAll(`#banner [data-key="${key}"]`).forEach((n) => n.remove());
}

function clearBanners() {
  $('#banner').replaceChildren();
}

/* ---------------------------------------------------------- info / ambiente */

const DB_LABELS = {
  categories: 'categorias',
  suppliers: 'fornecedores',
  products: 'produtos',
  customers: 'clientes',
  orders: 'pedidos',
  orderItems: 'itens de pedido',
};

const DB_PROVIDER_LABELS = {
  sqlite: 'SQLite (no processo)',
  postgres: 'PostgreSQL (via TCP)',
};

const DB_METHOD_TEXT = {
  sqlite: 'banco SQLite local (dentro do processo)',
  postgres: 'banco PostgreSQL local em contêiner (cada consulta SQL paga uma ida e volta por TCP)',
};

function renderEnv(error) {
  const box = $('#env');
  if (error) {
    box.innerHTML = `<span class="e-item e-error"><i>Ambiente</i><b>Não foi possível ler /api/info: ${esc(error.message)}</b></span><button type="button" class="btn btn-ghost sm" id="env-retry">Tentar novamente</button>`;
    $('#env-retry').addEventListener('click', loadInfo);
    return;
  }
  const i = state.info || {};
  const item = (label, value) => (value === undefined || value === null || value === ''
    ? ''
    : `<span class="e-item"><i>${esc(label)}</i><b>${esc(value)}</b></span>`);
  const db = i.database && typeof i.database === 'object' ? i.database : null;
  const dbText = db
    ? Object.entries(db)
      .filter(([, v]) => isNum(v))
      .map(([k, v]) => `${F.int(v)} ${DB_LABELS[k] || k}`)
      .join(' · ')
    : '';
  const methodDb = $('#method-db');
  if (methodDb) methodDb.textContent = DB_METHOD_TEXT[i.databaseProvider] || 'banco de dados local';
  box.innerHTML = [
    item('.NET', i.dotnetVersion),
    item('Sistema', i.os),
    item('Núcleos', isNum(i.processorCount) ? F.int(i.processorCount) : null),
    item('Ambiente', i.environment),
    item('Banco', DB_PROVIDER_LABELS[i.databaseProvider] || i.databaseProvider),
    item('Base de dados', dbText),
  ].join('') || '<span class="e-item"><i>Ambiente</i><b>sem dados</b></span>';
  if (typeof i.graphqlEndpoint === 'string' && i.graphqlEndpoint.startsWith('/')) {
    $('#gql-link').setAttribute('href', i.graphqlEndpoint);
  }
}

async function loadInfo() {
  try {
    state.info = await api.info();
    renderEnv();
  } catch (e) {
    renderEnv(e);
  }
}

/* --------------------------------------------------------------- cenários */

function highlightCode(code) {
  return esc(code)
    .replace(/^(GET|POST|PUT|PATCH|DELETE)\b/gm, '<span class="m">$1</span>')
    .replace(/(\(×\s?N\)|×\s?N\b)/g, '<span class="n">$1</span>');
}

function renderScenarios() {
  const box = $('#scenarios');
  if (!state.scenarios.length) {
    box.innerHTML = '<p class="muted">Nenhum cenário disponível no servidor.</p>';
    return;
  }
  box.innerHTML = state.scenarios.map((s) => {
    const variants = Array.isArray(s.variants) ? s.variants : [];
    const checked = s.id === state.scenarioId ? 'checked' : '';
    return `<label class="scn">
      <input type="radio" name="scenario" value="${esc(s.id)}" ${checked}>
      <h3>${esc(s.title)}</h3>
      <p>${esc(s.description)}</p>
      ${s.need ? `<p class="scn-need"><b>A tela precisa:</b> ${esc(s.need)}</p>` : ''}
      <span class="tags">${variants.map((v) => `<span class="kindtag kind-${esc(v.kind)}">${esc(v.id)}</span>`).join('')}</span>
    </label>`;
  }).join('');
  box.querySelectorAll('input[name="scenario"]').forEach((r) => {
    r.addEventListener('change', () => selectScenario(r.value));
  });
  renderScenarioDetail();
}

function renderScenarioDetail() {
  const box = $('#scn-detail');
  const s = currentScenario();
  if (!s) {
    box.innerHTML = '';
    return;
  }
  const variants = Array.isArray(s.variants) ? s.variants : [];
  const styles = buildStyles(variants);
  box.innerHTML = `
    ${s.need ? `<p class="need"><b>O que a tela precisa</b>${esc(s.need)}</p>` : ''}
    <div class="previews">${variants.map((v) => `
      <article class="preview" style="--vc:${styles[v.id].color}">
        <header><span class="kindtag kind-${esc(v.kind)}">${kindName(v.kind)}</span><strong>${esc(v.label)}</strong></header>
        ${v.description ? `<p>${esc(v.description)}</p>` : ''}
        <pre class="code" tabindex="0"><code>${highlightCode(v.requestPreview || '')}</code></pre>
      </article>`).join('')}
    </div>`;
}

function selectScenario(id) {
  state.scenarioId = id;
  const radio = document.querySelector(`input[name="scenario"][value="${CSS.escape(id)}"]`);
  if (radio) radio.checked = true;
  renderScenarioDetail();
  renderConfigState();
}

async function loadScenarios() {
  const box = $('#scenarios');
  box.innerHTML = '<p class="muted">Carregando cenários…</p>';
  try {
    const list = await api.scenarios();
    state.scenarios = Array.isArray(list) ? list : [];
    if (!scenarioOf(state.scenarioId)) state.scenarioId = state.scenarios[0] ? state.scenarios[0].id : null;
    renderScenarios();
    renderConfigState();
  } catch (e) {
    box.innerHTML = `<div class="banner error" role="alert"><span class="b-msg">Não foi possível carregar os cenários: ${esc(e.message)}</span><button type="button" class="btn sm" id="scn-retry">Tentar novamente</button></div>`;
    $('#scn-retry').addEventListener('click', loadScenarios);
    renderConfigState();
  }
}

/* ----------------------------------------------------------- configuração */

function validateConfig() {
  const c = state.config;
  const errors = [];
  const okInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const iter = $('#iter');
  const warm = $('#warmup');
  const itOk = okInt(c.iterations, 1, 10000);
  const wuOk = okInt(c.warmup, 0, 1000);
  iter.setAttribute('aria-invalid', String(!itOk));
  warm.setAttribute('aria-invalid', String(!wuOk));
  if (!itOk) errors.push('Iterações devem ser um inteiro entre 1 e 10.000.');
  if (!wuOk) errors.push('Warm-up deve ser um inteiro entre 0 e 1.000.');
  if (!okInt(c.concurrency, 1, 32)) errors.push('Concorrência deve estar entre 1 e 32.');
  const latOk = okInt(c.simulatedLatencyMs, 0, 1000);
  const bw = c.simulatedBandwidthMbps;
  const bwOk = bw === null || (isNum(bw) && bw >= 0.1 && bw <= 10000);
  $('#net-lat').setAttribute('aria-invalid', String(!latOk));
  $('#net-bw').setAttribute('aria-invalid', String(!bwOk));
  if (!latOk) errors.push('Latência de rede simulada deve ser um inteiro entre 0 e 1.000 ms.');
  if (!bwOk) errors.push('Banda simulada deve estar entre 0,1 e 10.000 Mbps (ou vazia, sem limite).');
  return errors;
}

function netSummaryHtml(c) {
  const n = N.netParams(c);
  if (!n.on) return 'Rede simulada <b>desligada</b>: o benchmark mede só o loopback, onde a rede custa praticamente zero. Ligue para ver o que o loopback esconde.';
  const parts = [];
  if (n.latency > 0) parts.push(`<b>+${F.int(n.latency)} ms</b> de latência`);
  if (n.bandwidth !== null) parts.push(`banda de <b>${F.num(n.bandwidth, 0, 2)} Mbps</b> (100 KB trafegados custam ≈ ${esc(F.ms(N.transferMs(102400, n.bandwidth)))})`);
  return `Cada requisição HTTP recebe ${parts.join(' e ')}. <b>SIMULAÇÃO</b>: o atraso é injetado no cliente do laboratório depois que a resposta chega, não vem de uma rede real. Vale no cold run e no benchmark, não no warm-up.`;
}

function sweepPlan() {
  const s = currentScenario();
  const c = state.config;
  const maxIt = s && isNum(s.maxIterations) ? s.maxIterations : Infinity;
  const iterations = Math.max(1, Math.min(c.iterations, N.SWEEP_MAX_ITERATIONS, maxIt));
  const warmup = Math.max(0, Math.min(c.warmup, N.SWEEP_MAX_WARMUP));
  return { iterations, warmup };
}

function syncChips() {
  document.querySelectorAll('#iter-chips .chip-btn').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.v) === state.config.iterations));
  });
  document.querySelectorAll('#conc-chips .chip-btn').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.v) === state.config.concurrency));
  });
  document.querySelectorAll('#lat-chips .chip-btn').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.v) === state.config.simulatedLatencyMs));
  });
  document.querySelectorAll('#bw-chips .chip-btn').forEach((b) => {
    const bw = state.config.simulatedBandwidthMbps;
    b.setAttribute('aria-pressed', String(b.dataset.v === '' ? bw === null : Number(b.dataset.v) === bw));
  });
}

function renderConfigState() {
  const busy = isBusy();
  const errors = validateConfig();
  const s = currentScenario();
  const nested = !!s && s.id === 'nested';
  const nVar = s && Array.isArray(s.variants) ? s.variants.length : 0;

  const summary = $('#cfg-summary');
  if (errors.length) {
    summary.textContent = errors.join(' ');
    summary.classList.add('err');
  } else if (s) {
    const c = state.config;
    summary.classList.remove('err');
    const capped = c.iterations < c.concurrency ? ` Atenção: com ${F.int(c.iterations)} iterações a concorrência efetiva é ${F.int(c.iterations)}.` : '';
    summary.textContent = `${F.int(nVar)} variantes × ${F.int(c.iterations)} iterações = ${F.int(nVar * c.iterations)} operações medidas; warm-up mínimo de ${F.int(c.warmup)} por variante; concorrência ${F.int(c.concurrency)}.${capped}`;
  } else {
    summary.classList.remove('err');
    summary.textContent = '';
  }

  const rp = $('#rest-parallel');
  rp.disabled = busy || !nested;
  rp.checked = nested && state.config.restParallel;
  $('#rp-hint').textContent = nested
    ? 'Dispara em paralelo a busca de itens de cada pedido.'
    : 'Só se aplica ao cenário de relacionamentos (nested).';

  const lock = busy;
  $('#iter').disabled = lock;
  $('#warmup').disabled = lock;
  $('#net-lat').disabled = lock;
  $('#net-bw').disabled = lock;
  $('#net-summary').innerHTML = errors.length ? '' : netSummaryHtml(state.config);
  const plan = sweepPlan();
  const bwText = state.config.simulatedBandwidthMbps === null ? 'banda sem limite' : `banda ${F.num(state.config.simulatedBandwidthMbps, 0, 2)} Mbps`;
  $('#sweep-hint').textContent = s && !errors.length
    ? `Varredura de rede: roda “${s.title}” em ${joinList(N.SWEEP_LATENCIES.map((l) => `${F.int(l)} ms`))} de latência (${bwText}), com ${F.int(plan.iterations)} iterações e warm-up ${F.int(plan.warmup)} por etapa.`
    : '';
  document.querySelectorAll('.chip-btn').forEach((b) => { b.disabled = lock; });
  document.querySelectorAll('input[name="scenario"]').forEach((r) => { r.disabled = lock; });

  const canRun = !busy && !errors.length && !!s;
  $('#btn-run').disabled = !canRun;
  $('#btn-all').disabled = busy || !!errors.length || !state.scenarios.length;
  $('#btn-sweep').disabled = !canRun;

  const running = !!state.run && state.run.status === 'running';
  for (const id of ['#btn-cancel', '#btn-cancel-bar']) {
    const b = $(id);
    b.hidden = !(running || (state.batch && state.batch.active) || sweepActive() || state.starting);
    b.disabled = state.cancelling || state.starting;
    b.textContent = state.cancelling ? 'Cancelando…' : '■ Cancelar';
  }

  document.querySelectorAll('[data-view]').forEach((b) => {
    b.disabled = busy;
  });
  syncChips();
}

function bindConfig() {
  $('#iter').addEventListener('input', (e) => {
    state.config.iterations = e.target.value === '' ? NaN : Number(e.target.value);
    renderConfigState();
  });
  $('#warmup').addEventListener('input', (e) => {
    state.config.warmup = e.target.value === '' ? NaN : Number(e.target.value);
    renderConfigState();
  });
  $('#iter-chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip-btn');
    if (!b) return;
    state.config.iterations = Number(b.dataset.v);
    $('#iter').value = b.dataset.v;
    renderConfigState();
  });
  $('#conc-chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip-btn');
    if (!b) return;
    state.config.concurrency = Number(b.dataset.v);
    renderConfigState();
  });
  $('#net-lat').addEventListener('input', (e) => {
    state.config.simulatedLatencyMs = e.target.value === '' ? NaN : Number(e.target.value);
    renderConfigState();
  });
  $('#net-bw').addEventListener('input', (e) => {
    state.config.simulatedBandwidthMbps = e.target.value === '' ? null : Number(e.target.value);
    renderConfigState();
  });
  $('#lat-chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip-btn');
    if (!b) return;
    state.config.simulatedLatencyMs = Number(b.dataset.v);
    $('#net-lat').value = b.dataset.v;
    renderConfigState();
  });
  $('#bw-chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip-btn');
    if (!b) return;
    state.config.simulatedBandwidthMbps = b.dataset.v === '' ? null : Number(b.dataset.v);
    $('#net-bw').value = b.dataset.v;
    renderConfigState();
  });
  $('#btn-sweep').addEventListener('click', doSweep);
  $('#rest-parallel').addEventListener('change', (e) => {
    state.config.restParallel = e.target.checked;
    renderConfigState();
  });
  $('#cfg').addEventListener('submit', (e) => e.preventDefault());
  $('#btn-run').addEventListener('click', doRun);
  $('#btn-all').addEventListener('click', doRunAll);
  $('#btn-cancel').addEventListener('click', doCancel);
  $('#btn-cancel-bar').addEventListener('click', doCancel);
  for (const [sel, key] of [['#hist-mode', 'histMode'], ['#line-mode', 'lineMode']]) {
    $(sel).addEventListener('click', (e) => {
      const b = e.target.closest('button[data-mode]');
      if (!b) return;
      state[key] = b.dataset.mode;
      document.querySelectorAll(`${sel} button`).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      if (state.run) renderCharts(buildItems(state.run), state.run);
    });
  }
  syncChips();
}

/* -------------------------------------------------------------- execução */

function payloadFor(scenarioId) {
  const c = state.config;
  return {
    scenarioId,
    iterations: c.iterations,
    warmup: c.warmup,
    concurrency: c.concurrency,
    restParallel: scenarioId === 'nested' ? !!c.restParallel : false,
    simulatedLatencyMs: c.simulatedLatencyMs,
    simulatedBandwidthMbps: c.simulatedBandwidthMbps,
  };
}

function handleStartError(e) {
  if (e.status === 409) {
    showBanner('error', `${e.message}`, {
      key: 'start',
      actions: [{ label: 'Acompanhar o run em andamento', onClick: attachRunning }],
    });
  } else if (e.status === 400) {
    showBanner('error', `O servidor recusou a configuração: ${e.message}`, { key: 'start' });
  } else {
    showBanner('error', e.message, { key: 'start' });
  }
}

function scrollToEl(el) {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
}

function scrollToLive() {
  scrollToEl($('#livebar'));
}

async function startOne(scenarioId, overrides = {}) {
  const res = await api.startRun({ ...payloadFor(scenarioId), ...overrides });
  if (!res || !res.runId) throw new Error('Resposta inesperada ao iniciar o run (sem runId).');
  return res.runId;
}

async function doRun() {
  if (isBusy() || !state.scenarioId) return;
  clearBanners();
  state.viewingHistory = false;
  state.starting = true;
  state.cancelling = false;
  renderConfigState();
  try {
    const runId = await startOne(state.scenarioId);
    state.starting = false;
    state.renderSig = '';
    state.traceSig = '';
    $('#livebar').hidden = false;
    scrollToLive();
    const final = await poll(runId);
    if (final) await loadHistory();
  } catch (e) {
    state.starting = false;
    handleStartError(e);
  }
  state.starting = false;
  state.cancelling = false;
  renderConfigState();
}

async function doRunAll() {
  if (isBusy() || !state.scenarios.length) return;
  clearBanners();
  const cfgSnapshot = { ...state.config };
  const batch = { ids: state.scenarios.map((s) => s.id), index: 0, results: {}, active: true, cancel: false, config: cfgSnapshot, aborted: null };
  state.batch = batch;
  state.viewingHistory = false;
  state.cancelling = false;
  renderMatrix();
  renderConfigState();
  try {
    for (let i = 0; i < batch.ids.length; i++) {
      if (batch.cancel) break;
      batch.index = i;
      const id = batch.ids[i];
      selectScenario(id);
      state.starting = true;
      renderConfigState();
      let runId;
      try {
        runId = await startOne(id);
      } catch (e) {
        state.starting = false;
        handleStartError(e);
        batch.aborted = `Falha ao iniciar “${(scenarioOf(id) || {}).title || id}”: ${e.message}`;
        break;
      }
      state.starting = false;
      state.renderSig = '';
      state.traceSig = '';
      $('#livebar').hidden = false;
      if (i === 0) scrollToLive();
      const final = await poll(runId);
      if (!final) {
        batch.aborted = 'Acompanhamento interrompido (conexão perdida).';
        break;
      }
      batch.results[id] = final;
      renderMatrix();
      if (final.status !== 'completed') {
        batch.aborted = final.status === 'cancelled' ? 'Execução em lote cancelada.' : `O cenário “${(scenarioOf(id) || {}).title || id}” falhou.`;
        break;
      }
    }
  } finally {
    batch.active = false;
    state.starting = false;
    state.cancelling = false;
    renderMatrix();
    renderConfigState();
    renderLiveBar();
    await loadHistory();
  }
}

async function doSweep() {
  if (isBusy() || !state.scenarioId) return;
  const scn = currentScenario();
  if (!scn) return;
  clearBanners();
  const plan = sweepPlan();
  const c = state.config;
  const sweep = {
    active: true,
    cancel: false,
    scenarioId: scn.id,
    bandwidth: c.simulatedBandwidthMbps,
    config: { iterations: plan.iterations, warmup: plan.warmup, concurrency: c.concurrency, restParallel: scn.id === 'nested' ? !!c.restParallel : false, userIterations: c.iterations, userWarmup: c.warmup },
    steps: N.SWEEP_LATENCIES.map((latency) => ({ latency, status: 'pending', run: null })),
    index: 0,
    aborted: null,
  };
  state.sweep = sweep;
  state.viewingHistory = false;
  state.cancelling = false;
  renderSweep();
  renderConfigState();
  scrollToEl($('#sweep-sec'));
  try {
    for (let i = 0; i < sweep.steps.length; i++) {
      if (sweep.cancel) {
        sweep.aborted = 'Varredura cancelada.';
        break;
      }
      const step = sweep.steps[i];
      sweep.index = i;
      step.status = 'running';
      state.starting = true;
      renderSweep();
      renderConfigState();
      let runId;
      try {
        runId = await startOne(scn.id, { iterations: plan.iterations, warmup: plan.warmup, simulatedLatencyMs: step.latency, simulatedBandwidthMbps: c.simulatedBandwidthMbps });
      } catch (e) {
        state.starting = false;
        step.status = 'failed';
        handleStartError(e);
        sweep.aborted = `Falha ao iniciar a etapa de ${F.int(step.latency)} ms: ${e.message}`;
        break;
      }
      state.starting = false;
      step.runId = runId;
      state.renderSig = '';
      state.traceSig = '';
      $('#livebar').hidden = false;
      const final = await poll(runId);
      if (!final) {
        step.status = 'failed';
        sweep.aborted = 'Acompanhamento interrompido (conexão perdida).';
        break;
      }
      step.run = final;
      step.status = final.status;
      renderSweep();
      if (final.status !== 'completed') {
        sweep.aborted = final.status === 'cancelled' ? `Varredura cancelada na etapa de ${F.int(step.latency)} ms.` : `A etapa de ${F.int(step.latency)} ms falhou${final.error ? `: ${final.error}` : ''}.`;
        break;
      }
    }
  } finally {
    sweep.active = false;
    state.starting = false;
    state.cancelling = false;
    renderSweep();
    renderConfigState();
    renderLiveBar();
    await loadHistory();
  }
}

async function doCancel() {
  if (state.cancelling) return;
  if (state.batch && state.batch.active) state.batch.cancel = true;
  if (sweepActive()) state.sweep.cancel = true;
  const run = state.run;
  if (!run || run.status !== 'running') return;
  state.cancelling = true;
  renderConfigState();
  try {
    await api.cancelRun(run.runId);
  } catch (e) {
    state.cancelling = false;
    showBanner('error', `Não foi possível cancelar: ${e.message}`, { key: 'cancel' });
    renderConfigState();
  }
}

async function attachRunning() {
  try {
    const list = await api.listRuns();
    const running = (Array.isArray(list) ? list : []).find((r) => r.status === 'running');
    if (!running) {
      removeBanner('conn');
      showBanner('info', 'Nenhum run em andamento foi encontrado no servidor. Tente executar novamente.', { key: 'start' });
      return;
    }
    clearBanners();
    const full = await api.getRun(running.runId);
    state.viewingHistory = false;
    state.renderSig = '';
    state.traceSig = '';
    if (full.scenarioId && scenarioOf(full.scenarioId)) selectScenario(full.scenarioId);
    applyRun(full);
    $('#livebar').hidden = false;
    await poll(full.runId);
    await loadHistory();
    renderConfigState();
  } catch (e) {
    showBanner('error', e.message, { key: 'start' });
  }
}

async function poll(runId) {
  const token = ++pollToken;
  let fails = 0;
  while (token === pollToken) {
    try {
      const run = await api.getRun(runId);
      if (token !== pollToken) return null;
      if (fails) removeBanner('conn');
      fails = 0;
      applyRun(run);
      if (run.status !== 'running') {
        state.cancelling = false;
        renderConfigState();
        return run;
      }
    } catch (e) {
      if (token !== pollToken) return null;
      if (e.status === 404) {
        abandonRun('o servidor não conhece mais este run (foi reiniciado?)');
        return null;
      }
      fails++;
      showBanner('warn', `Conexão com o servidor instável (${e.message}). Tentando de novo…`, { key: 'conn', dismiss: false });
      if (fails >= MAX_POLL_FAILS) {
        abandonRun('o servidor parou de responder');
        return null;
      }
    }
    await sleep(POLL_MS);
  }
  return null;
}

function abandonRun(reason) {
  state.starting = false;
  state.cancelling = false;
  if (state.run && state.run.status === 'running') {
    state.run = { ...state.run, status: 'failed', phase: 'done', error: `acompanhamento interrompido: ${reason}` };
    state.renderSig = '';
    state.traceSig = '';
    renderRun();
  }
  showBanner('error', `Acompanhamento interrompido: ${reason}. A tela foi liberada; o run pode ainda estar em andamento no servidor.`, {
    key: 'conn',
    actions: [{ label: 'Tentar reconectar', onClick: attachRunning }],
  });
  renderConfigState();
}

function applyRun(run) {
  state.run = run;
  if (run.phase === 'benchmark' && (!state.benchStart || state.benchStart.runId !== run.runId)) {
    state.benchStart = { runId: run.runId, t: Date.now(), completed: progressCompleted(run) };
  }
  renderRun();
  if (sweepActive()) renderSweepSteps();
  renderConfigState();
}

function progressCompleted(run) {
  return run.progress && isNum(run.progress.completed) ? run.progress.completed : 0;
}

/* ----------------------------------------------------------- run: barra */

function stoppedStep(run) {
  const variants = Array.isArray(run.variants) ? run.variants : [];
  if (variants.some((v) => isNum(v.completed) && v.completed > 0)) return 2;
  if (variants.length && variants.every((v) => v.cold)) return 1;
  return 0;
}

function renderLiveBar() {
  const run = state.run;
  const bar = $('#livebar');
  if (!run) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const scn = scenarioOf(run.scenarioId);
  $('#lb-scn').textContent = scn ? scn.title : run.scenarioId;
  const st = $('#lb-status');
  st.textContent = STATUS_TEXT[run.status] || run.status || '—';
  st.className = `chip-status ${esc(run.status)}`;
  const b = state.batch;
  const sw = state.sweep;
  $('#lb-batch').textContent = sweepActive()
    ? `Varredura de rede: etapa ${F.int(sw.index + 1)} de ${F.int(sw.steps.length)} · ${F.int(sw.steps[sw.index].latency)} ms`
    : (b && b.active ? `Executar todos: cenário ${F.int(b.index + 1)} de ${F.int(b.ids.length)}` : (state.viewingHistory ? 'run do histórico' : ''));

  const phaseIdx = Math.max(0, PHASES.indexOf(run.phase));
  const failed = run.status === 'failed' || run.status === 'cancelled';
  const doneLabel = $('#st-done-label');
  doneLabel.textContent = run.status === 'failed' ? 'Falhou' : run.status === 'cancelled' ? 'Cancelado' : 'Concluído';
  const stoppedAt = failed ? stoppedStep(run) : -1;
  document.querySelectorAll('#stepper li').forEach((li, i) => {
    li.className = '';
    li.removeAttribute('aria-current');
    if (run.status === 'completed') {
      li.classList.add('done');
    } else if (failed) {
      if (i === 3 || i === stoppedAt) li.classList.add('bad');
      else if (i < stoppedAt) li.classList.add('done');
    } else if (i < phaseIdx || phaseIdx === 3) {
      li.classList.add('done');
    } else if (i === phaseIdx) {
      li.classList.add('active');
      li.setAttribute('aria-current', 'step');
    }
  });

  const prog = run.progress || {};
  const total = isNum(prog.total) ? prog.total : 0;
  const completed = isNum(prog.completed) ? prog.completed : 0;
  const progressEl = $('#lb-progress');
  const fill = $('#lb-fill');
  let pct = null;
  if (run.status === 'completed') pct = 100;
  else if (run.phase === 'benchmark' && total > 0) pct = Math.min(100, (completed / total) * 100);
  else if (failed && total > 0) pct = Math.min(100, (completed / total) * 100);

  progressEl.classList.toggle('indeterminate', pct === null && run.status === 'running');
  progressEl.classList.toggle('is-bad', failed);
  fill.style.width = pct === null ? '' : `${pct.toFixed(1)}%`;
  if (pct === null) progressEl.removeAttribute('aria-valuenow');
  else progressEl.setAttribute('aria-valuenow', String(Math.round(pct)));

  $('#lb-pct').textContent = pct === null ? (run.phase === 'cold' ? 'cold run' : 'aquecendo') : `${F.num(pct, 0, 0)}%`;
  let ops = '';
  if (run.phase === 'benchmark' || run.status !== 'running') ops = total > 0 ? `${F.int(completed)} de ${F.int(total)} operações` : '';
  else if (run.phase === 'cold') ops = 'medindo a 1ª operação';
  else ops = 'operações descartadas';
  $('#lb-ops').textContent = ops;

  let time = '';
  if (run.status === 'running') {
    const startedMs = run.startedAt ? Date.parse(run.startedAt) : NaN;
    const elapsed = Number.isNaN(startedMs) ? null : Math.max(0, Date.now() - startedMs);
    time = elapsed === null ? '' : `${F.duration(elapsed)} decorridos`;
    if (run.phase === 'benchmark' && total > completed && state.benchStart && state.benchStart.runId === run.runId) {
      const spent = Date.now() - state.benchStart.t;
      const done = completed - (state.benchStart.completed || 0);
      if (spent > 400 && done > 0) time += ` · ~${F.duration((spent / done) * (total - completed))} restantes`;
    }
  } else if (isNum(run.durationMs)) {
    time = `duração ${F.duration(run.durationMs)}`;
  }
  $('#lb-time').textContent = time;
}

/* ----------------------------------------------------------- run: dados */

const sortedMedian = (a) => {
  const n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
};

const NOISE_STATS = {
  median: sortedMedian,
  mean: (a) => a.reduce((x, y) => x + y, 0) / a.length,
  p95: (a) => F.percentile(a, 0.95),
  p99: (a) => F.percentile(a, 0.99),
};

// Erro padrão relativo da estatística calculada em até 10 trechos consecutivos do run: mede a dispersão
// real (aquecimento, ruído da máquina), não só o erro de amostragem. Sem amostras suficientes, não há estimativa.
function chunkNoise(samples, statFn) {
  const xs = Array.isArray(samples) ? samples.filter(isNum) : [];
  const k = Math.min(10, Math.floor(xs.length / 8));
  if (k < 4) return null;
  const parts = [];
  for (let i = 0; i < k; i++) {
    const part = xs.slice(Math.floor((i * xs.length) / k), Math.floor(((i + 1) * xs.length) / k)).sort((a, b) => a - b);
    parts.push(statFn(part));
  }
  const mean = parts.reduce((a, b) => a + b, 0) / k;
  if (!(mean > 0)) return null;
  const variance = parts.reduce((a, b) => a + (b - mean) ** 2, 0) / (k - 1);
  return Math.sqrt(variance / k) / mean;
}

function buildItems(run) {
  const variants = Array.isArray(run.variants) ? run.variants : [];
  const styles = buildStyles(variants);
  return variants.map((v) => {
    const noise = {};
    for (const [key, fn] of Object.entries(NOISE_STATS)) noise[key] = chunkNoise(v.samples, fn);
    return { id: v.id, label: v.label || v.id, v, st: styles[v.id], noise };
  });
}

function configText(c) {
  if (!c) return '';
  return `${F.int(c.iterations)} iterações · warm-up ${F.int(c.warmup)} · concorrência ${F.int(c.concurrency)}${c.restParallel ? ' · REST em paralelo' : ''}`;
}

const netText = (c) => `rede: ${N.netLabel(c)}`;

function renderRun() {
  const run = state.run;
  $('#results').hidden = !run;
  if (!run) return;
  renderLiveBar();

  const variants = Array.isArray(run.variants) ? run.variants : [];
  const sig = [run.runId, run.status, run.phase, run.progress && run.progress.completed, variants.map((v) => v.completed).join(',')].join('|');
  if (sig === state.renderSig) return;
  state.renderSig = sig;

  const items = buildItems(run);
  const scn = scenarioOf(run.scenarioId);
  $('#run-sub').textContent = `${scn ? scn.title : run.scenarioId} · ${configText(run.config)} · ${netText(run.config)} · ${run.startedAt ? F.clock(run.startedAt) : ''}${state.viewingHistory ? ' · run do histórico' : ''}`;
  renderRunAlert(run, items);
  $('#cards').innerHTML = items.length
    ? items.map((it) => cardHtml(it, run)).join('')
    : '<p class="muted">Preparando variantes…</p>';
  renderCompare(items, run);
  renderCharts(items, run);
  renderTrace(run, items);
  renderReading(run, items);
}

function renderRunAlert(run, items) {
  const parts = [];
  if (run.status === 'failed') {
    parts.push(`<div class="banner error" role="alert"><span class="b-msg">O run falhou${run.error ? `: ${esc(run.error)}` : ''}. Os números abaixo são parciais.</span></div>`);
  } else if (run.status === 'cancelled') {
    parts.push('<div class="banner warn" role="status"><span class="b-msg">Run cancelado. Os números abaixo são parciais e não devem ser comparados com um run completo.</span></div>');
  }
  const withErrors = items.filter((it) => isNum(it.v.errors) && it.v.errors > 0);
  if (withErrors.length) {
    parts.push(`<div class="banner warn" role="status"><span class="b-msg">${withErrors.map((it) => `${esc(it.label)}: ${F.int(it.v.errors)} operação(ões) com erro (${F.pct(it.v.errorRate)})`).join(' · ')}. Compare com cautela.</span></div>`);
  }
  $('#run-alert').className = 'run-alert';
  $('#run-alert').innerHTML = parts.join('');
}

/* ------------------------------------------------------------- cartões */

function netCardHtml(it, run) {
  const v = it.v;
  const sim = N.simOf(v);
  const cfgOn = N.netParams(run.config).on;
  if (!cfgOn && !(sim !== null && sim > 0)) return '';
  const row = (key, label, value) => `<div class="mrow"><dt>${tipLabel(key, label)}</dt><dd>${value}</dd></div>`;
  const med = v.latency && isNum(v.latency.median) ? v.latency.median : null;
  const add = N.additive(run.config);
  let body;
  if (sim === null) {
    body = `${row('simSum', 'Rede simulada (soma injetada)', F.DASH)}<p class="note-small">O servidor não informou a rede injetada deste run.</p>`;
  } else if (add && med === null) {
    body = `<dl>${row('simSum', 'Rede simulada (soma injetada)', F.ms(sim))}</dl><p class="note-small">O tempo real medido aparece depois das primeiras amostras.</p>`;
  } else if (add) {
    const real = Math.max(0, med - sim);
    const realW = med > 0 ? Math.min(100, (real / med) * 100) : 0;
    body = `<div class="netbar" role="img" aria-label="${esc(F.ms(real))} de tempo real medido e ${esc(F.ms(sim))} de rede simulada"><i class="real" style="width:${realW.toFixed(1)}%"></i><i class="sim" style="width:${(100 - realW).toFixed(1)}%"></i></div>
      <div class="netbar-key"><span><i class="k-real"></i>real</span><span><i class="k-sim"></i>rede simulada</span></div>
      <dl>${row('real', 'Tempo real medido', F.ms(real))}${row('simSum', 'Rede simulada (soma injetada)', F.ms(sim))}</dl>
      <p class="note-small">Tempo real = mediana − soma injetada (requisições em sequência).</p>`;
  } else {
    body = `<dl>${row('simSum', 'Rede simulada (soma injetada)', F.ms(sim))}</dl>
      <p class="note-small warnish">Soma dos atrasos de cada requisição. Com requisições em paralelo ou concorrência maior que 1 os atrasos se sobrepõem: o acréscimo real na latência é menor que esta soma, por isso ela não é subtraída da mediana.</p>`;
  }
  return `<section class="mgroup netgroup"><h4>Rede simulada <span class="sim-badge">simulação</span></h4>${body}</section>`;
}

function cardHtml(it, run) {
  const v = it.v;
  const lat = v.latency;
  const med = F.msParts(lat && lat.median);
  const row = (label, value, cls = '', key = '') => `<div class="mrow"><dt>${key ? tipLabel(key, label) : label}</dt><dd class="${cls}">${value}</dd></div>`;
  const f = v.fields;
  let fieldsHtml;
  if (f && isNum(f.received)) {
    const recv = f.received || 0;
    const usedW = recv ? Math.min(100, ((f.used || 0) / recv) * 100) : 0;
    const unW = recv ? Math.min(100 - usedW, ((f.unused || 0) / recv) * 100) : 0;
    fieldsHtml = `${row('Recebidos', F.int(f.received), '', 'fields')}${row('Usados pela tela', F.int(f.used), '', 'fields')}${row('Não usados', F.int(f.unused), '', 'fields')}
      <div class="fieldbar" role="img" aria-label="${F.int(f.used)} campos usados e ${F.int(f.unused)} não usados de ${F.int(f.received)}"><i style="width:${usedW.toFixed(1)}%"></i><i class="un" style="width:${unW.toFixed(1)}%"></i></div>
      <p class="note-small">Folhas JSON na operação de amostra. Listrado = não usado.</p>`;
  } else {
    fieldsHtml = row('Recebidos', F.DASH, '', 'fields') + '<p class="note-small">Disponível após o cold run.</p>';
  }
  const cold = v.cold && isNum(v.cold.latencyMs) ? `${F.ms(v.cold.latencyMs)}${v.cold.firstSinceStartup ? ' <small>1ª desde o start</small>' : ''}` : F.DASH;
  const waiting = !lat ? `<span class="ro-sub">${run.status === 'running' ? 'aguardando as primeiras amostras…' : 'sem amostras de latência'}</span>` : `<span class="ro-sub">${F.int(v.completed)} operações medidas</span>`;
  const err = isNum(v.errors) && v.errors > 0;
  return `<article class="vcard" style="--vc:${it.st.color}">
    <div class="vc-top"><span class="kindtag kind-${esc(v.kind)}">${kindName(v.kind)}</span>${C.swatch(it.st)}</div>
    <h3>${esc(it.label)}</h3>
    <div class="readout"><span class="ro-label">${tipLabel('median', 'Latência mediana')}</span><span class="ro-value">${esc(med.value)}${med.unit ? `<small>${esc(med.unit)}</small>` : ''}</span>${waiting}</div>
    <section class="mgroup"><h4>Latência</h4><dl>
      ${row('Média', F.ms(lat && lat.mean), '', 'mean')}
      ${row('P95', F.ms(lat && lat.p95), '', 'p95')}
      ${row('P99', F.ms(lat && lat.p99), '', 'p99')}
      ${row('Desvio-padrão', F.ms(lat && lat.stdDev), '', 'stddev')}
      ${row('Cold run', cold, '', 'cold')}
      ${row('Operações/s', F.perSecond(v.throughput && v.throughput.opsPerSecond), '', 'throughput')}
    </dl></section>
    ${netCardHtml(it, run)}
    <section class="mgroup"><h4>Por operação</h4><dl>
      ${row('Requisições HTTP', F.count(v.requestsPerOperation), '', 'requests')}
      ${row('Bytes recebidos', F.bytes(v.bytesReceivedPerOperation), '', 'bytesRecv')}
      ${row('Bytes enviados', F.bytes(v.bytesSentPerOperation), '', 'bytesSent')}
      ${row('Consultas SQL', v.sqlQueriesPerOperation === null || v.sqlQueriesPerOperation === undefined ? `<small>${run.status === 'running' ? 'medindo…' : 'indisponível'}</small>` : F.count(v.sqlQueriesPerOperation), '', 'sql')}
    </dl></section>
    <section class="mgroup"><h4>Campos JSON</h4><dl>${fieldsHtml}</dl></section>
    <section class="mgroup"><h4>Erros e recursos</h4><dl>
      ${row('Taxa de erro', `${F.pct(v.errorRate)}${err ? ` <small>(${F.int(v.errors)})</small>` : ''}`, err ? 'bad' : '', 'errors')}
      ${row('CPU / operação', F.ms(v.cpuMsPerOperation), '', 'resources')}
      ${row('Memória alocada / op.', F.bytes(v.allocatedBytesPerOperation), '', 'resources')}
    </dl><p class="note-small">CPU e memória: processo inteiro (cliente + servidor).</p></section>
  </article>`;
}

/* ----------------------------------------------------------- comparativo */

const ROWS = [
  { g: 'Latência' },
  { label: 'Mediana', tip: 'median', get: (v) => v.latency && v.latency.median, fmt: F.ms, better: 'low', noise: 'median' },
  { label: 'Média', tip: 'mean', get: (v) => v.latency && v.latency.mean, fmt: F.ms, better: 'low', noise: 'mean' },
  { label: 'P95', tip: 'p95', get: (v) => v.latency && v.latency.p95, fmt: F.ms, better: 'low', noise: 'p95' },
  { label: 'P99', tip: 'p99', get: (v) => v.latency && v.latency.p99, fmt: F.ms, better: 'low', noise: 'p99' },
  { label: 'Desvio-padrão', tip: 'stddev', get: (v) => v.latency && v.latency.stdDev, fmt: F.ms, better: 'low' },
  { label: 'Cold run (1 amostra)', tip: 'cold', get: (v) => v.cold && v.cold.latencyMs, fmt: F.ms, better: null },
  { label: 'Operações/s', tip: 'throughput', get: (v) => v.throughput && v.throughput.opsPerSecond, fmt: F.perSecond, better: 'high', noise: 'mean' },
  { g: 'Tráfego por operação' },
  { label: 'Requisições HTTP', tip: 'requests', get: (v) => v.requestsPerOperation, fmt: F.count, better: 'low' },
  { label: 'Bytes recebidos', tip: 'bytesRecv', get: (v) => v.bytesReceivedPerOperation, fmt: F.bytes, better: 'low' },
  { label: 'Bytes enviados', tip: 'bytesSent', get: (v) => v.bytesSentPerOperation, fmt: F.bytes, better: 'low' },
  { label: 'Consultas SQL', tip: 'sql', get: (v) => v.sqlQueriesPerOperation, fmt: F.count, better: 'low' },
  { g: 'Campos JSON (operação de amostra)' },
  { label: 'Campos recebidos', tip: 'fields', get: (v) => v.fields && v.fields.received, fmt: F.int, better: 'low' },
  { label: 'Campos usados', tip: 'fields', get: (v) => v.fields && v.fields.used, fmt: F.int, better: null },
  { label: 'Campos não usados', tip: 'fields', get: (v) => v.fields && v.fields.unused, fmt: F.int, better: 'low' },
  { g: 'Qualidade e recursos' },
  { label: 'Taxa de erro', tip: 'errors', get: (v) => v.errorRate, fmt: (x) => F.pct(x), better: 'low' },
  { label: 'CPU por operação (processo inteiro)', tip: 'resources', get: (v) => v.cpuMsPerOperation, fmt: F.ms, better: 'low' },
  { label: 'Memória alocada por operação (processo inteiro)', tip: 'resources', get: (v) => v.allocatedBytesPerOperation, fmt: F.bytes, better: 'low' },
];

function rowsFor(run) {
  const netOn = N.netParams(run.config).on || (Array.isArray(run.variants) && run.variants.some((v) => (N.simOf(v) || 0) > 0));
  if (!netOn) return ROWS;
  const add = N.additive(run.config);
  const netRows = [
    { g: 'Rede simulada (simulação injetada no cliente)' },
    { label: 'Rede injetada (soma por operação)', tip: 'simSum', get: (v) => N.simOf(v), fmt: F.ms, better: 'low' },
  ];
  if (add) {
    netRows.push({ label: 'Tempo real medido (mediana − rede)', tip: 'real', get: (v) => (v.latency && isNum(v.latency.median) && N.simOf(v) !== null ? Math.max(0, v.latency.median - N.simOf(v)) : null), fmt: F.ms, better: 'low' });
  }
  return [...ROWS.slice(0, 8), ...netRows, ...ROWS.slice(8)];
}

const pairTolerance = (a, b) => Math.max(TIE, NOISE_Z * Math.hypot(a || 0, b || 0));

function rankValues(vals, better, noises = []) {
  const out = { best: new Set(), tie: false, equal: false, ratios: [], tolerance: TIE };
  if (!better) return out;
  const idx = vals.map((v, i) => (isNum(v) ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 2) return out;
  const nums = idx.map((i) => vals[i]);
  const bestV = better === 'low' ? Math.min(...nums) : Math.max(...nums);
  const bestI = idx.find((i) => vals[i] === bestV);
  const tol = (i) => pairTolerance(noises[i], noises[bestI]);
  const near = (i) => (better === 'low' ? vals[i] <= bestV * (1 + tol(i)) : vals[i] >= bestV * (1 - tol(i)));
  const allNear = idx.every(near);
  out.equal = nums.every((v) => v === nums[0]);
  out.tie = allNear;
  out.tolerance = Math.max(...idx.filter((i) => i !== bestI).map(tol));
  if (!allNear) idx.filter(near).forEach((i) => out.best.add(i));
  idx.forEach((i) => {
    const v = vals[i];
    out.ratios[i] = bestV > 0 && v > 0 ? (better === 'low' ? v / bestV : bestV / v) : null;
  });
  return out;
}

function renderCompare(items, run) {
  const box = $('#cmp');
  if (!items.length) {
    box.innerHTML = '<p class="muted">Sem variantes para comparar.</p>';
    return;
  }
  const head = items.map((it) => `<th scope="col" style="--vc:${it.st.color}"><span class="th-v">${C.swatch(it.st)}<span class="lbl">${esc(it.label)}</span><span class="kindtag kind-${esc(it.v.kind)}">${kindName(it.v.kind)}</span></span></th>`).join('');
  const body = rowsFor(run).map((r) => {
    if (r.g) return `<tr class="group"><th scope="colgroup" colspan="${items.length + 1}">${esc(r.g)}</th></tr>`;
    const vals = items.map((it) => {
      const x = r.get(it.v);
      return isNum(x) ? x : null;
    });
    const noises = items.map((it) => (r.noise ? it.noise[r.noise] : null));
    const rk = rankValues(vals, r.better, noises);
    const tag = rk.equal ? '<span class="row-tag">igual</span>' : rk.tie ? `<span class="row-tag" title="Diferença dentro de ±${esc(F.pct(rk.tolerance, 0))}">empate técnico</span>` : '';
    const cells = items.map((it, i) => {
      const v = vals[i];
      if (v === null) return '<td class="num">—</td>';
      if (rk.best.has(i)) return `<td class="num best">${esc(r.fmt(v))}<span class="tag">melhor</span></td>`;
      const ratio = rk.ratios[i];
      const showRatio = isNum(ratio) && !rk.tie;
      return `<td class="num">${esc(r.fmt(v))}${showRatio ? `<span class="ratio">${F.ratio(ratio)}</span>` : ''}</td>`;
    }).join('');
    return `<tr class="${rk.tie ? 'tied' : ''}"><th scope="row">${r.tip ? tipLabel(r.tip, esc(r.label)) : esc(r.label)}${tag}</th>${cells}</tr>`;
  }).join('');
  const partial = run.status === 'running' ? '<caption class="muted" style="text-align:left;padding-bottom:.4rem">Valores parciais: atualizam enquanto o benchmark roda.</caption>' : '';
  const netNote = (N.netParams(run.config).on && !N.additive(run.config))
    ? '<p class="chart-note">Rede injetada é a <b>soma</b> dos atrasos de cada requisição. Com requisições em paralelo ou concorrência maior que 1 os atrasos se sobrepõem e a soma supera o acréscimo real na latência; por isso não há linha de “tempo real” nem subtração da mediana neste run.</p>'
    : '';
  box.innerHTML = `<table class="cmp">${partial}<thead><tr><th scope="col">Métrica</th>${head}</tr></thead><tbody>${body}</tbody></table>${netNote}`;
}

/* -------------------------------------------------------------- gráficos */

function renderCharts(items, run) {
  $('#chart-legend').innerHTML = items.length ? C.legend(items) : '';
  $('#ch-line').innerHTML = C.lineChart(items, { id: 'line-iter', mode: state.lineMode });
  $('#ch-hist').innerHTML = C.histogram(items, { id: 'hist', mode: state.histMode });
  $('#ch-bars').innerHTML = C.groupedBars(items, [
    { key: 'median', label: 'Mediana' },
    { key: 'p95', label: 'P95' },
    { key: 'p99', label: 'P99' },
  ], { id: 'bars' });

  const rows = (get, fmt) => items.map((it) => {
    const x = get(it.v);
    return { label: it.label, st: it.st, value: isNum(x) ? x : null, text: isNum(x) ? fmt(x) : '—' };
  });
  const mini = (html) => `<div class="mini">${html}</div>`;
  $('#ch-payload').innerHTML = [
    mini(C.hbars(rows((v) => v.bytesReceivedPerOperation, F.bytes), { title: 'Bytes recebidos por operação', tip: TIPS.bytesRecv })),
    mini(C.hbars(rows((v) => v.bytesSentPerOperation, F.bytes), { title: 'Bytes enviados por operação', tip: TIPS.bytesSent })),
  ].join('');
  $('#ch-counts').innerHTML = [
    mini(C.hbars(rows((v) => v.requestsPerOperation, F.count), { title: 'Requisições HTTP por operação', tip: TIPS.requests })),
    mini(C.hbars(rows((v) => v.sqlQueriesPerOperation, F.count), { title: 'Consultas SQL por operação', tip: TIPS.sql, emptyText: run && run.status === 'running' ? 'Medindo… a contagem aparece quando o primeiro bloco da variante fechar.' : 'Contagem de SQL indisponível neste servidor.' })),
  ].join('');
}

/* ----------------------------------------------------------------- trace */

function layoutTrace(trace, parallel) {
  const rows = [];
  let seqEnd = 0;
  let total = 0;
  trace.forEach((r, i) => {
    const d = isNum(r.durationMs) ? r.durationMs : 0;
    const sim = isNum(r.simulatedDelayMs) && r.simulatedDelayMs > 0 ? r.simulatedDelayMs : 0;
    let start;
    if (parallel && i >= 2) {
      start = seqEnd;
    } else {
      start = seqEnd;
      seqEnd = start + d + sim;
    }
    total = Math.max(total, start + d + sim);
    rows.push({ r, start, d, sim });
  });
  return { rows, total };
}

function requestFormula(it, run, n) {
  if (!n) return F.DASH;
  const isRestChain = run.scenarioId === 'nested' && it.v.kind === 'rest' && n > 2;
  return isRestChain ? `1 + 1 + ${F.int(n - 2)} = ${F.int(n)}` : `${F.int(n)}`;
}

function renderTrace(run, items) {
  const sig = [run.runId, run.config && run.config.restParallel, items.map((it) => `${it.id}:${(it.v.trace || []).length}:${(it.v.sampleResponse || '').length}`).join('|')].join('#');
  if (sig === state.traceSig) return;
  state.traceSig = sig;

  const banner = $('#reqbanner');
  const list = $('#trace');
  const key = $('#trace-key');
  if (!items.length || items.every((it) => !(it.v.trace || []).length)) {
    banner.innerHTML = '';
    key.innerHTML = '';
    list.innerHTML = '<p class="muted">O trace aparece assim que o cold run termina.</p>';
    return;
  }

  const anySim = items.some((it) => N.traceSimSum(it.v.trace) > 0);
  const parallelRun = !!(run.config && run.config.restParallel) && run.scenarioId === 'nested';
  key.innerHTML = anySim
    ? '<span><i class="k-real"></i>tempo real medido da requisição</span><span><i class="k-sim"></i>rede simulada (atraso injetado depois da resposta)</span>'
    : '';

  banner.innerHTML = items.map((it) => {
    const trace = it.v.trace || [];
    const n = trace.length || (isNum(it.v.requestsPerOperation) ? Math.round(it.v.requestsPerOperation) : 0);
    const chips = Array.from({ length: Math.min(n, 60) }, () => '<i></i>').join('');
    const simSum = N.traceSimSum(trace);
    const par = parallelRun && it.id === 'rest';
    const net = simSum > 0
      ? `<div class="rt-net" title="Soma dos atrasos simulados das requisições do trace${par ? '. Em paralelo os atrasos se sobrepõem, então o tempo na linha do tempo é menor que a soma' : ''}">rede paga ${F.int(n)}× · ${esc(F.ms(simSum))} ${par ? 'somados' : 'simulados'}</div>`
      : '';
    return `<div class="reqtile" style="--vc:${it.st.color}">
      <h4>${esc(it.label)}</h4>
      <div class="rt-n">${n ? F.int(n) : '—'}<small>${n === 1 ? 'requisição' : 'requisições'}</small></div>
      <div class="rt-f">${n ? `${esc(requestFormula(it, run, n))}` : ''}</div>
      ${net}
      <div class="chipstrip" aria-hidden="true">${chips}</div>
    </div>`;
  }).join('');

  const laid = items.map((it) => {
    const parallel = parallelRun && it.id === 'rest';
    return layoutTrace(it.v.trace || [], parallel);
  });
  const scale = Math.max(...laid.map((l) => l.total), 1e-9);
  const CAP = 40;

  list.innerHTML = items.map((it, idx) => {
    const trace = it.v.trace || [];
    const lay = laid[idx];
    const sumBytes = trace.reduce((a, r) => a + (isNum(r.bytesReceived) ? r.bytesReceived : 0), 0);
    const simSum = N.traceSimSum(trace);
    const rows = lay.rows.slice(0, CAP).map(({ r, start, d, sim }) => {
      const ok = isNum(r.status) && r.status >= 200 && r.status < 300;
      const tip = `${r.method || ''} ${r.url || ''}\nstatus ${r.status ?? '—'} · tempo real ${F.ms(r.durationMs)}${sim > 0 ? `\nrede simulada: +${F.ms(sim)}` : ''}\n↓ ${F.bytes(r.bytesReceived)} · ↑ ${F.bytes(r.bytesSent)}`;
      const left = (start / scale) * 100;
      const width = (d / scale) * 100;
      const simLeft = ((start + d) / scale) * 100;
      const simWidth = (sim / scale) * 100;
      return `<div class="wf-row" data-tip="${esc(tip)}">
        <span class="meth">${esc(r.method || '—')}</span>
        <span class="url" title="${esc(r.url || '')}">${esc(r.url || '—')}</span>
        <span class="stt ${ok ? 'ok' : 'ko'}">${esc(r.status ?? '—')}</span>
        <span class="tl"><b class="real" style="left:${left.toFixed(2)}%;width:${Math.max(0.6, width).toFixed(2)}%"></b>${sim > 0 ? `<b class="sim" style="left:${simLeft.toFixed(2)}%;width:${Math.max(0.6, simWidth).toFixed(2)}%"></b>` : ''}</span>
        <span class="ms">${esc(F.ms(r.durationMs))}${sim > 0 ? `<small class="simtxt">+ ${esc(F.ms(sim))} rede</small>` : ''}</span>
        <span class="by">↓ ${esc(F.bytes(r.bytesReceived))}</span>
      </div>${r.body ? `<div class="wf-body"><pre class="code" tabindex="0">${esc(r.body)}</pre></div>` : ''}`;
    }).join('');
    const more = trace.length > CAP ? `<div class="wf-more">+ ${F.int(trace.length - CAP)} requisições a mais não exibidas</div>` : '';
    const resp = it.v.sampleResponse
      ? `<pre class="code" tabindex="0">${esc(it.v.sampleResponse)}</pre>`
      : '<p class="muted">Sem resposta de amostra ainda.</p>';
    const simSummary = simSum > 0 ? ` · rede simulada (soma) ${esc(F.ms(simSum))}` : '';
    return `<article class="tv${simSum > 0 ? ' has-sim' : ''}" style="--vc:${it.st.color}">
      <header><span class="kindtag kind-${esc(it.v.kind)}">${kindName(it.v.kind)}</span><strong>${esc(it.label)}</strong>
        <span class="tv-sum">${F.int(trace.length)} req · ${esc(F.ms(lay.total))}${simSummary} · ↓ ${esc(F.bytes(sumBytes))}</span></header>
      <div class="wf${simSum > 0 ? ' has-sim' : ''}">
        <div class="wf-row head"><span>Método</span><span>URL</span><span>HTTP</span><span>Linha do tempo</span><span>Tempo</span><span>Recebido</span></div>
        ${rows || '<p class="muted">Sem requisições registradas.</p>'}${more}
      </div>
      <div class="resp"><h4>Resposta da operação de amostra</h4>${resp}</div>
    </article>`;
  }).join('');
}

/* --------------------------------------------------------------- leitura */

function joinList(arr) {
  if (arr.length <= 1) return arr.join('');
  return `${arr.slice(0, -1).join(', ')} e ${arr[arr.length - 1]}`;
}

const val = (s) => `<span class="rv">${esc(s)}</span>`;

function compareParagraph(items, spec) {
  const entries = items.map((it) => ({ it, x: spec.get(it.v), n: spec.noise ? spec.noise(it) : null })).filter((e) => isNum(e.x));
  if (entries.length === 1 && !spec.emptyNote) {
    return `Só ${esc(entries[0].it.label)} tem dado de ${spec.noun} até aqui (${val(spec.fmt(entries[0].x))}); sem base de comparação.`;
  }
  if (entries.length < 2) {
    return spec.emptyNote || `Aguardando dados de ${spec.noun} para as variantes.`;
  }
  const best = Math.min(...entries.map((e) => e.x));
  const worst = Math.max(...entries.map((e) => e.x));
  const bestEntry = entries.find((e) => e.x === best);
  const tolOf = (e) => pairTolerance(e.n, bestEntry.n);
  const near = (e) => e.x <= best * (1 + tolOf(e));
  if (worst === best) return `Sem diferença em ${spec.noun}: todas as variantes registraram ${val(spec.fmt(best))}.`;
  if (entries.every(near)) {
    const tol = Math.max(...entries.map(tolOf));
    return `Empate técnico em ${spec.noun}: ${joinList(entries.map((e) => `${esc(e.it.label)} (${val(spec.fmt(e.x))})`))}. Diferenças abaixo de ${val(F.pct(tol, 0))} ficam dentro da variação medida neste run e não indicam um lado melhor.`;
  }
  const leaders = entries.filter(near);
  const others = entries.filter((e) => !near(e));
  const leadTxt = `Em ${spec.noun}, o menor valor foi de ${joinList(leaders.map((e) => esc(e.it.label)))} (${val(spec.fmt(leaders[0].x))}).`;
  const otherTxt = others.map((e) => `${esc(e.it.label)} ficou em ${val(spec.fmt(e.x))} (${val(F.ratio(best > 0 ? e.x / best : NaN))} o menor)`).join('; ');
  const missing = items.length - entries.length;
  return `${leadTxt} ${otherTxt}.${missing ? ` ${F.int(missing)} variante(s) sem dado.` : ''}`;
}

const plural = (n, one, many) => `${F.count(n)} ${n === 1 ? one : many}`;

function networkParagraph(run, items) {
  const n = N.netParams(run.config);
  const anySim = items.some((it) => (N.simOf(it.v) || 0) > 0);
  if (!n.on && !anySim) return '';
  const head = `Rede ${val(N.netLabel(run.config))}: atraso <strong>simulado</strong> (latência por requisição mais tempo de transferência) injetado no cliente; a latência medida o inclui e não é a de uma rede real.`;
  const withSim = items.filter((it) => N.simOf(it.v) !== null && it.v.latency && isNum(it.v.latency.median));
  if (!items.some((it) => it.v.latency && isNum(it.v.latency.median))) return `${head} Aguardando as primeiras amostras para separar o tempo real da rede.`;
  if (!withSim.length) return `${head} O servidor não informou a rede injetada (simulatedNetworkMsPerOperation) neste run.`;
  const add = N.additive(run.config);
  const parts = withSim.map((it) => {
    const sim = N.simOf(it.v);
    const med = it.v.latency.median;
    const reqs = isNum(it.v.requestsPerOperation) ? ` em ${val(plural(it.v.requestsPerOperation, 'requisição', 'requisições'))}` : '';
    return add
      ? `${esc(it.label)}: ${val(F.ms(sim))} injetados${reqs}${med > 0 ? ` (${F.pct(Math.min(1, sim / med), 0)} da mediana)` : ''}; tempo real medido ≈ ${val(F.ms(Math.max(0, med - sim)))}`
      : `${esc(it.label)}: soma injetada de ${val(F.ms(sim))}${reqs}`;
  });
  const tail = add
    ? ' Cada requisição a mais paga a rede de novo: é o que o loopback esconde.'
    : ' Com requisições em paralelo ou concorrência maior que 1 os atrasos se sobrepõem: a soma injetada supera o acréscimo real na latência e por isso não foi subtraída da mediana.';
  return `${head} ${parts.join(' · ')}.${tail}`;
}

function renderMethodNet(run) {
  const box = $('#method-net');
  if (!box) return;
  const n = run ? N.netParams(run.config) : { on: false };
  box.textContent = n.on
    ? 'Rede simulada: o atraso (latência mais tempo de transferência) é injetado no cliente do laboratório, por requisição, depois do último byte da resposta e antes de ela contar como concluída; o tráfego em si continua em loopback e o atraso não é aplicado no warm-up. O tempo real medido, a CPU e a memória com rede simulada ficam acima dos de um run em loopback puro (threads e CPU ociosos esperando entre requisições, mais a alocação do próprio simulador): compare essas métricas só entre runs com a mesma rede.'
    : 'Rede simulada desligada neste run (loopback puro); quando ligada, o atraso é injetado no cliente do laboratório, por requisição, e não vale no warm-up.';
}

function renderReading(run, items) {
  const box = $('#reading');
  if (!items.length) {
    box.innerHTML = '<p class="muted">Sem dados para interpretar ainda.</p>';
    return;
  }
  const partial = run.status === 'running' ? ' partial' : '';
  const prefix = run.status === 'running' ? '<em>Leitura parcial, atualizada enquanto o benchmark roda.</em> ' : (run.status === 'cancelled' || run.status === 'failed' ? '<em>Run incompleto: leitura baseada em dados parciais.</em> ' : '');
  const paras = [];

  let latency = compareParagraph(items, { noun: 'latência mediana', get: (v) => v.latency && v.latency.median, fmt: F.ms, noise: (it) => it.noise.median });
  const tail = items
    .filter((it) => it.v.latency && it.v.completed >= MIN_TAIL_SAMPLES && isNum(it.v.latency.p99) && isNum(it.v.latency.median) && it.v.latency.median > 0)
    .map((it) => ({ it, r: it.v.latency.p99 / it.v.latency.median }));
  if (tail.length && Math.max(...tail.map((t) => t.r)) >= 3) {
    const lo = tail.reduce((a, b) => (b.r < a.r ? b : a));
    const hi = tail.reduce((a, b) => (b.r > a.r ? b : a));
    latency += lo === hi
      ? ` Cauda: o P99 de ${esc(hi.it.label)} é ${val(F.ratio(hi.r))} a mediana; outliers que a mediana esconde.`
      : ` Cauda: o P99 fica entre ${val(F.ratio(lo.r))} e ${val(F.ratio(hi.r))} a mediana (maior em ${esc(hi.it.label)}); há outliers que a mediana esconde.`;
  }
  const colds = items
    .filter((it) => it.v.cold && isNum(it.v.cold.latencyMs) && it.v.latency && isNum(it.v.latency.median) && it.v.latency.median > 0)
    .map((it) => ({ it, c: it.v.cold.latencyMs, r: it.v.cold.latencyMs / it.v.latency.median }));
  if (colds.length && Math.max(...colds.map((c) => c.r)) >= 3) {
    const lo = colds.reduce((a, b) => (b.c < a.c ? b : a));
    const hi = colds.reduce((a, b) => (b.c > a.c ? b : a));
    latency += lo === hi
      ? ` Cold run de ${esc(hi.it.label)}: ${val(F.ms(hi.c))}, bem acima da mediana.`
      : ` Cold run: de ${val(F.ms(lo.c))} (${esc(lo.it.label)}) a ${val(F.ms(hi.c))} (${esc(hi.it.label)}), bem acima da mediana. Costuma refletir aquecimento (JIT, conexões, caches) e não o padrão de acesso.`;
  }
  if (run.status === 'completed') {
    latency += ' Diferenças modestas entre variantes podem inverter de uma execução para outra: repita o run antes de concluir.';
  }
  paras.push(['Latência', latency]);

  let payload = compareParagraph(items, { noun: 'volume de bytes recebidos por operação', get: (v) => v.bytesReceivedPerOperation, fmt: F.bytes });
  const withFields = items.filter((it) => it.v.fields && isNum(it.v.fields.received) && it.v.fields.received > 0);
  if (withFields.length) {
    const wasteful = withFields.filter((it) => it.v.fields.unused > 0);
    payload += wasteful.length
      ? ` Campos sem uso na tela: ${joinList(wasteful.map((it) => `${esc(it.label)} ${val(`${F.int(it.v.fields.unused)} de ${F.int(it.v.fields.received)}`)} (${F.pct(it.v.fields.unused / it.v.fields.received, 0)})`))}${wasteful.length < withFields.length ? '; nas demais, nenhum campo recebido ficou sem uso' : ''}.`
      : ' Nenhuma variante recebeu campos que a tela não usa.';
  }
  paras.push(['Payload', payload]);

  paras.push(['Requisições HTTP', compareParagraph(items, { noun: 'requisições HTTP por operação', get: (v) => v.requestsPerOperation, fmt: F.count })]);
  const netPara = networkParagraph(run, items);
  if (netPara) paras.push(['Rede simulada', netPara]);
  paras.push(['Consultas SQL', compareParagraph(items, {
    noun: 'consultas SQL por operação',
    get: (v) => v.sqlQueriesPerOperation,
    fmt: F.count,
    emptyNote: 'A contagem de SQL não está disponível neste servidor ou ainda não foi medida.',
  })]);

  box.innerHTML = paras.map(([title, html]) => `<p class="${partial.trim()}"><strong class="dim">${esc(title)}</strong>${prefix}${html}</p>`).join('');
  renderMethodNet(run);
}

/* -------------------------------------------------------------- histórico */

function medianSummary(r) {
  const vs = Array.isArray(r.variants) ? r.variants : [];
  return vs.map((v) => `<span class="mpill" style="--vc:var(--c-${v.kind === 'graphql' ? 'g0' : 'r0'})">${esc(v.id)} <b>${esc(F.ms(v.latency && v.latency.median))}</b></span>`).join('') || '—';
}

function renderHistory() {
  const box = $('#history');
  const list = state.history;
  if (!list.length) {
    box.innerHTML = '<p class="muted">Nenhum run nesta sessão ainda. Execute um benchmark para começar.</p>';
    return;
  }
  const currentId = state.run && state.run.runId;
  box.innerHTML = `<table><thead><tr><th scope="col">Início</th><th scope="col">Cenário</th><th scope="col">Configuração</th><th scope="col">${tipLabel('net', 'Rede')}</th><th scope="col">Status</th><th scope="col" class="num">Duração</th><th scope="col">${tipLabel('median', 'Medianas')}</th><th scope="col"><span class="sr">Ação</span></th></tr></thead><tbody>
    ${list.map((r) => {
    const scn = scenarioOf(r.scenarioId);
    return `<tr class="${r.runId === currentId ? 'current-run' : ''}">
      <td class="num">${esc(F.clock(r.startedAt))}</td>
      <th scope="row">${esc(scn ? scn.title : r.scenarioId)}</th>
      <td>${esc(configText(r.config))}</td>
      <td class="nowrap">${esc(N.netLabel(r.config))}</td>
      <td><span class="stat ${esc(r.status)}">${esc(STATUS_TEXT[r.status] || r.status)}</span></td>
      <td class="num">${esc(isNum(r.durationMs) ? F.duration(r.durationMs) : F.DASH)}</td>
      <td><div class="mpills">${medianSummary(r)}</div></td>
      <td><button type="button" class="btn btn-ghost sm" data-view="${esc(r.runId)}" ${isBusy() ? 'disabled' : ''}>Ver</button></td>
    </tr>`;
  }).join('')}</tbody></table>`;
  box.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => viewRun(b.dataset.view)));
}

async function loadHistory() {
  try {
    const list = await api.listRuns();
    state.history = Array.isArray(list) ? list : [];
    renderHistory();
  } catch (e) {
    $('#history').innerHTML = `<div class="banner error" role="alert"><span class="b-msg">Não foi possível carregar o histórico: ${esc(e.message)}</span><button type="button" class="btn sm" id="hist-retry">Tentar novamente</button></div>`;
    $('#hist-retry').addEventListener('click', loadHistory);
  }
}

async function viewRun(id) {
  if (isBusy()) return;
  try {
    const full = await api.getRun(id);
    state.viewingHistory = true;
    state.renderSig = '';
    state.traceSig = '';
    pollToken++;
    if (full.scenarioId && scenarioOf(full.scenarioId)) selectScenario(full.scenarioId);
    applyRun(full);
    renderHistory();
    $('#results').scrollIntoView({ block: 'start', behavior: 'smooth' });
  } catch (e) {
    showBanner('error', `Não foi possível abrir o run: ${e.message}`, { key: 'view' });
  }
}

/* ----------------------------------------------------------------- matriz */

function renderMatrix() {
  const sec = $('#matrix-sec');
  const b = state.batch;
  const ids = b ? Object.keys(b.results) : [];
  sec.hidden = !b;
  if (!b) return;
  $('#mx-sub').textContent = `Executar todos · ${configText(b.config)} · ${netText(b.config)}${b.active ? ' · em andamento' : ''}`;
  const rows = [];
  for (const sid of b.ids) {
    const scn = scenarioOf(sid);
    const run = b.results[sid];
    const title = esc(scn ? scn.title : sid);
    if (!run) {
      const state_ = b.active && b.ids[b.index] === sid ? 'executando…' : 'não executado';
      rows.push(`<tr><td class="scn-cell">${title}</td><td colspan="6" class="muted">${state_}</td></tr>`);
      continue;
    }
    const items = buildItems(run);
    const medians = items.map((it) => (it.v.latency && isNum(it.v.latency.median) ? it.v.latency.median : null));
    const rk = rankValues(medians, 'low', items.map((it) => it.noise.median));
    const maxMed = Math.max(...medians.filter(isNum), 1e-9);
    const statusTag = run.status !== 'completed' ? ` <span class="stat ${esc(run.status)}">${esc(STATUS_TEXT[run.status] || run.status)}</span>` : '';
    items.forEach((it, i) => {
      const v = it.v;
      const m = medians[i];
      const best = rk.best.has(i);
      rows.push(`<tr style="--vc:${it.st.color}">
        ${i === 0 ? `<td class="scn-cell" rowspan="${items.length}">${title}${statusTag}<span class="net-tag" title="Rede usada neste run">${esc(N.netLabel(run.config))}</span></td>` : ''}
        <th scope="row">${C.swatch(it.st)} ${esc(it.label)}</th>
        <td class="num ${best ? 'best' : ''}">${esc(F.ms(m))}${best ? '<span class="tag">melhor</span>' : ''}${isNum(m) ? `<span class="mini-bar" style="width:${Math.max(2, (m / maxMed) * 100).toFixed(1)}%"></span>` : ''}</td>
        <td class="num">${esc(F.ms(v.latency && v.latency.p95))}</td>
        <td class="num">${esc(F.bytes(v.bytesReceivedPerOperation))}</td>
        <td class="num">${esc(F.count(v.requestsPerOperation))}</td>
        <td class="num">${esc(v.sqlQueriesPerOperation === null || v.sqlQueriesPerOperation === undefined ? F.DASH : F.count(v.sqlQueriesPerOperation))}</td>
      </tr>`);
    });
  }
  const abort = b.aborted ? `<p class="banner warn" role="status"><span class="b-msg">${esc(b.aborted)}</span></p>` : '';
  $('#matrix').innerHTML = `${abort}<table><thead><tr><th scope="col">Cenário</th><th scope="col">Variante</th><th scope="col" class="num">${tipLabel('median', 'Mediana')}</th><th scope="col" class="num">${tipLabel('p95', 'P95')}</th><th scope="col" class="num">${tipLabel('bytesRecv', 'Bytes recebidos / op.')}</th><th scope="col" class="num">${tipLabel('requests', 'Requisições / op.')}</th><th scope="col" class="num">${tipLabel('sql', 'SQL / op.')}</th></tr></thead><tbody>${rows.join('')}</tbody></table>
    <p class="chart-note">Destaque de “melhor” só quando a diferença da mediana dentro do cenário passa de 3% e da variação medida entre trechos do próprio run. ${ids.length ? '' : 'Os resultados aparecem conforme cada cenário termina.'}</p>`;
}

/* ------------------------------------------------------- varredura de rede */

function refChartFontPx() {
  const ref = document.querySelector('#ch-line svg.chart, #ch-hist svg.chart');
  const w = ref ? ref.getBoundingClientRect().width : 0;
  const px = w > 100 ? 17 * (w / 640) : 15;
  return Math.min(26, Math.max(13, Math.round(px * 10) / 10));
}

function sweepData(sweep) {
  const done = sweep.steps.filter((st) => st.run && st.run.status === 'completed');
  const xs = done.map((st) => (st.run.config && isNum(st.run.config.simulatedLatencyMs) ? st.run.config.simulatedLatencyMs : st.latency));
  const meta = {};
  const ids = [];
  for (const st of done) {
    for (const v of Array.isArray(st.run.variants) ? st.run.variants : []) {
      if (!meta[v.id]) {
        meta[v.id] = v;
        ids.push(v.id);
      }
    }
  }
  const styles = buildStyles(ids.map((id) => meta[id]));
  const pick = (st, id) => (st.run.variants || []).find((v) => v.id === id);
  const series = ids.map((id) => ({
    id,
    label: meta[id].label || id,
    kind: meta[id].kind,
    st: styles[id],
    ys: done.map((st) => {
      const v = pick(st, id);
      return v && v.latency && isNum(v.latency.median) ? v.latency.median : null;
    }),
    sims: done.map((st) => N.simOf(pick(st, id))),
    reqs: done.map((st) => {
      const v = pick(st, id);
      return v && isNum(v.requestsPerOperation) ? v.requestsPerOperation : null;
    }),
    errors: done.reduce((a, st) => a + ((pick(st, id) || {}).errors || 0), 0),
  }));
  return { done, xs, series };
}

function renderSweepSteps() {
  const sw = state.sweep;
  const box = $('#sweep-steps');
  if (!sw) {
    box.innerHTML = '';
    return;
  }
  const TEXT = { pending: 'aguardando', running: 'em execução', completed: 'concluída', cancelled: 'cancelada', failed: 'falhou' };
  box.innerHTML = sw.steps.map((st, i) => {
    let status = st.status;
    let text = TEXT[status] || status;
    let pct = status === 'completed' ? 100 : 0;
    const cur = state.run && st.runId && state.run.runId === st.runId ? state.run : null;
    if (status === 'running' && cur) {
      const prog = cur.progress || {};
      if (cur.phase === 'benchmark' && isNum(prog.total) && prog.total > 0) {
        pct = Math.min(100, ((prog.completed || 0) / prog.total) * 100);
        text = `benchmark ${F.num(pct, 0, 0)}%`;
      } else {
        text = cur.phase === 'cold' ? 'cold run' : cur.phase === 'warmup' ? 'aquecendo' : text;
      }
    } else if (status === 'completed' && st.run && isNum(st.run.durationMs)) {
      text = `concluída · ${F.duration(st.run.durationMs)}`;
    }
    return `<li class="${esc(status)}"${status === 'running' ? ' aria-current="step"' : ''}><span class="st-t">${esc(F.int(st.latency))} ms</span><span class="st-s">etapa ${F.int(i + 1)} · ${esc(text)}</span><span class="st-bar"><i style="width:${pct.toFixed(1)}%"></i></span></li>`;
  }).join('');
}

function sweepTableHtml(d, an) {
  const { xs, series } = d;
  if (!xs.length || !series.length) return '';
  const cols = xs.map((x, i) => {
    const rk = rankValues(series.map((s) => s.ys[i]), 'low', []);
    return rk;
  });
  const head = xs.map((x) => `<th scope="col" class="num">${esc(N.fmtX(x))} ms</th>`).join('');
  const body = series.map((s, si) => {
    const cells = xs.map((x, i) => {
      const y = s.ys[i];
      if (!isNum(y)) return '<td class="num">—</td>';
      const sim = s.sims[i];
      const simLine = isNum(sim) && sim > 0 ? `<span class="ratio">rede ${esc(F.ms(sim))}</span>` : '';
      const best = cols[i].best.has(si);
      return `<td class="num${best ? ' best' : ''}">${esc(F.ms(y))}${best ? '<span class="tag">melhor</span>' : ''}${simLine}</td>`;
    }).join('');
    const k = an.slopes[si];
    const lastReq = [...s.reqs].reverse().find(isNum);
    return `<tr style="--vc:${s.st.color}"><th scope="row">${C.swatch(s.st)} ${esc(s.label)}</th>${cells}<td class="num">${isNum(k) ? esc(`+${F.ms(k * 10)}`) : F.DASH}</td><td class="num">${esc(F.count(lastReq))}</td></tr>`;
  }).join('');
  return `<table class="sweep-table"><caption class="muted" style="text-align:left;padding-bottom:.4rem">Mediana da latência por etapa (inclui a rede simulada). “Rede” = soma injetada por operação. “Melhor” só quando a diferença passa de ${esc(F.pct(N.TIE, 0))}.</caption><thead><tr><th scope="col">Variante</th>${head}<th scope="col" class="num"><span class="mt" title="Quanto a mediana sobe a cada +10 ms de latência de rede (regressão linear das medianas medidas).">Inclinação / +10 ms</span></th><th scope="col" class="num">${tipLabel('requests', 'Req. / op.')}</th></tr></thead><tbody>${body}</tbody></table>`;
}

function renderSweep() {
  const sw = state.sweep;
  const sec = $('#sweep-sec');
  sec.hidden = !sw;
  if (!sw) return;
  const scn = scenarioOf(sw.scenarioId);
  const bwText = sw.bandwidth === null ? 'banda sem limite' : `banda ${F.num(sw.bandwidth, 0, 2)} Mbps`;
  $('#sweep-sub').textContent = `${scn ? scn.title : sw.scenarioId} · ${N.SWEEP_LATENCIES.join(', ')} ms por requisição · ${bwText} · ${F.int(sw.config.iterations)} iterações e warm-up ${F.int(sw.config.warmup)} por etapa · concorrência ${F.int(sw.config.concurrency)}${sw.config.restParallel ? ' · REST em paralelo' : ''}`;
  renderSweepSteps();

  const d = sweepData(sw);
  const an = N.sweepAnalysis(d.series, d.xs);
  const alerts = [];
  if (sw.aborted) alerts.push(`<div class="banner warn" role="status"><span class="b-msg">${esc(sw.aborted)}${d.done.length ? ' O gráfico mostra só as etapas concluídas.' : ''}</span></div>`);
  if (d.done.some((st) => !(st.run.config && isNum(st.run.config.simulatedLatencyMs)))) {
    alerts.push('<div class="banner warn" role="status"><span class="b-msg">O servidor não devolveu a rede simulada na configuração dos runs: a varredura pode não ter efeito neste servidor (tratado como rede desligada).</span></div>');
  }
  $('#sweep-alert').innerHTML = alerts.join('');

  $('#sweep-legend').innerHTML = d.series.length ? C.sweepLegend(d.series) : '';
  const model = {
    xs: d.xs,
    planned: sw.steps.map((st) => st.latency),
    series: d.series.map((s) => ({ label: s.label, st: s.st, pts: s.ys.map((y, i) => ({ y, sim: s.sims[i] })) })),
    crossings: an.supported.map((c) => ({ x: c.x, y: c.y, n: c.n, before: c.before, after: c.after })),
  };
  const width = $('#ch-sweep').clientWidth || 1000;
  $('#ch-sweep').innerHTML = C.sweepChart(model, { width, fontPx: refChartFontPx() });

  if (d.done.length) {
    const lastRun = d.done[d.done.length - 1].run;
    const requests = {};
    for (const s of d.series) requests[s.id] = [...s.reqs].reverse().find(isNum);
    const paras = N.sweepReading(d.series, d.xs, an, {
      iterations: sw.config.iterations,
      warmup: sw.config.warmup,
      reduced: sw.config.iterations < sw.config.userIterations || sw.config.warmup < sw.config.userWarmup,
      partial: d.done.length < sw.steps.length,
      active: sw.active,
      errorVariants: d.series.filter((s) => s.errors > 0).map((s) => s.label),
      requests,
      overlap: !N.additive(lastRun.config || sw.config),
    });
    const partial = sw.active ? ' partial' : '';
    $('#sweep-reading').innerHTML = paras.map(([title, html]) => `<p class="${partial.trim()}"><strong class="dim">${esc(title)}</strong>${sw.active ? '<em>Leitura parcial, atualizada a cada etapa concluída.</em> ' : ''}${html}</p>`).join('');
  } else {
    $('#sweep-reading').innerHTML = '';
  }
  $('#sweep-table').innerHTML = sweepTableHtml(d, an);
}

function renderGlossary() {
  $('#glossary-list').innerHTML = GLOSSARY.map((g) => `<div><dt>${esc(g.term)}</dt><dd>${esc(g.text)}</dd></div>`).join('');
}

/* ------------------------------------------------------------------ início */

async function resumeIfRunning() {
  try {
    const list = await api.listRuns();
    state.history = Array.isArray(list) ? list : [];
    renderHistory();
    const running = state.history.find((r) => r.status === 'running');
    if (!running) return;
    const full = await api.getRun(running.runId);
    if (full.scenarioId && scenarioOf(full.scenarioId)) selectScenario(full.scenarioId);
    applyRun(full);
    showBanner('info', 'Há um run em andamento no servidor. Acompanhando.', { key: 'resume' });
    await poll(full.runId);
    removeBanner('resume');
    await loadHistory();
    renderConfigState();
  } catch (e) {
    await loadHistory();
    if (!state.history.length) showBanner('warn', `Não foi possível verificar runs anteriores: ${e.message}`, { key: 'resume' });
  }
}

function init() {
  initTheme();
  bindConfig();
  C.initTooltips();
  renderGlossary();
  renderConfigState();
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.sweep) renderSweep(); }, 150);
  });
  loadInfo();
  loadScenarios().then(resumeIfRunning);
}

init();
