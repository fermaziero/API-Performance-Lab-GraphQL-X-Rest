using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace ApiBenchmark.Engine;

public static class BenchmarkEngineExtensions
{
    public static IServiceCollection AddBenchmarkEngine(this IServiceCollection services)
    {
        services.AddSingleton<BenchmarkService>();
        return services;
    }

    public static IEndpointRouteBuilder MapBenchmarkEndpoints(this IEndpointRouteBuilder app)
    {
        LabEndpoints.Map(app);
        return app;
    }
}
