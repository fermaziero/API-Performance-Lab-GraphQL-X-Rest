export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

const DEFAULT_MESSAGES = {
  400: 'Configuração inválida.',
  404: 'Recurso não encontrado.',
  409: 'Já existe um benchmark em execução. Aguarde o término ou cancele-o.',
  500: 'Erro interno no servidor.',
};

async function request(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      cache: 'no-store',
      headers: body !== undefined
        ? { 'Content-Type': 'application/json', Accept: 'application/json' }
        : { Accept: 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Sem conexão com o servidor. Verifique se a aplicação está em execução.', 0, null);
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const detail = data && (data.error || data.detail || data.title);
    const message = detail ? String(detail) : (DEFAULT_MESSAGES[res.status] || `Erro HTTP ${res.status}.`);
    throw new ApiError(message, res.status, data);
  }
  return data;
}

export const api = {
  info: () => request('/api/info'),
  scenarios: () => request('/api/lab/scenarios'),
  listRuns: () => request('/api/lab/runs'),
  getRun: (id) => request(`/api/lab/runs/${encodeURIComponent(id)}`),
  startRun: (config) => request('/api/lab/runs', { method: 'POST', body: config }),
  cancelRun: (id) => request(`/api/lab/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
};
