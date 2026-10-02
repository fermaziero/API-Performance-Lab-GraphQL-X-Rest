using System.Diagnostics;
using System.Text.Json;
using ApiBenchmark.Engine;
using ApiBenchmark.Web;
using ApiBenchmark.Web.Data;
using ApiBenchmark.Web.GraphQL;
using ApiBenchmark.Web.Rest;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

var contentRoot = ContentRootResolver.Resolve();
if (contentRoot is null)
{
    Console.Error.WriteLine("Aviso: wwwroot/index.html não encontrado; o dashboard não será servido. Execute a partir de src/ApiBenchmark.Web.");
}

var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = args, ContentRootPath = contentRoot });

var hasExplicitUrls = !string.IsNullOrWhiteSpace(builder.Configuration["urls"])
    || !string.IsNullOrWhiteSpace(builder.Configuration["http_ports"])
    || !string.IsNullOrWhiteSpace(builder.Configuration["https_ports"]);
if (!hasExplicitUrls)
{
    builder.WebHost.UseUrls("http://localhost:5080");
}

DatabaseSettings database;
int productTarget;
try
{
    database = DatabaseSettings.FromConfiguration(builder.Configuration, builder.Environment.ContentRootPath);
    productTarget = DbSeeder.ResolveProductTarget(builder.Configuration);
}
catch (DatabaseSetupException ex)
{
    Console.Error.WriteLine(ex.Message);
    return 1;
}

builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase);

builder.Services.AddSingleton(database);
builder.Services.AddSingleton<SqlCommandCounter>();
builder.Services.AddPooledDbContextFactory<LabDbContext>((sp, options) =>
    database.Configure(options)
        .AddInterceptors(sp.GetRequiredService<SqlCommandCounter>())
        .ConfigureWarnings(w => w.Ignore(CoreEventId.RowLimitingOperationWithoutOrderByWarning, RelationalEventId.MultipleCollectionIncludeWarning)));
builder.Services.AddScoped(sp => sp.GetRequiredService<IDbContextFactory<LabDbContext>>().CreateDbContext());

builder.Services
    .AddGraphQLServer()
    .AddQueryType<Query>()
    .AddType<ProductType>()
    .AddType<OrderType>()
    .AddType<OrderItemType>()
    .AddTypeExtension<OrderExtensions>()
    .AddDataLoader<CustomerByIdDataLoader>()
    .AddProjections()
    .RegisterDbContextFactory<LabDbContext>()
    .DisableIntrospection(false)
    .ModifyRequestOptions(o =>
    {
        o.IncludeExceptionDetails = false;
        o.ExecutionTimeout = TimeSpan.FromMinutes(5);
    });

builder.Services.AddSingleton<ISqlCommandProbe, SqlCommandProbe>();
builder.Services.AddBenchmarkEngine();

var app = builder.Build();

try
{
    await database.EnsureReachableAsync();
}
catch (DatabaseSetupException ex)
{
    Console.Error.WriteLine(ex.Message);
    return 1;
}

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<LabDbContext>();
    var seedClock = Stopwatch.StartNew();
    var seeded = await DbSeeder.SeedAsync(db, productTarget);
    if (seeded > 0)
    {
        Console.WriteLine($"Seed: {seeded} produtos inseridos em {seedClock.Elapsed.TotalSeconds:F1} s.");
    }
}

Console.WriteLine($"Banco de dados: {database.Describe()}");

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapRestEndpoints();
app.MapGraphQL();

app.MapBenchmarkEndpoints();

app.Run();
return 0;

public partial class Program { }
