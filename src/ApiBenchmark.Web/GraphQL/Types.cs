using ApiBenchmark.Web.Data;

namespace ApiBenchmark.Web.GraphQL;

public sealed class ProductType : ObjectType<Product>
{
    protected override void Configure(IObjectTypeDescriptor<Product> descriptor)
    {
        descriptor.Ignore(p => p.CategoryId);
        descriptor.Ignore(p => p.SupplierId);
    }
}

public sealed class OrderType : ObjectType<Order>
{
    protected override void Configure(IObjectTypeDescriptor<Order> descriptor)
    {
        descriptor.Ignore(o => o.CustomerId);
    }
}

public sealed class OrderItemType : ObjectType<OrderItem>
{
    protected override void Configure(IObjectTypeDescriptor<OrderItem> descriptor)
    {
        descriptor.Ignore(i => i.OrderId);
        descriptor.Ignore(i => i.ProductId);
        descriptor.Ignore(i => i.Order);
    }
}
