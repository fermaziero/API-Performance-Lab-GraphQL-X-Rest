# API Performance Lab — Contrato técnico

Fonte única de verdade entre os módulos. Qualquer divergência entre código e este arquivo é bug:
ou o código volta ao contrato, ou o contrato é atualizado junto.

## Objetivo

Laboratório para seminário de Engenharia de Software: a MESMA base de dados é exposta por REST e por
GraphQL, e a aplicação mede de verdade (nada de número fixo) latência, payload, nº de requisições,
consultas SQL etc. A conclusão esperada não é "X é melhor", e sim mostrar os trade-offs por padrão de acesso.

## Stack (já instalada — não trocar versões)

- .NET SDK 9 / `net9.0`
- ASP.NET Core Minimal API, EF Core 9.0.10 + SQLite (padrão) ou PostgreSQL opcional (`Npgsql.EntityFrameworkCore.PostgreSQL` 9.0.4, ver "Modo PostgreSQL")
- Hot Chocolate **16.6.7** (`HotChocolate.AspNetCore`, `HotChocolate.Data.EntityFramework`)
- Dashboard: HTML + CSS + JS puro, **zero dependência externa** (sem CDN, sem npm, sem build) — precisa funcionar offline

## Layout da solução

```
GraphQL/
├── ApiBenchmarkLab.sln
├── docker-compose.yml             # PostgreSQL opcional (modo "postgres")
├── docs/CONTRATO.md
└── src/
    ├── ApiBenchmark.Web/          # servidor: dados, REST, GraphQL, dashboard estático
    │   ├── Program.cs
    │   ├── ContentRootResolver.cs # acha wwwroot e appsettings.json a partir de qualquer pasta
│   ├── PagingRules.cs         # regra única de skip/take (REST e GraphQL)
    │   ├── Data/                  # entidades, LabDbContext, DatabaseSettings, DbSeeder, SqlCommandCounter
    │   ├── Rest/                  # RestEndpoints.cs + DTOs
    │   ├── GraphQL/               # Query, extensões de tipo, DataLoader
    │   └── wwwroot/               # index.html, css/, js/
    └── ApiBenchmark.Engine/       # class library: motor de benchmark (cliente HTTP puro)
```

`ApiBenchmark.Engine` NÃO referencia `ApiBenchmark.Web` nem EF Core: ele só conhece HTTP. `Web` referencia `Engine`.

Servidor escuta em **`http://localhost:5080`** (somente HTTP, sem HTTPS). Logging em `Warning`
(inclusive `Microsoft.EntityFrameworkCore` e `Microsoft.AspNetCore`) para o log de console não contaminar a medição.

## Modelo de dados (namespace `ApiBenchmark.Web.Data`)

| Entidade | Campos |
|---|---|
| `Category` | `Id`, `Name`, `Description` |
| `Supplier` | `Id`, `Name`, `Country`, `ContactEmail` |
| `Product` | `Id`, `Name`, `Description` (texto ~300–600 chars), `Price` (decimal), `Stock`, `Sku`, `CreatedAt`, `UpdatedAt`, `CategoryId`, `Category`, `SupplierId`, `Supplier` |
| `Customer` | `Id`, `Name`, `Email`, `City`, `CreatedAt`, `Orders` |
| `Order` | `Id`, `CustomerId`, `Customer`, `Date`, `Total` (decimal), `Status` (string), `Items` |
| `OrderItem` | `Id`, `OrderId`, `Order`, `ProductId`, `Product`, `Quantity`, `UnitPrice` (decimal) |

Seed determinístico (`new Random(42)`), executado na inicialização só se o banco estiver vazio
(`EnsureCreated`), numa única transação (SQLite e PostgreSQL: uma interrupção não deixa banco semeado pela metade),
arquivo `benchmark.db` ao lado do projeto:
20 categorias, 30 fornecedores, 500 produtos "base", 200 clientes, cada cliente com 3–6 pedidos, cada pedido com 2–5 itens.
`Order.Total` = soma de `Quantity * UnitPrice` dos itens. IDs sequenciais a partir de 1 (produto 150 e cliente 15 existem).
Nomes/textos em PT-BR plausíveis (ex.: "Notebook Dell Inspiron 15").

**Produtos em volume (`Seed:Products`).** Além dos 500 produtos base, a aplicação completa a tabela `Products` até `Seed:Products`
(padrão **100000**, em `appsettings.json`; mínimo 500 — valor menor é ajustado para 500 com aviso no console; valor não numérico aborta a inicialização com mensagem e código 1).
- Os 500 primeiros produtos e TODAS as demais tabelas (categorias, fornecedores, clientes, pedidos, itens) saem do mesmo fluxo de `Random(42)`, byte a byte iguais ao que sempre foram:
  os cenários existentes não mudam (conferido por hash por tabela e por comparação de respostas REST/GraphQL byte a byte contra a versão anterior).
- Os produtos 501..N saem de um `Random(4242)` independente (o produto N é sempre o mesmo, onde quer que a execução tenha parado), referenciando categorias 1..20 e fornecedores 1..30, inseridos em lotes de 5.000, cada lote numa transação.
- **Completar, não semear-se-vazio.** Na inicialização, se `MAX(Id)` dos produtos for menor que o alvo, insere só os que faltam (funciona num banco já existente com 500, em SQLite e em PostgreSQL). Nunca apaga nada (`Seed:Products=100` num banco com 1000 mantém 1000).
  Uma interrupção no meio retoma do último lote completo (500 + múltiplos de 5.000). Quando já está completo, não imprime nada nem insere nada.
- **Carga em massa fora do `SaveChanges`.** SQLite: `INSERT` preparado dentro da transação do EF. PostgreSQL: `COPY` binário, com `setval` da sequence de `Products` a cada lote. Os valores gravados são idênticos aos do caminho EF (SHA256 da tabela de 100 mil linhas bate nos dois bancos);
  o caminho EF puro foi medido e descartado (18,1 s no SQLite e 33,7 s no PostgreSQL).
  No PostgreSQL, se o papel for superusuário, o lote usa `SET LOCAL session_replication_role = replica` para não validar FK linha a linha (economiza ~7 s; as FKs valem por construção); sem superusuário cai no caminho com validação, mais lento.
- Tempos medidos (build Debug, máquina carregada): SQLite completando 99.500 produtos de um banco com 500: 3,7 a 4,8 s (banco vazio inteiro ~4,5 s); PostgreSQL: 8 a 9 s com `Host=localhost` (~3 s com `127.0.0.1`, ver "Modo PostgreSQL"). Arquivo SQLite com 100 mil produtos: ~58 MiB.
- `GET /api/info` reflete as contagens reais (`database.products` = 100000). A faixa de ambiente do dashboard mostra os totais vindos dali.

**Paginação (`PagingRules`).** A mesma regra no REST e no GraphQL: `take` ajustado (não rejeitado) para **0..100000** em `products`, `orders` e `recentOrders`; `skip` ajustado para ≥ 0 — só `products` tem `skip`.
Exemplos: `take=0`, `take=-5` → 0 itens; `take=200000` → 100000; `skip=-3` → 0.

`SqlCommandCounter` (singleton, `DbCommandInterceptor`): conta TODO comando SQL executado pelo EF
(`long Count` via `Interlocked`). Registrado no `LabDbContext` via `AddInterceptors`.

## REST (JSON camelCase, leitura com `AsNoTracking`)

API orientada a recursos, propositalmente "genérica" (devolve o recurso inteiro — é o que causa over-fetching).

| Rota | Resposta |
|---|---|
| `GET /api/products/{id}` | `ProductDto` completo, 404 se não existe |
| `GET /api/products?skip=0&take=20` | `ProductDto[]` (ordenado por id; `take` 0..100000, `skip` ≥ 0 — ver "Paginação") |
| `GET /api/customers/{id}` | `CustomerDto`, 404 se não existe |
| `GET /api/customers/{id}/orders` | `OrderDto[]` (ordenado por id) |
| `GET /api/orders/{id}/items` | `OrderItemDto[]` (ordenado por id) |
| `GET /api/orders?take=50` | `OrderWithCustomerDto[]` (primeiros `take` pedidos por id, 1 SQL com JOIN; `take` limitado a 0..100000) |
| `GET /api/customers/{id}/summary` | endpoint "sob medida" (BFF) do cenário 3 — 1 requisição, só o que a tela usa |
| `GET /api/info` | metadados do servidor (abaixo) |
| `GET /api/diagnostics/sql-count` | `{ "count": N }`: total acumulado de comandos SQL (útil para conferir contagens por `curl`; o painel não usa) |

```jsonc
// ProductDto
{ "id": 150, "name": "...", "description": "...", "price": 5999.0, "stock": 18, "sku": "...",
  "createdAt": "2025-01-01T00:00:00Z", "updatedAt": "...",
  "category": { "id": 1, "name": "...", "description": "..." },
  "supplier": { "id": 1, "name": "...", "country": "...", "contactEmail": "..." } }
// CustomerDto
{ "id": 15, "name": "...", "email": "...", "city": "...", "createdAt": "..." }
// OrderDto
{ "id": 781, "customerId": 15, "date": "...", "total": 123.45, "status": "..." }
// OrderItemDto  (product = recurso produto SEM category/supplier)
{ "id": 1, "orderId": 781, "quantity": 2, "unitPrice": 10.0,
  "product": { "id": 3, "name": "...", "description": "...", "price": 10.0, "stock": 5, "sku": "...", "createdAt": "...", "updatedAt": "..." } }
// OrderWithCustomerDto
{ "id": 1, "customerId": 1, "date": "...", "total": 1.0, "status": "...", "customer": { /* CustomerDto */ } }
// GET /api/customers/{id}/summary
{ "name": "...", "orders": [ { "date": "...", "total": 1.0, "items": [ { "product": { "name": "...", "price": 1.0 } } ] } ] }
// GET /api/info
{ "dotnetVersion": "9.0.x", "os": "...", "processorCount": 8, "environment": "Production",
  "databaseProvider": "sqlite",          // "sqlite" | "postgres"
  "graphqlEndpoint": "/graphql",
  "database": { "categories": 20, "suppliers": 30, "products": 100000, "customers": 200, "orders": 921, "orderItems": 3245 } }
```

## GraphQL (`POST /graphql`, corpo `{ "query": "...", "variables": {...} }`)

```graphql
type Query {
  product(id: Int!): Product                       # projeção: só as colunas pedidas vão no SELECT
  products(skip: Int! = 0, take: Int! = 20): [Product!]!
  customer(id: Int!): Customer                     # projeção, inclusive orders → items → product (AsSplitQuery: 3 SQL)
  orders(take: Int! = 50): [Order!]!               # COM projeção (customer vira JOIN, 1 SQL)
  recentOrders(take: Int! = 50): [Order!]!         # SEM projeção: mesmos pedidos, entidades "cruas"
}
type Product   { id: Int! name: String! description: String! price: Decimal! stock: Int! sku: String!
                 createdAt: DateTime! updatedAt: DateTime! category: Category! supplier: Supplier! }
type Category  { id: Int! name: String! description: String! }
type Supplier  { id: Int! name: String! country: String! contactEmail: String! }
type Customer  { id: Int! name: String! email: String! city: String! createdAt: DateTime! orders: [Order!]! }
type Order     { id: Int! date: DateTime! total: Decimal! status: String!
                 customer: Customer!          # via projeção (usar com `orders`)
                 customerNaive: Customer!     # resolver ingênuo: 1 SELECT por pedido  → N+1
                 customerBatched: Customer!   # DataLoader: 1 SELECT ... WHERE id IN (...) para o lote
                 items: [OrderItem!]! }
type OrderItem { id: Int! quantity: Int! unitPrice: Decimal! product: Product! }
```

`orders` e `recentOrders` devolvem os primeiros `take` pedidos ordenados por `id` (mesmo conjunto do `GET /api/orders?take=`).
Como no REST (`PagingRules`), `take` é limitado a 0..100000 e `skip` (só em `products`) a valores ≥ 0; o valor é ajustado, não rejeitado.
`customerNaive`/`customerBatched` existem para o cenário N+1 e são consultados a partir de `recentOrders`.
O IDE do Hot Chocolate (Nitro) fica acessível em `GET /graphql` no navegador.

Contagens de SQL esperadas (conferidas no smoke test): `recentOrders(take:50){customerNaive{name}}` = 51;
`recentOrders(take:50){customerBatched{name}}` = 2; `orders(take:50){customer{name}}` = 1; `GET /api/orders?take=50` = 1;
`customer(id:15){name orders{date total items{product{name price}}}}` = 3 (cliente, pedidos, itens com produto);
`GET /api/customers/15/summary` = 1; as 1+1+N requisições REST do `nested` = 7 (cliente 15 tem 5 pedidos).

## Cenários (definidos no Engine; IDs estáveis)

| id | Título | Variantes (`id` — o que faz) |
|---|---|---|
| `simple` | Consulta simples (mesmo payload) | `rest` — `GET /api/products/150` · `graphql` — `product(id:150)` pedindo TODOS os campos equivalentes ao `ProductDto` (isola o overhead do GraphQL) |
| `overfetching` | Over-fetching (a tela só precisa de nome, preço e SKU) | `rest` — `GET /api/products/150` (usa só `name`, `price`, `sku`) · `graphql` — `product(id:150){ name price sku }` |
| `overfetching-list` | Over-fetching em lista (catálogo com 50 produtos) | `rest` — `GET /api/products?take=50` (50 `ProductDto` completos; usa só `name`, `price`, `sku`) · `graphql` — `products(take:50){ name price sku }` |
| `nested` | Relacionamentos (cliente → pedidos → itens → produto) | `rest` — `GET /customers/15`, `GET /customers/15/orders`, `GET /orders/{id}/items` para cada pedido (1+1+N; sequencial, ou itens em paralelo se `restParallel`) · `rest-bff` — `GET /api/customers/15/summary` · `graphql` — 1 query `customer(id:15){ name orders{ date total items{ product{ name price } } } }` |
| `nplus1` | N+1 no servidor GraphQL (50 pedidos + nome do cliente) | `rest` — `GET /api/orders?take=50` · `graphql-naive` — `recentOrders` + `customerNaive` · `graphql-dataloader` — `recentOrders` + `customerBatched` · `graphql-projection` — `orders` + `customer` |

Campos que a tela usa (para a métrica "campos não usados"): `simple` = todos; `overfetching` e `overfetching-list` = `name`, `price`, `sku`;
`nested` = cliente `name`; pedido `date`, `total`; produto `name`, `price`; `nplus1` = pedido `id`, `date`, `total`; cliente `name`.

## Motor de benchmark (`ApiBenchmark.Engine`)

Superfície pública consumida pelo `Web`:

```csharp
namespace ApiBenchmark.Engine;
public interface ISqlCommandProbe { long Count { get; } }            // implementado no Web (adapter do SqlCommandCounter); opcional no DI
public static class BenchmarkEngineExtensions {
    public static IServiceCollection AddBenchmarkEngine(this IServiceCollection services);
    public static IEndpointRouteBuilder MapBenchmarkEndpoints(this IEndpointRouteBuilder app);   // mapeia /api/lab/*
}
```

O motor descobre o endereço do próprio servidor via `IServer` → `IServerAddressesFeature` (troca `0.0.0.0`, `[::]`, `+`, `*` por `localhost`),
e faz chamadas HTTP REAIS por loopback com um `HttpClient` único (`SocketsHttpHandler`, keep-alive, pool ≥ concorrência).
Latência de uma **operação** = `Stopwatch` do início da 1ª requisição até o último byte do corpo da última requisição necessária
para a tela (no cenário `nested` REST isso inclui todas as 1+1+N requisições).

Metodologia de um run:
0. **Preparo da conexão** — uma vez por processo, antes do primeiro cold run, uma requisição a `GET /api/lab/scenarios` (rota sem SQL), fora das métricas, abre a conexão TCP e aquece o `HttpClient`/Kestrel; sem isso a primeira variante do primeiro run pagava sozinha esse custo compartilhado.
1. **Cold run** — 1 operação por variante, medida à parte (`firstSinceStartup` = true se for a primeira execução daquela variante desde que o processo subiu). Essa operação também fornece `trace`, `sampleResponse` e `fields`.
2. **Warm-up** — pelo menos `warmup` operações por variante, descartadas; na primeira execução da variante desde que o processo subiu (`firstSinceStartup`), segue até completar no mínimo 1 s por variante (o JIT em camadas ainda promove código quente). `warmup = 0` pula a fase. A rede simulada (se ligada) NÃO se aplica aqui.
3. **Benchmark** — `iterations` operações medidas por variante, em **blocos intercalados** (≈10 blocos; a ordem das variantes alterna a cada bloco) para não favorecer quem roda por último. Dentro de um bloco só uma variante executa, com `concurrency` workers.
   Por bloco: delta de `ISqlCommandProbe.Count`, de `Process.TotalProcessorTime` (menos o tempo de giro do agendador de rede) e de `GC.GetTotalAllocatedBytes` atribuídos à variante.

Com rede simulada ligada, cada requisição HTTP do cold run e do benchmark espera o atraso configurado antes de ser considerada concluída (ver "Rede simulada").

### Endpoints do motor

| Rota | Descrição |
|---|---|
| `GET /api/lab/scenarios` | lista de cenários |
| `POST /api/lab/runs` | inicia um run → `202 { "runId": "..." }`; `400 { "error": "..." }` se inválido; `409` se já existe run em execução |
| `GET /api/lab/runs/{runId}` | estado/resultado (polling a cada ~250 ms durante a execução); 404 se desconhecido |
| `POST /api/lab/runs/{runId}/cancel` | cancela → 202 |
| `GET /api/lab/runs` | últimos 20 runs (mais recente primeiro), mesmo formato porém com `samples: []`, `trace: []`, `sampleResponse: null` |

```jsonc
// GET /api/lab/scenarios
[ { "id": "nested", "title": "...", "description": "...", "need": "texto: o que a tela precisa mostrar",
    "variants": [ { "id": "rest", "label": "REST (orientado a recursos)", "kind": "rest",          // kind: "rest" | "graphql"
                    "description": "...", "requestPreview": "GET /api/customers/15\nGET /api/customers/15/orders\nGET /api/orders/{id}/items  (×N)" } ] } ]

// POST /api/lab/runs  (limites: iterations 1..10000, warmup 0..1000, concurrency 1..32, simulatedLatencyMs 0..1000, simulatedBandwidthMbps 0.1..10000 ou null)
{ "scenarioId": "nested", "iterations": 1000, "warmup": 50, "concurrency": 1, "restParallel": false,
  "simulatedLatencyMs": 0, "simulatedBandwidthMbps": null }       // os dois últimos são opcionais: ver "Rede simulada"

// GET /api/lab/runs/{runId}
{ "runId": "...", "scenarioId": "nested",
  "status": "running",                 // "running" | "completed" | "failed" | "cancelled"
  "phase": "benchmark",                // "cold" | "warmup" | "benchmark" | "done"
  "config": { "iterations": 1000, "warmup": 50, "concurrency": 1, "restParallel": false, "simulatedLatencyMs": 0, "simulatedBandwidthMbps": null },
  "progress": { "completed": 640, "total": 2000 },   // operações medidas, somando variantes (fase benchmark); 0/total nas fases anteriores
  "startedAt": "2026-01-01T00:00:00Z", "finishedAt": null, "durationMs": null, "error": null,
  "variants": [ {
      "id": "rest", "label": "REST (orientado a recursos)", "kind": "rest",
      "completed": 320,                               // operações medidas até agora
      "cold": { "latencyMs": 41.2, "firstSinceStartup": true },          // null até o cold DESTA variante terminar
      "latency": { "mean": 3.1, "median": 2.9, "p95": 4.8, "p99": 7.5, "min": 2.1, "max": 19.0, "stdDev": 0.9 },  // ms; null enquanto completed == 0
      "throughput": { "opsPerSecond": 310.5, "httpRequestsPerSecond": 1552.5 },   // null enquanto completed == 0
      "requestsPerOperation": 5.0,
      "bytesReceivedPerOperation": 14210.0,           // corpo das respostas
      "bytesSentPerOperation": 310.0,                 // linha de requisição + corpo (query GraphQL conta aqui)
      "simulatedNetworkMsPerOperation": 0,            // média por operação da soma dos atrasos de rede simulada injetados; 0 com a rede desligada
      "sqlQueriesPerOperation": 5.0,                  // null se não houver ISqlCommandProbe
      "cpuMsPerOperation": 0.8,                       // processo inteiro (cliente + servidor), null se indisponível
      "allocatedBytesPerOperation": 91234.0,          // idem
      "fields": { "received": 96, "used": 31, "unused": 65 },   // folhas JSON recebidas vs usadas pela tela, na operação de amostra; null até o cold desta variante
      "errors": 0, "errorRate": 0.0,                  // operação com qualquer status != 2xx ou "errors" no corpo GraphQL conta como erro
      "samples": [2.9, 3.0],                          // latências (ms) em ordem de execução; no máximo 2000 pontos (amostragem uniforme)
      "trace": [ { "method": "GET", "url": "/api/customers/15", "status": 200, "durationMs": 1.2, "simulatedDelayMs": 0,   // durationMs = tempo real (sem o atraso simulado)
                   "bytesReceived": 180, "bytesSent": 40, "body": null } ],   // body = query GraphQL quando POST
      "sampleResponse": "{ ...JSON identado da última resposta da operação de amostra, truncado em 4000 chars... }"
  } ] }
```

Percentis por "nearest-rank" sobre TODAS as amostras medidas (não sobre a versão amostrada de `samples`).
`throughput` = operações medidas ÷ tempo de parede somado dos blocos daquela variante.
Só um run executa por vez. Runs ficam em memória (não persistem).

### Rede simulada

O laboratório mede em loopback, onde a rede custa zero. A rede simulada injeta, por requisição HTTP, o custo que uma rede real cobraria,
para mostrar na tela o que o loopback esconde: cada ida e volta custa tempo, e cada byte trafegado também. É uma SIMULAÇÃO: o tráfego continua em loopback e o atraso é uma espera injetada no cliente do motor.

| Campo (`POST /api/lab/runs`, opcionais) | Tipo | Limites | Padrão |
|---|---|---|---|
| `simulatedLatencyMs` | inteiro | 0..1000 | 0 |
| `simulatedBandwidthMbps` | número ou `null` | 0.1..10000 | `null` (sem limite) |

Fora dos limites → `400 { "error": "..." }` (ex.: `'simulatedLatencyMs' deve ser um inteiro entre 0 e 1000.`; 50.5 também é recusado). Valor de outro tipo (ex.: `"50"`) cai no 400 genérico `JSON inválido no corpo da requisição.`
Os dois campos aparecem em `config` de `GET /api/lab/runs*` (`simulatedLatencyMs` inteiro, `simulatedBandwidthMbps` número ou `null`).

Semântica (verificada em execução real):
- **Atraso por requisição** = `simulatedLatencyMs` + tempo de transferência; tempo de transferência (ms) = `(bytesSent + bytesReceived) × 8 ÷ (simulatedBandwidthMbps × 1.000.000) × 1000` (zero com banda `null`), com `bytesSent`/`bytesReceived` como definidos em "Bytes" (linha de requisição + corpo enviado; corpo recebido).
- **Onde entra.** No cliente do motor, depois do último byte do corpo da resposta e ANTES de a requisição ser considerada concluída: o instante de término da requisição é o do fim da espera, então o atraso entra em `latency`, `throughput` e `cold.latencyMs` (é o tempo que o usuário esperaria). Requisições em paralelo (`restParallel`, `concurrency`) esperam em paralelo, como numa rede real.
- **Fases.** Vale no cold run e no benchmark. NÃO vale no warm-up (aquecimento serve para JIT/pool; esperar rede ali só gasta tempo — medido: latência 100 ms, 5 iterações, 2 variantes: 1,25 s sem warm-up e 1,44 s com warm-up 50, contra os 1,2 s teóricos de cold + benchmark; se o warm-up esperasse, seriam +10 s).
- **Falha de transporte** (sem resposta, sem bytes) não recebe atraso.
- **Desligada** (`simulatedLatencyMs = 0` e banda `null`): o motor nem cria a simulação nem o agendador (sem alocação, espera ou thread por requisição). 7 rodadas A/B alternadas contra o motor anterior (cenários `simple` e `nplus1`, concorrência 1 e 16): medianas e throughput equivalentes dentro do ruído (±5–10%, nos dois sentidos), alocação por operação idêntica.
- **Precisão.** `Task.Delay` puro no Windows tem granularidade de ~15 ms (medido: erro mediano de 8,6 a 12,1 ms, P99 de 11,6 a 15 ms) e NÃO atende. O motor usa um agendador dedicado (`PreciseDelayScheduler`): uma thread de prioridade alta com fila de prazos, que dorme com temporizador de alta resolução do Windows (`CreateWaitableTimerEx` com `CREATE_WAITABLE_TIMER_HIGH_RESOLUTION`) até 1 ms antes do prazo e gira só o trecho final; esperas ≤ 100 µs giram inline. Cada espera é uma `TaskCompletionSource` completada no instante devido; o cancelamento do run a completa na hora.
  Sem o temporizador de alta resolução (Windows antigo) cai em `WaitOne(ms)` com margem de giro de 16 ms (mesma precisão ao custo de ~25–44% de um núcleo); fora do Windows, `WaitOne(ms)` com margem de 2 ms (ramo só exercitado de forma simulada, não executado numa máquina Linux/macOS).
  O valor reportado é sempre o atraso REALMENTE injetado, medido na própria thread do agendador (instante do disparo menos o fim real da requisição), sem incluir o salto de volta ao ThreadPool, que sofre preempção de outros processos e não faz parte da rede simulada.
  Medido no caminho real do motor (erro = atraso injetado − alvo, n de 99 a 7.616 por configuração, alvos de 20/50/100 ms, concorrência 1 e 16): mediana 0,001 a 0,005 ms, P99 de 0,08 a 0,31 ms, máximo 0,82 ms; nenhuma amostra fora de ±1 ms. Via API (média de `simulatedNetworkMsPerOperation` − alvo, `simple`, 100 a 320 operações): 0,003 a 0,04 ms.
- **Cancelamento.** Cancelar no meio de uma espera (mesmo de 1 s, ou de uma requisição de banda 0,1 Mbps em voo) leva o run a `cancelled` em poucos ms; o run seguinte roda normal. A entrada cancelada fica na fila do agendador até o prazo, inócua.
- **CPU e memória.** O tempo de giro do agendador é descontado de `cpuMsPerOperation` (é custo do simulador, não do sistema medido). Mesmo assim, com rede ligada e requisições esparsas a CPU por operação fica acima da de um run em loopback (threads do ThreadPool/Kestrel/IOCP acordando entre esperas; medido no `nested`: ~19 ms/op com 50 ms contra ~4,7 ms/op sem rede), e `allocatedBytesPerOperation` inclui as alocações do próprio agendador. O tempo real (latência − atraso) também sobe ~0,5 a 1,5 ms por requisição depois de uma espera (CPU e threads ociosos acordando): é efeito físico, não erro do atraso. Compare CPU, memória e tempo real só entre runs com a mesma rede.

Campos novos no resultado:

```jsonc
// em cada variante
"simulatedNetworkMsPerOperation": 350.04,  // média por operação da SOMA dos atrasos injetados; 0 com a rede desligada; enquanto completed == 0 usa a operação do cold
// em cada entrada de "trace"
"durationMs": 1.2,                         // tempo real da requisição (sem o atraso simulado)
"simulatedDelayMs": 50.003                 // atraso injetado nesta requisição; 0 com a rede desligada
```

A lista `GET /api/lab/runs` mantém `trace: []` e `sampleResponse: null`.

**Soma dos atrasos × latência.** Com tudo em sequência (`restParallel = false`, `concurrency = 1`) os atrasos são aditivos: `latência ≈ tempo real + soma injetada`. Com requisições em paralelo ou `concurrency > 1` os atrasos se sobrepõem: a soma injetada passa a ser MAIOR que o acréscimo real de latência, e o dashboard rotula isso (e não subtrai a soma da mediana).
Exemplo medido no `nested` com 50 ms (30 iterações): `rest` sequencial mediana 364,7 ms (soma 350,04 = 7 × 50 + ~14,7 de tempo real), `rest-bff` 52,4 ms e `graphql` 53,2 ms (50 + ~2–3 de tempo real); com `restParallel` o `rest` cai para 156,9 ms (3 × 50 + ~7: cliente, pedidos, e os 5 itens juntos) enquanto a soma injetada continua 350,09 ms.
Exemplo de banda no `overfetching-list`, latência 0 e 5 Mbps: `rest` (41.883 B recebidos + 36 B enviados) paga 67,07 ms (esperado 67,07) e `graphql` (4.301 B + 77 B) paga 7,01 ms (esperado 7,01); com 100 Mbps + 20 ms, 23,36 e 20,36 ms.


## Modo PostgreSQL (opcional)

Padrão: SQLite, sem dependência externa. O PostgreSQL existe para o banco deixar de ser in-process: cada consulta SQL passa a pagar
ida e volta por TCP, o que torna o custo do N+1 (cenário `nplus1`) realista. Mesmo seed, mesmas rotas, mesmo schema GraphQL,
mesmas contagens de SQL por cenário.

| Item | Valor |
|---|---|
| `Database:Provider` | `"sqlite"` (padrão) \| `"postgres"` (sem diferenciar maiúsculas; outro valor aborta a inicialização com mensagem) |
| `ConnectionStrings:Lab` | SQLite — `Data Source=benchmark.db` |
| `ConnectionStrings:LabPostgres` | `Host=localhost;Port=5433;Database=lab;Username=lab;Password=lab` |
| `docker-compose.yml` | serviço `postgres`, `postgres:16-alpine`, contêiner `apilab-postgres`, `127.0.0.1:5433` → `5432`, `POSTGRES_DB/USER/PASSWORD=lab` (credenciais só de laboratório local), healthcheck `pg_isready`, volume nomeado `pgdata` (`apilab_pgdata`) |

```
docker compose up -d
dotnet run -c Release --project src/ApiBenchmark.Web -- --Database:Provider=postgres
```

Detalhes verificados em execução real:
- **Seleção num único ponto.** `Data/DatabaseSettings.cs` lê `Database:Provider`, escolhe `UseSqlite`/`UseNpgsql` e valida a configuração; o resto do código não conhece o provedor (exceto o `DbSeeder`, que alinha as sequences no PostgreSQL).
- **Inicialização.** No modo `postgres` a aplicação tenta conectar por até ~8 s (cobre o contêiner ainda subindo). Se não conseguir, escreve uma mensagem curta (`PostgreSQL inacessível em localhost:5433. Suba com: docker compose up -d`) e sai com código 1. Erro de autenticação e connection string inválida têm mensagens próprias.
- **Seed idêntico.** Mesmo `Random(42)` e IDs explícitos (produto 150 e cliente 15 existem). As datas são `DateTime` UTC (`timestamptz` exige `Kind=Utc`; o `UtcDateTimeConverter` já garante). Como os IDs são explícitos, o seed (que roda numa transação nos dois bancos) ao final ajusta, no PostgreSQL, as sequences das colunas identity (`setval` para o `MAX(Id)`), para inserções futuras não colidirem. O alinhamento das sequences acontece a cada lote da carga em massa (ver "Modelo de dados"). Semear os 500 produtos base leva ~1 s; completar até 100.000 leva ~8 a 9 s com `Host=localhost`.
- **Pool de conexões.** Se a connection string não definir `Maximum Pool Size`, o código usa 50 (o padrão do Npgsql é 100, igual ao `max_connections` do PostgreSQL, e o N+1 do GraphQL em paralelo com `concurrency` alto esgotaria as conexões do servidor).
- **Contagens de SQL** iguais às do SQLite (naive=51, dataloader=2, projeção=1, REST=1; `nested`: REST=7, `rest-bff`=1, `graphql`=3).
- **Diferença de serialização.** `numeric(18,2)` preserva a escala: o PostgreSQL devolve `6777.80` onde o SQLite devolve `6777.8`. Os valores são os mesmos; só o texto JSON muda, então `bytesReceivedPerOperation` fica alguns bytes maior no PostgreSQL.
- **Esquema de dados.** `EnsureCreated` cria as tabelas; para semear de novo, recrie o schema do banco `lab` (por exemplo `docker compose down -v` apaga o volume `apilab_pgdata`).

## Dashboard (`src/ApiBenchmark.Web/wwwroot`)

SPA estática servida em `/` (`UseDefaultFiles` + `UseStaticFiles`). Consome apenas `/api/info` e `/api/lab/*`.
Textos em PT-BR. Nenhum número fixo na tela: tudo vem das respostas da API.
A faixa de ambiente do cabeçalho mostra o banco em uso (`databaseProvider` de `/api/info`), e o texto de metodologia da tela cita o mesmo banco.

Regras de exibição do comparativo (heurística da interface, não teste estatístico): uma variante empata com a melhor quando a diferença é menor que 3% **ou** menor que 2 erros-padrão da dispersão medida no próprio run (até 10 trechos consecutivos de `samples`, estatística de cada trecho, erro-padrão relativo entre eles; combinado entre duas variantes por raiz da soma dos quadrados). Sem amostras suficientes (menos de 32) vale só o 3%. O cold run (1 amostra) é exibido sem selo de "melhor" e sem razão. A frase de cauda (P99 contra a mediana) só aparece com 100 ou mais amostras. Se o acompanhamento (polling) desiste (404 ou 20 falhas seguidas), a tela marca o run como falho localmente, libera os controles e oferece "Tentar reconectar".

**Rede simulada e varredura.** Tudo vem da API (`config.simulatedLatencyMs`, `config.simulatedBandwidthMbps`, `variants[].simulatedNetworkMsPerOperation`, `variants[].trace[].simulatedDelayMs`); os campos ausentes valem "rede desligada" (a tela não quebra com um servidor antigo).
- **Configuração "Rede simulada"** (selo SIMULAÇÃO): latência por requisição em chips 0 / 20 / 50 / 100 ms + valor livre (inteiro 0..1000); banda em chips Sem limite / 100 / 20 / 5 Mbps + valor livre (0,1..10000, vazio = sem limite). Uma linha-resumo diz o que será injetado (ex.: "+50 ms de latência e banda de 5 Mbps (100 KB trafegados custam ≈ 164 ms)") e que é simulação, que o atraso é injetado no cliente do laboratório e que não vale no warm-up. Valor inválido bloqueia Executar e Varredura. Todo `POST /api/lab/runs` envia os dois campos.
- **Varredura de rede.** Botão que executa o cenário selecionado em 0, 20, 50 e 100 ms (mantendo a banda escolhida), uma etapa por vez, com iterações = mín(escolha, 30) e warm-up = mín(escolha, 10) (e `maxIterations` do cenário, se o servidor informar). Painel próprio com as 4 etapas (aguardando / cold / aquecendo / benchmark % / concluída), barra ao vivo "etapa k de 4" e cancelar (mantém as etapas já concluídas).
  Gráfico "Mediana × latência de rede": uma linha por variante (cor + tracejado + marcador distinto), eixos com unidade, pontos medidos visíveis, valor da maior latência à direita. **Cruzamentos**: onde uma variante passa a ganhar da outra, marcados com anel numerado + guia até o eixo + rótulo "≈ X ms"; o ponto é interpolado em linha reta entre as duas medições vizinhas, e só vale como cruzamento "sustentado" se a inversão não ficar dentro do empate técnico (3%) — inversões dentro do empate são contadas à parte.
  Texto de leitura gerado dos dados (cruzamentos, inclinação por +10 ms de latência com requisições por operação, observações) e tabela de medianas por etapa com a rede injetada. Sem cruzamento, o texto diz quem esteve à frente em todas as latências e em quais houve empate técnico e com quem.
  Resultado real observado com os cenários atuais: nenhum cruzamento (a variante de 1 requisição já ganha em 0 ms; `nested`: REST 7 req +70,9 ms a cada +10 ms contra +10,1 ms de `rest-bff` e `graphql`). O cálculo e o posicionamento dos cruzamentos foram conferidos à mão com séries sintéticas (retas que se cruzam em 10, 12,5 e 12,78 ms: anéis em 10, 12,5 e 12,78 ms e medianas de 40, 42,5 e 43,3 ms, nas posições esperadas dos eixos).
- **Cartões e comparativo.** Grupo "Rede simulada" com barra real × rede (hachurada) e "Tempo real medido = mediana − soma injetada" quando tudo é sequencial; com `restParallel` ou concorrência > 1 mostra só "Rede simulada (soma injetada)" com aviso de sobreposição e NÃO subtrai da mediana. A tabela comparativa tem a seção "Rede simulada" com "Rede injetada (soma por operação)" e, só no caso aditivo, "Tempo real medido (mediana − rede)". Também mostra desvio-padrão (`latency.stdDev`).
- **Waterfall.** Barra sólida (`durationMs`) + segmento hachurado (`simulatedDelayMs`) por requisição, com legenda real × simulado; o `nested` REST aparece como escada de 7 blocos hachurados (ou 2 sequenciais + 5 paralelos com `restParallel`) e o tile "rede paga 7× · 350 ms simulados".
- **Histórico e matriz-resumo** mostram a rede de cada run ("50 ms · 5 Mbps", "20 ms · banda livre", "loopback"); o cabeçalho do resultado e "Leitura do resultado" (parágrafo "Rede simulada": soma injetada por variante, % da mediana, tempo real quando aditivo, aviso de sobreposição quando não) e a metodologia (inclusive o aviso de que tempo real, CPU e memória com rede ligada não são comparáveis com runs sem rede) usam a mesma informação.
- **Glossário** recolhível (`details/summary`, 19 verbetes: cold run, warm-up, média, mediana, P95, P99, desvio-padrão, throughput, requisições por operação, bytes recebidos/enviados, consultas SQL, campos usados/recebidos, taxa de erro, CPU/memória, rede simulada, rede injetada, tempo real, varredura) e uma dica curta (`title`, sublinhado pontilhado) em cada rótulo de métrica dos cartões, da tabela, da matriz, do histórico e dos mini-gráficos.
- Tamanhos grandes são formatados em KB/MB (base 1024: 83.550.652 B → 79,7 MB; acima de 1 GB aparece como milhares de MB) e durações longas em s / min s (10,3 s; 1 min 35 s).

## Notas de implementação (comportamento verificado em execução real)

Detalhes que o contrato acima não especificava ou em que a implementação decidiu diferente. Valem como parte do contrato.

### Motor
- **Disponibilidade por variante.** `cold`, `fields`, `trace`, `sampleResponse` e os valores de `requestsPerOperation` / `bytes*PerOperation` aparecem assim que o cold run *daquela variante* termina (as variantes rodam o cold em sequência). Antes disso valem `null` / `0`. Depois das primeiras operações medidas, `requestsPerOperation` e `bytes*PerOperation` passam a ser médias das medidas.
- **`sqlQueriesPerOperation`, `cpuMsPerOperation`, `allocatedBytesPerOperation`** só são calculados sobre blocos já fechados; ficam `null` até o primeiro bloco da variante terminar. `latency` e `throughput` ficam `null` só enquanto `completed == 0` (o throughput parcial usa também o tempo do bloco em andamento).
- **Blocos.** `min(10, iterations)` blocos com as iterações divididas igualmente; com `concurrency > 1` o número de blocos é reduzido para que cada um tenha pelo menos `4 × concurrency` operações (`iterations / (4 × concurrency)`, no mínimo 1 bloco), senão a concorrência pedida não era alcançada e o throughput saía subestimado. Se `iterations < concurrency`, a concorrência efetiva é `iterations`. A ordem das variantes é a normal nos blocos pares e invertida nos ímpares. O warm-up usa a mesma `concurrency` do run e a fase `warmup` é pulada quando `warmup == 0`.
- **JIT.** O `ApiBenchmark.Web.csproj` desliga `TieredPGO` e define `System.Runtime.TieredCompilation.CallCountingDelayMs=0` no `runtimeconfig.json`. Com os padrões, a promoção para o código otimizado demorava vários segundos e o regime medido era cerca de 2x mais lento que o estável (medido: mediana REST do `simple` 0,56 a 0,77 ms contra 0,29 a 0,33 ms).
- **Erros.** Operação com HTTP != 2xx, `errors` no corpo GraphQL ou falha de transporte conta em `errors` e **continua** entrando em `latency`/`completed`. Falha de transporte *no cold* derruba o run (`status: "failed"`, mensagem em `error`).
- **Estatística.** Percentis nearest-rank sobre todas as amostras; `median` é a média dos dois centrais quando n é par; `stdDev` é amostral (n−1; 0 se n = 1). O JSON arredonda para 4 casas.
- **Bytes.** `bytesReceived` = tamanho do corpo lido (sem cabeçalhos). `bytesSent` = linha `MÉTODO url HTTP/1.1\r\n` + corpo JSON realmente enviado. Na query GraphQL os espaços em branco são colapsados antes de enviar e `variables` é omitido (as queries usam literais); `trace[].body` e `requestPreview` mostram a query formatada (a legível), então `bytesSent` corresponde à versão compacta. `requestPreview` de variantes GraphQL é só o texto da query.
- **POST /api/lab/runs.** Só `scenarioId` é obrigatório; defaults: `iterations=1000`, `warmup=50`, `concurrency=1`, `restParallel=false`, `simulatedLatencyMs=0`, `simulatedBandwidthMbps=null`. `409` e `400` devolvem apenas `{ "error": "..." }`. `runId` é uma string hex de 12 caracteres.
- **Cancelamento.** `POST .../cancel` é idempotente: `202 { "runId" }` também para run já finalizado; run desconhecido → `404 { "error" }`. O run cancelado fica `cancelled` com os resultados parciais. O bloco interrompido entra só no tempo de parede: seus deltas de SQL, CPU e alocação são descartados (as operações abortadas em voo já gastaram recursos no servidor sem entrar no denominador, o que inflava `sqlQueriesPerOperation`, por exemplo 52,3 em vez de 51).
- **Cache.** Os GETs de run enviam `Cache-Control: no-store`.
- **Escopo das métricas de processo.** SQL, CPU e alocação são do processo inteiro (cliente do motor + servidor + qualquer outra requisição que chegue durante o run, como um `GET /api/info` ou o polling do painel).

### GraphQL
- `customerNaive` e `customerBatched` só funcionam a partir de `recentOrders` (entidades sem projeção). Em `orders { ... }` (com projeção) a coluna `CustomerId` não é carregada e o resolver devolve um erro GraphQL explicando isso. O campo `customer` é o caminho de `orders`.
- **Campos de coleção fora de projeção falham em vez de devolver vazio.** `Order.Items` e `Customer.Orders` não têm inicializador (`= null!`): em `recentOrders { items }` ou `recentOrders { customerNaive { orders } }` (entidades sem projeção) a resposta é um erro `HC0018` ("Cannot return null for non-nullable field"), em vez de uma lista vazia silenciosa que parecia dado real. Com projeção (`orders { items }`, `customer { orders }`) funcionam normalmente.
- **Introspecção sempre habilitada** (`DisableIntrospection(false)`). O padrão do Hot Chocolate 16 a desliga fora de `Development`, o que deixava o Nitro (e `__schema`) sem schema ao rodar a DLL em `Production`.
- O SDL (`/graphql?sdl`) tem os mesmos tipos e campos acima; o Hot Chocolate 16 acrescenta `@cost(weight)` em campos de resolver e ordena os campos de outra forma.
- **Custo do SQL da projeção aninhada (`AsSplitQuery`).** `customer(id){ orders{ items{ product } } }` em uma única consulta é gerado pelo EF Core com `LEFT JOIN` de subconsultas aninhadas. O SQLite não consegue "achatar" esse formato e materializa Orders × OrderItems × Products a cada execução (`EXPLAIN QUERY PLAN`: `MATERIALIZE s0`, `SCAN o`, `SCAN o0`), cerca de 5 ms por consulta, e o `graphql` do `nested` ficava mais lento que o `rest-bff` e até que as 1+1+N requisições REST (artefato do SQL gerado + planejador, não do protocolo). `GetCustomer` usa `AsSplitQuery()` (a projeção do Hot Chocolate respeita a opção): 3 consultas correlacionadas (cliente; pedidos; itens com produto), todas por índice. Medido no SQLite: `graphql` do `nested` cai de ~5 ms para menos de 1 ms (mesmo resultado do `rest-bff`, conferido campo a campo). No PostgreSQL a consulta única já era boa (`graphql` próximo do `rest-bff`); ali a divisão custa 3 idas e voltas (exemplo, 300 iterações: `graphql` 5,7 ms contra 2,6 ms do `rest-bff`, mas bem abaixo dos 13,1 ms das 1+1+N requisições REST; antes da divisão, o `graphql` ficava em ~3 ms, próximo do `rest-bff`). O contrato mantém a mesma contagem de SQL nos dois bancos (3). Para a apresentação: 1 requisição HTTP não é 1 consulta SQL, e o formato do SQL gerado pelo ORM muda o resultado.
- **Consultas de 100 mil produtos.** `products(take: 100000)` e `GET /api/products?take=100000` funcionam com os limites padrão do Hot Chocolate (custo/profundidade não bloqueiam); o `ExecutionTimeout` do GraphQL foi elevado de 30 s (padrão) para 5 min em `ModifyRequestOptions` para a consulta completa não estourar com concorrência alta. Medido (SQLite, build Debug, máquina carregada): REST completo (`ProductDto`, 83.550.652 B) 3,2 a 4,3 s; GraphQL `name price sku` (8.361.921 B) ~1,1 a 1,8 s; GraphQL com todos os campos (incl. `category` e `supplier`, 83.550.674 B) 3,1 a 7,1 s; o GraphQL completo é igual ao REST campo a campo nos 100 mil itens. Pico de memória da aplicação ~0,85 GB com um cliente por vez e ~3,5 GB com 8 clientes completos em paralelo: o cenário de estresse não combina com concorrência alta.
- **Ordem de `items` no PostgreSQL.** Com 100 mil produtos, `customer(id){ orders{ items{ product } } }` pode devolver os `items` de cada pedido em outra ordem que antes (mesmos elementos; o SQL do split query não tem `ORDER BY` e o plano mudou). Não afeta contagem de campos nem de SQL; o REST `/api/orders/{id}/items` ordena por id.
