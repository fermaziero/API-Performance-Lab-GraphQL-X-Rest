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
20 categorias, 30 fornecedores, 500 produtos, 200 clientes, cada cliente com 3–6 pedidos, cada pedido com 2–5 itens.
`Order.Total` = soma de `Quantity * UnitPrice` dos itens. IDs sequenciais a partir de 1 (produto 150 e cliente 15 existem).
Nomes/textos em PT-BR plausíveis (ex.: "Notebook Dell Inspiron 15").

`SqlCommandCounter` (singleton, `DbCommandInterceptor`): conta TODO comando SQL executado pelo EF
(`long Count` via `Interlocked`). Registrado no `LabDbContext` via `AddInterceptors`.

## REST (JSON camelCase, leitura com `AsNoTracking`)

API orientada a recursos, propositalmente "genérica" (devolve o recurso inteiro — é o que causa over-fetching).

| Rota | Resposta |
|---|---|
| `GET /api/products/{id}` | `ProductDto` completo, 404 se não existe |
| `GET /api/products?skip=0&take=20` | `ProductDto[]` (ordenado por id) |
| `GET /api/customers/{id}` | `CustomerDto`, 404 se não existe |
| `GET /api/customers/{id}/orders` | `OrderDto[]` (ordenado por id) |
| `GET /api/orders/{id}/items` | `OrderItemDto[]` (ordenado por id) |
| `GET /api/orders?take=50` | `OrderWithCustomerDto[]` (primeiros `take` pedidos por id, 1 SQL com JOIN; `take` limitado a 0..1000) |
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
  "database": { "categories": 20, "suppliers": 30, "products": 500, "customers": 200, "orders": 0, "orderItems": 0 } }
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
Como no REST, `take` é limitado a 0..1000 e `skip` a valores ≥ 0 (o valor é ajustado, não rejeitado).
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
2. **Warm-up** — pelo menos `warmup` operações por variante, descartadas; na primeira execução da variante desde que o processo subiu (`firstSinceStartup`), segue até completar no mínimo 1 s por variante (o JIT em camadas ainda promove código quente). `warmup = 0` pula a fase.
3. **Benchmark** — `iterations` operações medidas por variante, em **blocos intercalados** (≈10 blocos; a ordem das variantes alterna a cada bloco) para não favorecer quem roda por último. Dentro de um bloco só uma variante executa, com `concurrency` workers.
   Por bloco: delta de `ISqlCommandProbe.Count`, de `Process.TotalProcessorTime` e de `GC.GetTotalAllocatedBytes` atribuídos à variante.

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

// POST /api/lab/runs  (limites: iterations 1..10000, warmup 0..1000, concurrency 1..32)
{ "scenarioId": "nested", "iterations": 1000, "warmup": 50, "concurrency": 1, "restParallel": false }

// GET /api/lab/runs/{runId}
{ "runId": "...", "scenarioId": "nested",
  "status": "running",                 // "running" | "completed" | "failed" | "cancelled"
  "phase": "benchmark",                // "cold" | "warmup" | "benchmark" | "done"
  "config": { "iterations": 1000, "warmup": 50, "concurrency": 1, "restParallel": false },
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
      "sqlQueriesPerOperation": 5.0,                  // null se não houver ISqlCommandProbe
      "cpuMsPerOperation": 0.8,                       // processo inteiro (cliente + servidor), null se indisponível
      "allocatedBytesPerOperation": 91234.0,          // idem
      "fields": { "received": 96, "used": 31, "unused": 65 },   // folhas JSON recebidas vs usadas pela tela, na operação de amostra; null até o cold desta variante
      "errors": 0, "errorRate": 0.0,                  // operação com qualquer status != 2xx ou "errors" no corpo GraphQL conta como erro
      "samples": [2.9, 3.0],                          // latências (ms) em ordem de execução; no máximo 2000 pontos (amostragem uniforme)
      "trace": [ { "method": "GET", "url": "/api/customers/15", "status": 200, "durationMs": 1.2,
                   "bytesReceived": 180, "bytesSent": 40, "body": null } ],   // body = query GraphQL quando POST
      "sampleResponse": "{ ...JSON identado da última resposta da operação de amostra, truncado em 4000 chars... }"
  } ] }
```

Percentis por "nearest-rank" sobre TODAS as amostras medidas (não sobre a versão amostrada de `samples`).
`throughput` = operações medidas ÷ tempo de parede somado dos blocos daquela variante.
Só um run executa por vez. Runs ficam em memória (não persistem).

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
- **Seed idêntico.** Mesmo `Random(42)` e IDs explícitos (produto 150 e cliente 15 existem). As datas são `DateTime` UTC (`timestamptz` exige `Kind=Utc`; o `UtcDateTimeConverter` já garante). Como os IDs são explícitos, o seed (que roda numa transação nos dois bancos) ao final ajusta, no PostgreSQL, as sequences das colunas identity (`setval` para o `MAX(Id)`), para inserções futuras não colidirem. Semeia em cerca de 1 s.
- **Pool de conexões.** Se a connection string não definir `Maximum Pool Size`, o código usa 50 (o padrão do Npgsql é 100, igual ao `max_connections` do PostgreSQL, e o N+1 do GraphQL em paralelo com `concurrency` alto esgotaria as conexões do servidor).
- **Contagens de SQL** iguais às do SQLite (naive=51, dataloader=2, projeção=1, REST=1; `nested`: REST=7, `rest-bff`=1, `graphql`=3).
- **Diferença de serialização.** `numeric(18,2)` preserva a escala: o PostgreSQL devolve `6777.80` onde o SQLite devolve `6777.8`. Os valores são os mesmos; só o texto JSON muda, então `bytesReceivedPerOperation` fica alguns bytes maior no PostgreSQL.
- **Esquema de dados.** `EnsureCreated` cria as tabelas; para semear de novo, recrie o schema do banco `lab` (por exemplo `docker compose down -v` apaga o volume `apilab_pgdata`).

## Dashboard (`src/ApiBenchmark.Web/wwwroot`)

SPA estática servida em `/` (`UseDefaultFiles` + `UseStaticFiles`). Consome apenas `/api/info` e `/api/lab/*`.
Textos em PT-BR. Nenhum número fixo na tela: tudo vem das respostas da API.
A faixa de ambiente do cabeçalho mostra o banco em uso (`databaseProvider` de `/api/info`), e o texto de metodologia da tela cita o mesmo banco.

Regras de exibição do comparativo (heurística da interface, não teste estatístico): uma variante empata com a melhor quando a diferença é menor que 3% **ou** menor que 2 erros-padrão da dispersão medida no próprio run (até 10 trechos consecutivos de `samples`, estatística de cada trecho, erro-padrão relativo entre eles; combinado entre duas variantes por raiz da soma dos quadrados). Sem amostras suficientes (menos de 32) vale só o 3%. O cold run (1 amostra) é exibido sem selo de "melhor" e sem razão. A frase de cauda (P99 contra a mediana) só aparece com 100 ou mais amostras. Se o acompanhamento (polling) desiste (404 ou 20 falhas seguidas), a tela marca o run como falho localmente, libera os controles e oferece "Tentar reconectar".

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
- **POST /api/lab/runs.** Só `scenarioId` é obrigatório; defaults: `iterations=1000`, `warmup=50`, `concurrency=1`, `restParallel=false`. `409` e `400` devolvem apenas `{ "error": "..." }`. `runId` é uma string hex de 12 caracteres.
- **Cancelamento.** `POST .../cancel` é idempotente: `202 { "runId" }` também para run já finalizado; run desconhecido → `404 { "error" }`. O run cancelado fica `cancelled` com os resultados parciais. O bloco interrompido entra só no tempo de parede: seus deltas de SQL, CPU e alocação são descartados (as operações abortadas em voo já gastaram recursos no servidor sem entrar no denominador, o que inflava `sqlQueriesPerOperation`, por exemplo 52,3 em vez de 51).
- **Cache.** Os GETs de run enviam `Cache-Control: no-store`.
- **Escopo das métricas de processo.** SQL, CPU e alocação são do processo inteiro (cliente do motor + servidor + qualquer outra requisição que chegue durante o run, como um `GET /api/info` ou o polling do painel).

### GraphQL
- `customerNaive` e `customerBatched` só funcionam a partir de `recentOrders` (entidades sem projeção). Em `orders { ... }` (com projeção) a coluna `CustomerId` não é carregada e o resolver devolve um erro GraphQL explicando isso. O campo `customer` é o caminho de `orders`.
- **Campos de coleção fora de projeção falham em vez de devolver vazio.** `Order.Items` e `Customer.Orders` não têm inicializador (`= null!`): em `recentOrders { items }` ou `recentOrders { customerNaive { orders } }` (entidades sem projeção) a resposta é um erro `HC0018` ("Cannot return null for non-nullable field"), em vez de uma lista vazia silenciosa que parecia dado real. Com projeção (`orders { items }`, `customer { orders }`) funcionam normalmente.
- **Introspecção sempre habilitada** (`DisableIntrospection(false)`). O padrão do Hot Chocolate 16 a desliga fora de `Development`, o que deixava o Nitro (e `__schema`) sem schema ao rodar a DLL em `Production`.
- O SDL (`/graphql?sdl`) tem os mesmos tipos e campos acima; o Hot Chocolate 16 acrescenta `@cost(weight)` em campos de resolver e ordena os campos de outra forma.
- **Custo do SQL da projeção aninhada (`AsSplitQuery`).** `customer(id){ orders{ items{ product } } }` em uma única consulta é gerado pelo EF Core com `LEFT JOIN` de subconsultas aninhadas. O SQLite não consegue "achatar" esse formato e materializa Orders × OrderItems × Products a cada execução (`EXPLAIN QUERY PLAN`: `MATERIALIZE s0`, `SCAN o`, `SCAN o0`), cerca de 5 ms por consulta, e o `graphql` do `nested` ficava mais lento que o `rest-bff` e até que as 1+1+N requisições REST (artefato do SQL gerado + planejador, não do protocolo). `GetCustomer` usa `AsSplitQuery()` (a projeção do Hot Chocolate respeita a opção): 3 consultas correlacionadas (cliente; pedidos; itens com produto), todas por índice. Medido no SQLite: `graphql` do `nested` cai de ~5 ms para menos de 1 ms (mesmo resultado do `rest-bff`, conferido campo a campo). No PostgreSQL a consulta única já era boa (`graphql` próximo do `rest-bff`); ali a divisão custa 3 idas e voltas (exemplo, 300 iterações: `graphql` 5,7 ms contra 2,6 ms do `rest-bff`, mas bem abaixo dos 13,1 ms das 1+1+N requisições REST; antes da divisão, o `graphql` ficava em ~3 ms, próximo do `rest-bff`). O contrato mantém a mesma contagem de SQL nos dois bancos (3). Para a apresentação: 1 requisição HTTP não é 1 consulta SQL, e o formato do SQL gerado pelo ORM muda o resultado.
