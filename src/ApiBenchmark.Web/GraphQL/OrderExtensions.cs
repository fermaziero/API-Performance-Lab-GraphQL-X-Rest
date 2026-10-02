using ApiBenchmark.Web.Data;
using Microsoft.EntityFrameworkCore;

namespace ApiBenchmark.Web.GraphQL;

[ExtendObjectType(typeof(Order))]
public class OrderExtensions
{
    // N+1 proposital: um SELECT por pedido, sem DataLoader.
    public async Task<Customer> GetCustomerNaive([Parent] Order order, LabDbContext db, CancellationToken ct)
    {
        var customerId = RequireCustomerId(order);
        return await db.Customers.AsNoTracking().SingleAsync(c => c.Id == customerId, ct);
    }

    public async Task<Customer> GetCustomerBatched([Parent] Order order, CustomerByIdDataLoader loader, CancellationToken ct)
        => (await loader.LoadAsync(RequireCustomerId(order), ct))!;

    // CustomerId não faz parte do schema; só vem carregado em consultas sem projeção (recentOrders).
    private static int RequireCustomerId(Order order)
        => order.CustomerId != 0
            ? order.CustomerId
            : throw new GraphQLException("customerNaive e customerBatched devem ser usados a partir de recentOrders (sem projeção).");
}
