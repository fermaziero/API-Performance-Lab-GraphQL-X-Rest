# Adendo ao contrato — padrões por cenário e carga em volume

Complementa `docs/CONTRATO.md`. O que já foi implementado (rede simulada, 100.000 produtos, varredura de rede, glossário e rótulos de rede no dashboard)
foi incorporado ao contrato principal. Fica aqui só o que ainda NÃO foi feito; ao concluir, incorporar ao contrato e remover este arquivo.

## 2. Padrões e limite por cenário

`GET /api/lab/scenarios` ganha, em cada cenário:

```jsonc
"defaults": { "iterations": 10, "warmup": 1 },   // ou null: usa a escolha geral do usuário
"maxIterations": 100                              // ou null: vale o limite global (10000)
```

`POST /api/lab/runs` com `iterations` acima do `maxIterations` do cenário → `400 { "error": "..." }`.

Estado atual: o servidor ainda NÃO devolve esses campos. O dashboard já os lê com tolerância (a varredura de rede limita as iterações a `maxIterations` quando ele existir).

## 3. Cenário novo: `volume`

| id | Título | Variantes |
|---|---|---|
| `volume` | Carga em volume (100.000 produtos) — teste de estresse | `rest` — `GET /api/products?take=100000` (100 mil `ProductDto` completos) · `graphql` — `products(take: 100000) { name price sku }` · `graphql-full` — `products(take: 100000)` pedindo TODOS os campos equivalentes ao `ProductDto` (inclusive `category` e `supplier`) |

- A tela usa `name`, `price`, `sku` de cada produto (vale para as três variantes na métrica de campos).
- `defaults = { iterations: 10, warmup: 1 }`, `maxIterations = 100`. Ajustar o padrão para que um run completo leve no máximo ~45 s nesta máquina
  (referência medida na base: uma consulta REST completa leva 3 a 4 s no SQLite em Debug; ver "Consultas de 100 mil produtos" em `CONTRATO.md`).
- Posição: depois de `overfetching-list`, antes de `nested`.
- A descrição deixa explícito que é teste de estresse: em produção os dois lados paginariam.
- `sampleResponse` de corpos grandes: NÃO identar o corpo inteiro; produzir o trecho inicial identado e truncado em 4000 chars de forma barata.
  A contagem de `fields` continua sendo feita sobre a amostra completa.
- O motor não pode reter os corpos das operações medidas (dezenas de MB cada) além do necessário.
- Memória: o servidor chega a ~3,5 GB com 8 clientes completos em paralelo; sugerir/limitar a concorrência desse cenário.

## 5. Dashboard — o que falta

- **Padrões por cenário**: ao selecionar um cenário com `defaults`, os campos de iterações/warm-up assumem esses valores e a tela avisa
  ("cenário pesado: sugerido 10 iterações, máximo 100"); ao sair, volta a escolha geral do usuário. "Executar todos" respeita `defaults`/`maxIterations`.
