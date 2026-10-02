# Adendo ao contrato — rede simulada, carga em volume e padrões por cenário

Complementa `docs/CONTRATO.md`. Ao final da implementação este conteúdo deve ser incorporado ao contrato principal e este arquivo removido.

## 1. Rede simulada

O laboratório mede em loopback, onde a rede custa zero. A rede simulada injeta, por requisição HTTP, o custo que uma rede real cobraria,
para mostrar na tela o que o loopback esconde: cada ida e volta custa tempo, e cada byte trafegado também.

### Configuração do run (`POST /api/lab/runs`) — campos novos, opcionais

| Campo | Tipo | Limites | Padrão |
|---|---|---|---|
| `simulatedLatencyMs` | inteiro | 0..1000 | 0 |
| `simulatedBandwidthMbps` | número ou `null` | 0.1..10000 | `null` (sem limite) |

Fora dos limites → `400 { "error": "..." }`. Os dois campos aparecem também em `config` nas respostas de `GET /api/lab/runs*`.

### Semântica

- Atraso injetado por requisição = `simulatedLatencyMs` + tempo de transferência, onde
  tempo de transferência (ms) = `(bytesSent + bytesReceived) × 8 ÷ (simulatedBandwidthMbps × 1.000.000) × 1000` (zero quando a banda é `null`).
- O atraso é injetado no cliente (Engine), depois do último byte da resposta e ANTES de a requisição ser considerada concluída;
  portanto entra na latência da operação. Requisições em paralelo (`restParallel`, `concurrency`) esperam em paralelo, como numa rede real.
- Fases: aplica no cold run e no benchmark. NÃO aplica no warm-up (aquecimento serve para JIT/pool; esperar rede ali só gasta tempo).
- Precisão: a espera real precisa ficar dentro de ±1 ms do alvo com concorrência 1 (o `Task.Delay` puro no Windows tem granularidade de ~15 ms
  e NÃO atende — a implementação deve medir e garantir). O valor reportado é sempre o atraso realmente injetado (medido), não o alvo.
- Com `simulatedLatencyMs = 0` e banda `null`, o caminho de medição é idêntico ao atual (nenhum custo extra).

### Resultado — campos novos

```jsonc
// em cada variante
"simulatedNetworkMsPerOperation": 350.4,   // média, por operação, da SOMA dos atrasos injetados; 0 quando a rede simulada está desligada
// em cada entrada de "trace"
"durationMs": 1.2,            // tempo real medido da requisição (sem o atraso simulado) — inalterado
"simulatedDelayMs": 50.3      // atraso injetado nesta requisição; 0 quando desligado
```

`latency`, `throughput` e `cold.latencyMs` passam a incluir o atraso simulado (é o tempo que o usuário esperaria).
Em operações com requisições paralelas a soma dos atrasos é maior que o acréscimo real de latência (os atrasos se sobrepõem) — o dashboard precisa rotular isso corretamente.

## 2. Padrões e limite por cenário

`GET /api/lab/scenarios` ganha, em cada cenário:

```jsonc
"defaults": { "iterations": 10, "warmup": 1 },   // ou null: usa a escolha geral do usuário
"maxIterations": 100                              // ou null: vale o limite global (10000)
```

`POST /api/lab/runs` com `iterations` acima do `maxIterations` do cenário → `400 { "error": "..." }`.

## 3. Cenário novo: `volume`

| id | Título | Variantes |
|---|---|---|
| `volume` | Carga em volume (100.000 produtos) — teste de estresse | `rest` — `GET /api/products?take=100000` (100 mil `ProductDto` completos) · `graphql` — `products(take: 100000) { name price sku }` · `graphql-full` — `products(take: 100000)` pedindo TODOS os campos equivalentes ao `ProductDto` (inclusive `category` e `supplier`) |

- A tela usa `name`, `price`, `sku` de cada produto (vale para as três variantes na métrica de campos).
- `defaults = { iterations: 10, warmup: 1 }`, `maxIterations = 100`. Ajustar o padrão para que um run completo leve no máximo ~45 s nesta máquina.
- Posição: depois de `overfetching-list`, antes de `nested`.
- A descrição deixa explícito que é teste de estresse: em produção os dois lados paginariam.
- `sampleResponse` de corpos grandes: NÃO identar o corpo inteiro; produzir o trecho inicial identado e truncado em 4000 chars de forma barata.
  A contagem de `fields` continua sendo feita sobre a amostra completa.
- O motor não pode reter os corpos das operações medidas (dezenas de MB cada) além do necessário.

## 4. Dados: 100.000 produtos

- Total de produtos = `Seed:Products` (configuração; padrão **100000**, mínimo 500).
- Os 500 primeiros produtos, e TODAS as demais tabelas (categorias, fornecedores, clientes, pedidos, itens), ficam byte a byte como hoje
  (mesmo fluxo de `Random(42)`): os cenários existentes não mudam.
- Os produtos 501..N são gerados por um `Random(4242)` independente, referenciando categorias/fornecedores existentes, inseridos em lotes.
- "Completar" em vez de "semear se vazio": na inicialização, se `count(products) < alvo`, insere só os que faltam (funciona num banco já existente com 500,
  em SQLite e em PostgreSQL; no PostgreSQL realinha a sequence). Nunca apaga nada. Atômico por lote; interrupção no meio retoma do ponto em que parou.
- `GET /api/info` reflete as contagens reais.
- `take` aceito de 0 a 100000 e `skip` >= 0, com a MESMA regra no REST e no GraphQL (`products`, `orders`, `recentOrders`).

## 5. Dashboard

- **Rede simulada** (na configuração): latência por requisição em chips 0 / 20 / 50 / 100 ms + valor livre; banda em seletor
  sem limite / 100 / 20 / 5 Mbps + valor livre. Linha-resumo dizendo o que será injetado. Deixar claro na tela que é rede SIMULADA.
- **Varredura de rede**: botão que executa o cenário selecionado nas latências 0, 20, 50 e 100 ms (mantendo a banda escolhida), com iterações reduzidas
  (mín(escolha do usuário, 30) e warm-up mín(escolha, 10); respeitando `maxIterations`), e desenha o gráfico "Mediana × latência de rede" com uma linha por variante,
  marcando os pontos de cruzamento (onde uma variante passa a ganhar da outra) e gerando a leitura em texto a partir dos dados.
- Cartões e comparativo: mostrar quanto da latência é rede simulada (`simulatedNetworkMsPerOperation`), com o rótulo correto para o caso paralelo.
  Waterfall: mostrar `simulatedDelayMs` por requisição, visualmente distinto do tempo real.
- Histórico e matriz-resumo exibem a rede usada em cada run.
- Padrões por cenário: ao selecionar um cenário com `defaults`, os campos de iterações/warm-up assumem esses valores e a tela avisa
  ("cenário pesado: sugerido 10 iterações, máximo 100"); ao sair, volta a escolha geral do usuário. "Executar todos" respeita `defaults`/`maxIterations`.
- **Glossário**: bloco recolhível explicando em linguagem simples cold run, warm-up, média, mediana, P95, P99, desvio-padrão, throughput,
  requisições por operação, bytes, consultas SQL, campos usados/recebidos e rede simulada; e uma dica curta (título/tooltip) em cada rótulo de métrica.
- Formatação de tamanhos grandes (MB) e durações longas correta.
