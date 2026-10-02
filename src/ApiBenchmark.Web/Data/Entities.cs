namespace ApiBenchmark.Web.Data;

public class Category
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
}

public class Supplier
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Country { get; set; } = "";
    public string ContactEmail { get; set; } = "";
}

public class Product
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public decimal Price { get; set; }
    public int Stock { get; set; }
    public string Sku { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public int CategoryId { get; set; }
    public Category Category { get; set; } = null!;
    public int SupplierId { get; set; }
    public Supplier Supplier { get; set; } = null!;
}

public class Customer
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string City { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    // Sem inicializador de propósito: fora de uma projeção, pedir o campo no GraphQL falha em vez de devolver lista vazia em silêncio.
    public List<Order> Orders { get; set; } = null!;
}

public class Order
{
    public int Id { get; set; }
    public int CustomerId { get; set; }
    public Customer Customer { get; set; } = null!;
    public DateTime Date { get; set; }
    public decimal Total { get; set; }
    public string Status { get; set; } = "";
    // Mesmo motivo de Customer.Orders.
    public List<OrderItem> Items { get; set; } = null!;
}

public class OrderItem
{
    public int Id { get; set; }
    public int OrderId { get; set; }
    public Order Order { get; set; } = null!;
    public int ProductId { get; set; }
    public Product Product { get; set; } = null!;
    public int Quantity { get; set; }
    public decimal UnitPrice { get; set; }
}
