using System.Runtime.InteropServices;
using ApiBenchmark.Web.Data;
using Microsoft.EntityFrameworkCore;

namespace ApiBenchmark.Web.Rest;

public static class RestEndpoints
{
    public static IEndpointRouteBuilder MapRestEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        api.MapGet("/products/{id:int}", async (int id, LabDbContext db, CancellationToken ct) =>
        {
            var product = await db.Products.AsNoTracking()
                .Where(p => p.Id == id)
                .Select(p => new ProductDto(
                    p.Id, p.Name, p.Description, p.Price, p.Stock, p.Sku, p.CreatedAt, p.UpdatedAt,
                    new CategoryDto(p.Category.Id, p.Category.Name, p.Category.Description),
                    new SupplierDto(p.Supplier.Id, p.Supplier.Name, p.Supplier.Country, p.Supplier.ContactEmail)))
                .FirstOrDefaultAsync(ct);
            return product is null ? Results.NotFound() : Results.Ok(product);
        });

        api.MapGet("/products", async (LabDbContext db, CancellationToken ct, int skip = 0, int take = 20) =>
        {
            var products = await db.Products.AsNoTracking()
                .OrderBy(p => p.Id)
                .Skip(PagingRules.Skip(skip))
                .Take(PagingRules.Take(take))
                .Select(p => new ProductDto(
                    p.Id, p.Name, p.Description, p.Price, p.Stock, p.Sku, p.CreatedAt, p.UpdatedAt,
                    new CategoryDto(p.Category.Id, p.Category.Name, p.Category.Description),
                    new SupplierDto(p.Supplier.Id, p.Supplier.Name, p.Supplier.Country, p.Supplier.ContactEmail)))
                .ToListAsync(ct);
            return Results.Ok(products);
        });

        api.MapGet("/customers/{id:int}", async (int id, LabDbContext db, CancellationToken ct) =>
        {
            var customer = await db.Customers.AsNoTracking()
                .Where(c => c.Id == id)
                .Select(c => new CustomerDto(c.Id, c.Name, c.Email, c.City, c.CreatedAt))
                .FirstOrDefaultAsync(ct);
            return customer is null ? Results.NotFound() : Results.Ok(customer);
        });

        api.MapGet("/customers/{id:int}/orders", async (int id, LabDbContext db, CancellationToken ct) =>
        {
            var orders = await db.Orders.AsNoTracking()
                .Where(o => o.CustomerId == id)
                .OrderBy(o => o.Id)
                .Select(o => new OrderDto(o.Id, o.CustomerId, o.Date, o.Total, o.Status))
                .ToListAsync(ct);
            return Results.Ok(orders);
        });

        api.MapGet("/orders/{id:int}/items", async (int id, LabDbContext db, CancellationToken ct) =>
        {
            var items = await db.OrderItems.AsNoTracking()
                .Where(i => i.OrderId == id)
                .OrderBy(i => i.Id)
                .Select(i => new OrderItemDto(
                    i.Id, i.OrderId, i.Quantity, i.UnitPrice,
                    new ProductResourceDto(
                        i.Product.Id, i.Product.Name, i.Product.Description, i.Product.Price,
                        i.Product.Stock, i.Product.Sku, i.Product.CreatedAt, i.Product.UpdatedAt)))
                .ToListAsync(ct);
            return Results.Ok(items);
        });

        api.MapGet("/orders", async (LabDbContext db, CancellationToken ct, int take = 50) =>
        {
            var orders = await db.Orders.AsNoTracking()
                .OrderBy(o => o.Id)
                .Take(PagingRules.Take(take))
                .Select(o => new OrderWithCustomerDto(
                    o.Id, o.CustomerId, o.Date, o.Total, o.Status,
                    new CustomerDto(o.Customer.Id, o.Customer.Name, o.Customer.Email, o.Customer.City, o.Customer.CreatedAt)))
                .ToListAsync(ct);
            return Results.Ok(orders);
        });

        api.MapGet("/customers/{id:int}/summary", async (int id, LabDbContext db, CancellationToken ct) =>
        {
            var rows = await (
                from c in db.Customers.AsNoTracking()
                where c.Id == id
                from o in db.Orders.Where(o => o.CustomerId == c.Id).DefaultIfEmpty()
                from i in db.OrderItems.Where(i => i.OrderId == o!.Id).DefaultIfEmpty()
                orderby o!.Id, i!.Id
                select new SummaryRow(
                    c.Name,
                    (int?)o!.Id,
                    o!.Date,
                    o!.Total,
                    (int?)i!.Id,
                    i!.Product.Name,
                    i!.Product.Price))
                .ToListAsync(ct);

            if (rows.Count == 0)
            {
                return Results.NotFound();
            }

            var orders = new List<SummaryOrderDto>();
            SummaryOrderDto? current = null;
            int? currentOrderId = null;
            foreach (var row in rows)
            {
                if (row.OrderId is null)
                {
                    continue;
                }

                if (current is null || row.OrderId != currentOrderId)
                {
                    current = new SummaryOrderDto(row.OrderDate!.Value, row.OrderTotal!.Value, []);
                    currentOrderId = row.OrderId;
                    orders.Add(current);
                }

                if (row.ItemId is not null)
                {
                    current.Items.Add(new SummaryItemDto(new SummaryProductDto(row.ProductName!, row.ProductPrice!.Value)));
                }
            }

            return Results.Ok(new CustomerSummaryDto(rows[0].CustomerName, orders));
        });

        api.MapGet("/info", async (LabDbContext db, IWebHostEnvironment env, DatabaseSettings settings, CancellationToken ct) =>
        {
            var database = new DatabaseInfoDto(
                await db.Categories.CountAsync(ct),
                await db.Suppliers.CountAsync(ct),
                await db.Products.CountAsync(ct),
                await db.Customers.CountAsync(ct),
                await db.Orders.CountAsync(ct),
                await db.OrderItems.CountAsync(ct));
            return Results.Ok(new ServerInfoDto(
                Environment.Version.ToString(),
                RuntimeInformation.OSDescription,
                Environment.ProcessorCount,
                env.EnvironmentName,
                settings.Name,
                "/graphql",
                database));
        });

        api.MapGet("/diagnostics/sql-count", (SqlCommandCounter counter) => Results.Ok(new SqlCountDto(counter.Count)));

        return app;
    }
}

internal sealed record SummaryRow(
    string CustomerName,
    int? OrderId,
    DateTime? OrderDate,
    decimal? OrderTotal,
    int? ItemId,
    string? ProductName,
    decimal? ProductPrice);
