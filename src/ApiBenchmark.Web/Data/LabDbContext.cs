using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace ApiBenchmark.Web.Data;

public sealed class UtcDateTimeConverter() : ValueConverter<DateTime, DateTime>(
    v => v.Kind == DateTimeKind.Utc ? v : v.ToUniversalTime(),
    v => DateTime.SpecifyKind(v, DateTimeKind.Utc));

public class LabDbContext(DbContextOptions<LabDbContext> options) : DbContext(options)
{
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Supplier> Suppliers => Set<Supplier>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderItem> OrderItems => Set<OrderItem>();

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        configurationBuilder.Properties<DateTime>().HaveConversion<UtcDateTimeConverter>();
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Product>(e =>
        {
            e.Property(p => p.Price).HasPrecision(18, 2);
            e.HasOne(p => p.Category).WithMany().HasForeignKey(p => p.CategoryId);
            e.HasOne(p => p.Supplier).WithMany().HasForeignKey(p => p.SupplierId);
        });

        modelBuilder.Entity<Customer>(e =>
        {
            e.HasMany(c => c.Orders).WithOne(o => o.Customer).HasForeignKey(o => o.CustomerId);
        });

        modelBuilder.Entity<Order>(e =>
        {
            e.Property(o => o.Total).HasPrecision(18, 2);
            e.HasMany(o => o.Items).WithOne(i => i.Order).HasForeignKey(i => i.OrderId);
        });

        modelBuilder.Entity<OrderItem>(e =>
        {
            e.Property(i => i.UnitPrice).HasPrecision(18, 2);
            e.HasOne(i => i.Product).WithMany().HasForeignKey(i => i.ProductId);
        });
    }
}
