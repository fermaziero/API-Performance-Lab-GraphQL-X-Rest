using System.Text.Json;

namespace ApiBenchmark.Engine;

internal sealed record VariantDefinition(
    string Id,
    string Label,
    VariantKind Kind,
    string Description,
    string RequestPreview,
    Func<OperationContext, Task> ExecuteAsync,
    IReadOnlySet<string>? UsedFieldPaths);

internal sealed record ScenarioDefinition(
    string Id,
    string Title,
    string Description,
    string Need,
    IReadOnlyList<VariantDefinition> Variants,
    ScenarioDefaults? Defaults = null,
    int? MaxIterations = null,
    int? MaxConcurrency = null)
{
    public ScenarioInfo ToInfo() => new(
        Id,
        Title,
        Description,
        Need,
        Variants.Select(v => new VariantInfo(v.Id, v.Label, v.Kind, v.Description, v.RequestPreview)).ToList(),
        Defaults,
        MaxIterations,
        MaxConcurrency);
}

internal static class ScenarioCatalog
{
    private const int ProductId = 150;
    private const int CustomerId = 15;
    private const int OrdersTake = 50;
    private const int ProductsTake = 50;
    private const int VolumeTake = 100000;
    private const int VolumeIterations = 3;
    private const int VolumeWarmup = 0;
    private const int VolumeMaxIterations = 100;
    private const int VolumeMaxConcurrency = 2;

    private const string ProductFullQuery = """
        {
          product(id: 150) {
            id
            name
            description
            price
            stock
            sku
            createdAt
            updatedAt
            category {
              id
              name
              description
            }
            supplier {
              id
              name
              country
              contactEmail
            }
          }
        }
        """;

    private const string ProductCardQuery = """
        {
          product(id: 150) {
            name
            price
            sku
          }
        }
        """;

    private const string ProductListQuery = """
        {
          products(take: 50) {
            name
            price
            sku
          }
        }
        """;

    private const string ProductVolumeQuery = """
        {
          products(take: 100000) {
            name
            price
            sku
          }
        }
        """;

    private const string ProductVolumeFullQuery = """
        {
          products(take: 100000) {
            id
            name
            description
            price
            stock
            sku
            createdAt
            updatedAt
            category {
              id
              name
              description
            }
            supplier {
              id
              name
              country
              contactEmail
            }
          }
        }
        """;

    private const string CustomerNestedQuery = """
        {
          customer(id: 15) {
            name
            orders {
              date
              total
              items {
                product {
                  name
                  price
                }
              }
            }
          }
        }
        """;

    private const string OrdersNaiveQuery = """
        {
          recentOrders(take: 50) {
            id
            date
            total
            customerNaive {
              name
            }
          }
        }
        """;

    private const string OrdersDataLoaderQuery = """
        {
          recentOrders(take: 50) {
            id
            date
            total
            customerBatched {
              name
            }
          }
        }
        """;

    private const string OrdersProjectionQuery = """
        {
          orders(take: 50) {
            id
            date
            total
            customer {
              name
            }
          }
        }
        """;

    public static IReadOnlyList<ScenarioDefinition> All { get; } = Build();

    public static ScenarioDefinition? Find(string? id) =>
        id is null ? null : All.FirstOrDefault(s => string.Equals(s.Id, id, StringComparison.OrdinalIgnoreCase));

    private static IReadOnlyList<ScenarioDefinition> Build() =>
    [
        new ScenarioDefinition(
            "simple",
            "Consulta simples (mesmo payload)",
            "Busca um único produto pedindo exatamente os mesmos campos nos dois estilos. Isola o overhead do GraphQL " +
            "(parse, validação e execução da query) sobre uma leitura REST equivalente.",
            "A tela exibe todos os dados do produto 150: nome, descrição, preço, estoque, SKU, datas, categoria e fornecedor.",
            [
                new VariantDefinition(
                    "rest",
                    "REST (orientado a recursos)",
                    VariantKind.Rest,
                    "Uma requisição GET devolve o ProductDto completo.",
                    $"GET /api/products/{ProductId}",
                    ctx => ctx.GetAsync($"/api/products/{ProductId}"),
                    null),
                new VariantDefinition(
                    "graphql",
                    "GraphQL (todos os campos)",
                    VariantKind.Graphql,
                    "Uma query GraphQL pedindo todos os campos equivalentes ao ProductDto.",
                    ProductFullQuery,
                    ctx => ctx.GraphQLAsync(ProductFullQuery),
                    null),
            ]),

        new ScenarioDefinition(
            "overfetching",
            "Over-fetching (a tela só precisa de nome, preço e SKU)",
            "A mesma leitura de produto, mas a tela só usa três campos. O REST devolve o recurso inteiro; " +
            "o GraphQL pede só o necessário.",
            "A tela mostra apenas o nome, o preço e o SKU do produto 150.",
            [
                new VariantDefinition(
                    "rest",
                    "REST (recurso inteiro)",
                    VariantKind.Rest,
                    "GET devolve o ProductDto completo, mas a tela usa só name, price e sku.",
                    $"GET /api/products/{ProductId}",
                    ctx => ctx.GetAsync($"/api/products/{ProductId}"),
                    Paths("name", "price", "sku")),
                new VariantDefinition(
                    "graphql",
                    "GraphQL (só nome, preço e SKU)",
                    VariantKind.Graphql,
                    "A query pede somente name, price e sku.",
                    ProductCardQuery,
                    ctx => ctx.GraphQLAsync(ProductCardQuery),
                    Paths("product.name", "product.price", "product.sku")),
            ]),

        new ScenarioDefinition(
            "overfetching-list",
            "Over-fetching em lista (catálogo com 50 produtos)",
            "O mesmo desperdício do cenário anterior, multiplicado por 50: uma listagem de catálogo em que cada linha " +
            "só usa três campos. O REST devolve 50 recursos completos (com categoria e fornecedor); o GraphQL pede só as três colunas.",
            "A tela lista os 50 primeiros produtos mostrando apenas nome, preço e SKU de cada um.",
            [
                new VariantDefinition(
                    "rest",
                    "REST (50 recursos inteiros)",
                    VariantKind.Rest,
                    "GET devolve 50 ProductDto completos; a tela usa só name, price e sku de cada um.",
                    $"GET /api/products?take={ProductsTake}",
                    ctx => ctx.GetAsync($"/api/products?take={ProductsTake}"),
                    Paths("name", "price", "sku")),
                new VariantDefinition(
                    "graphql",
                    "GraphQL (só nome, preço e SKU)",
                    VariantKind.Graphql,
                    "A query pede somente name, price e sku dos 50 produtos; o SELECT traz só essas colunas.",
                    ProductListQuery,
                    ctx => ctx.GraphQLAsync(ProductListQuery),
                    Paths("products.name", "products.price", "products.sku")),
            ]),

        new ScenarioDefinition(
            "volume",
            "Carga em volume (100.000 produtos) — teste de estresse",
            "Teste de estresse: a tela pede os 100.000 produtos de uma só vez. Em produção os dois lados paginariam; " +
            "aqui o objetivo é ver o que o volume extremo faz com bytes trafegados, tempo de serialização e memória. " +
            "O REST devolve 100 mil recursos completos; o GraphQL pode pedir só as três colunas usadas ou todos os campos " +
            "(inclusive categoria e fornecedor), o que isola o custo do volume do custo do protocolo.",
            "A tela lista todos os 100.000 produtos mostrando apenas nome, preço e SKU de cada um.",
            [
                new VariantDefinition(
                    "rest",
                    "REST (100 mil recursos inteiros)",
                    VariantKind.Rest,
                    "GET devolve 100.000 ProductDto completos (com categoria e fornecedor); a tela usa só name, price e sku de cada um.",
                    $"GET /api/products?take={VolumeTake}",
                    ctx => ctx.GetAsync($"/api/products?take={VolumeTake}"),
                    Paths("name", "price", "sku")),
                new VariantDefinition(
                    "graphql",
                    "GraphQL (só nome, preço e SKU)",
                    VariantKind.Graphql,
                    "A query pede somente name, price e sku dos 100.000 produtos; o SELECT traz só essas colunas.",
                    ProductVolumeQuery,
                    ctx => ctx.GraphQLAsync(ProductVolumeQuery),
                    Paths("products.name", "products.price", "products.sku")),
                new VariantDefinition(
                    "graphql-full",
                    "GraphQL (todos os campos)",
                    VariantKind.Graphql,
                    "A query pede todos os campos equivalentes ao ProductDto, inclusive category e supplier: " +
                    "mesmo payload do REST, para separar o custo do volume do custo do protocolo.",
                    ProductVolumeFullQuery,
                    ctx => ctx.GraphQLAsync(ProductVolumeFullQuery),
                    Paths("products.name", "products.price", "products.sku")),
            ],
            new ScenarioDefaults(VolumeIterations, VolumeWarmup),
            VolumeMaxIterations,
            VolumeMaxConcurrency),

        new ScenarioDefinition(
            "nested",
            "Relacionamentos (cliente → pedidos → itens → produto)",
            "A tela precisa de um grafo de dados: cliente, seus pedidos, os itens de cada pedido e o produto de cada item. " +
            "Compara várias requisições REST, um endpoint sob medida (BFF) e uma única query GraphQL.",
            "A tela mostra o nome do cliente 15, a data e o total de cada pedido e, para cada item, o nome e o preço do produto.",
            [
                new VariantDefinition(
                    "rest",
                    "REST (orientado a recursos)",
                    VariantKind.Rest,
                    "1 requisição para o cliente, 1 para os pedidos e 1 para os itens de cada pedido (1+1+N). " +
                    "Sequencial, ou com os itens em paralelo quando 'restParallel' está ligado.",
                    $"GET /api/customers/{CustomerId}\nGET /api/customers/{CustomerId}/orders\nGET /api/orders/{{id}}/items  (×N)",
                    NestedRestAsync,
                    Paths("name", "date", "total", "product.name", "product.price")),
                new VariantDefinition(
                    "rest-bff",
                    "REST (endpoint sob medida / BFF)",
                    VariantKind.Rest,
                    "Um endpoint feito sob medida para a tela devolve só o que ela usa, em uma requisição.",
                    $"GET /api/customers/{CustomerId}/summary",
                    ctx => ctx.GetAsync($"/api/customers/{CustomerId}/summary"),
                    Paths("name", "orders.date", "orders.total", "orders.items.product.name", "orders.items.product.price")),
                new VariantDefinition(
                    "graphql",
                    "GraphQL (uma query)",
                    VariantKind.Graphql,
                    "Uma única query navega cliente → pedidos → itens → produto e pede só os campos usados.",
                    CustomerNestedQuery,
                    ctx => ctx.GraphQLAsync(CustomerNestedQuery),
                    Paths(
                        "customer.name",
                        "customer.orders.date",
                        "customer.orders.total",
                        "customer.orders.items.product.name",
                        "customer.orders.items.product.price")),
            ]),

        new ScenarioDefinition(
            "nplus1",
            "N+1 no servidor GraphQL (50 pedidos + nome do cliente)",
            "Lista 50 pedidos com o nome do cliente de cada um. No GraphQL, a forma como o servidor resolve o campo " +
            "'customer' muda drasticamente o número de consultas SQL: resolver ingênuo (N+1), DataLoader (lote) ou projeção (JOIN).",
            "A tela lista os 50 primeiros pedidos (id, data e total) com o nome do cliente de cada um.",
            [
                new VariantDefinition(
                    "rest",
                    "REST (pedidos com cliente)",
                    VariantKind.Rest,
                    "Um endpoint devolve os pedidos já com o cliente embutido (1 SQL com JOIN).",
                    $"GET /api/orders?take={OrdersTake}",
                    ctx => ctx.GetAsync($"/api/orders?take={OrdersTake}"),
                    Paths("id", "date", "total", "customer.name")),
                new VariantDefinition(
                    "graphql-naive",
                    "GraphQL (resolver ingênuo)",
                    VariantKind.Graphql,
                    "Cada pedido dispara um SELECT próprio para buscar o cliente: 1 + N consultas SQL.",
                    OrdersNaiveQuery,
                    ctx => ctx.GraphQLAsync(OrdersNaiveQuery),
                    Paths("recentOrders.id", "recentOrders.date", "recentOrders.total", "recentOrders.customerNaive.name")),
                new VariantDefinition(
                    "graphql-dataloader",
                    "GraphQL (DataLoader)",
                    VariantKind.Graphql,
                    "Os clientes dos 50 pedidos são buscados em lote: 2 consultas SQL.",
                    OrdersDataLoaderQuery,
                    ctx => ctx.GraphQLAsync(OrdersDataLoaderQuery),
                    Paths("recentOrders.id", "recentOrders.date", "recentOrders.total", "recentOrders.customerBatched.name")),
                new VariantDefinition(
                    "graphql-projection",
                    "GraphQL (projeção)",
                    VariantKind.Graphql,
                    "A árvore da query vira uma projeção EF Core: o cliente entra por JOIN em uma única consulta SQL.",
                    OrdersProjectionQuery,
                    ctx => ctx.GraphQLAsync(OrdersProjectionQuery),
                    Paths("orders.id", "orders.date", "orders.total", "orders.customer.name")),
            ]),
    ];

    private static async Task NestedRestAsync(OperationContext ctx)
    {
        await ctx.GetAsync($"/api/customers/{CustomerId}").ConfigureAwait(false);

        var orders = await ctx.GetAsync($"/api/customers/{CustomerId}/orders").ConfigureAwait(false);
        if (!orders.Success)
        {
            return;
        }

        var orderIds = ReadOrderIds(orders.Body);
        if (orderIds is null)
        {
            ctx.MarkError("Resposta de pedidos não é um array JSON de objetos com 'id'.");
            return;
        }

        if (ctx.RestParallel)
        {
            await Task.WhenAll(orderIds.Select(id => ctx.GetAsync($"/api/orders/{id}/items"))).ConfigureAwait(false);
            return;
        }

        foreach (var id in orderIds)
        {
            await ctx.GetAsync($"/api/orders/{id}/items").ConfigureAwait(false);
        }
    }

    private static int[]? ReadOrderIds(byte[] body)
    {
        try
        {
            using var document = JsonDocument.Parse(body);
            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                return null;
            }

            var ids = new List<int>(document.RootElement.GetArrayLength());
            foreach (var order in document.RootElement.EnumerateArray())
            {
                if (order.ValueKind != JsonValueKind.Object ||
                    !order.TryGetProperty("id", out var id) ||
                    !id.TryGetInt32(out var value))
                {
                    return null;
                }

                ids.Add(value);
            }

            return [.. ids];
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static IReadOnlySet<string> Paths(params string[] paths) =>
        new HashSet<string>(paths, StringComparer.Ordinal);
}
