namespace ApiBenchmark.Web.Rest;

public record CategoryDto(int Id, string Name, string Description);

public record SupplierDto(int Id, string Name, string Country, string ContactEmail);

public record ProductDto(
    int Id,
    string Name,
    string Description,
    decimal Price,
    int Stock,
    string Sku,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    CategoryDto Category,
    SupplierDto Supplier);

public record ProductResourceDto(
    int Id,
    string Name,
    string Description,
    decimal Price,
    int Stock,
    string Sku,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public record CustomerDto(int Id, string Name, string Email, string City, DateTime CreatedAt);

public record OrderDto(int Id, int CustomerId, DateTime Date, decimal Total, string Status);

public record OrderItemDto(int Id, int OrderId, int Quantity, decimal UnitPrice, ProductResourceDto Product);

public record OrderWithCustomerDto(int Id, int CustomerId, DateTime Date, decimal Total, string Status, CustomerDto Customer);

public record SummaryProductDto(string Name, decimal Price);

public record SummaryItemDto(SummaryProductDto Product);

public record SummaryOrderDto(DateTime Date, decimal Total, List<SummaryItemDto> Items);

public record CustomerSummaryDto(string Name, List<SummaryOrderDto> Orders);

public record DatabaseInfoDto(int Categories, int Suppliers, int Products, int Customers, int Orders, int OrderItems);

public record ServerInfoDto(
    string DotnetVersion,
    string Os,
    int ProcessorCount,
    string Environment,
    string DatabaseProvider,
    string GraphqlEndpoint,
    DatabaseInfoDto Database);

public record SqlCountDto(long Count);
