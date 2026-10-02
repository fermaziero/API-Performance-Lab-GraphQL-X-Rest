using ApiBenchmark.Web.Data;
using Microsoft.EntityFrameworkCore;

namespace ApiBenchmark.Web.GraphQL;

public sealed class CustomerByIdDataLoader(
    IDbContextFactory<LabDbContext> dbFactory,
    IBatchScheduler batchScheduler,
    DataLoaderOptions options)
    : BatchDataLoader<int, Customer>(batchScheduler, options)
{
    protected override async Task<IReadOnlyDictionary<int, Customer>> LoadBatchAsync(
        IReadOnlyList<int> keys,
        CancellationToken ct)
    {
        await using var db = await dbFactory.CreateDbContextAsync(ct);
        return await db.Customers.AsNoTracking()
            .Where(c => keys.Contains(c.Id))
            .ToDictionaryAsync(c => c.Id, ct);
    }
}
