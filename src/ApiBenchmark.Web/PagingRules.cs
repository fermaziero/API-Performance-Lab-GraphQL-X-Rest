namespace ApiBenchmark.Web;

// Mesma regra de paginação para REST e GraphQL: o valor é ajustado, não rejeitado.
public static class PagingRules
{
    public const int MaxTake = 100_000;

    public static int Skip(int skip) => Math.Max(skip, 0);

    public static int Take(int take) => Math.Clamp(take, 0, MaxTake);
}
