using ApiBenchmark.Web.Data;
using HotChocolate.Data;
using Microsoft.EntityFrameworkCore;

namespace ApiBenchmark.Web.GraphQL;

public class Query
{
    [UseFirstOrDefault]
    [UseProjection]
    public IQueryable<Product> GetProduct(LabDbContext db, int id)
        => db.Products.AsNoTracking().Where(p => p.Id == id);

    [UseProjection]
    public IQueryable<Product> GetProducts(LabDbContext db, int skip = 0, int take = 20)
        => db.Products.AsNoTracking().OrderBy(p => p.Id).Skip(PagingRules.Skip(skip)).Take(PagingRules.Take(take));

    [UseFirstOrDefault]
    [UseProjection]
    public IQueryable<Customer> GetCustomer(LabDbContext db, int id)
        => db.Customers.AsNoTracking().AsSplitQuery().Where(c => c.Id == id);

    [UseProjection]
    public IQueryable<Order> GetOrders(LabDbContext db, int take = 50)
        => db.Orders.AsNoTracking().OrderBy(o => o.Id).Take(PagingRules.Take(take));

    public async Task<List<Order>> GetRecentOrders(LabDbContext db, CancellationToken ct, int take = 50)
        => await db.Orders.AsNoTracking().OrderBy(o => o.Id).Take(PagingRules.Take(take)).ToListAsync(ct);
}
