using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace ApiBenchmark.Engine;

internal static class LabEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/lab");

        group.MapGet("/scenarios", (BenchmarkService service) =>
            Json(service.GetScenarios()));

        group.MapPost("/runs", async (HttpContext http, BenchmarkService service) =>
        {
            StartRunRequest? request;
            try
            {
                request = await JsonSerializer.DeserializeAsync<StartRunRequest>(
                    http.Request.Body, EngineJson.Options, http.RequestAborted);
            }
            catch (JsonException)
            {
                return Json(new ErrorResponse("JSON inválido no corpo da requisição."), StatusCodes.Status400BadRequest);
            }

            var result = service.Start(request);
            return result.Outcome switch
            {
                StartOutcome.Started => Json(new StartRunResponse(result.RunId!), StatusCodes.Status202Accepted),
                StartOutcome.Conflict => Json(new ErrorResponse(result.Error!), StatusCodes.Status409Conflict),
                _ => Json(new ErrorResponse(result.Error!), StatusCodes.Status400BadRequest),
            };
        });

        group.MapGet("/runs", (HttpContext http, BenchmarkService service) =>
        {
            NoStore(http);
            return Json(service.List());
        });

        group.MapGet("/runs/{runId}", (string runId, HttpContext http, BenchmarkService service) =>
        {
            NoStore(http);
            var snapshot = service.Get(runId);
            return snapshot is null
                ? Json(new ErrorResponse($"Run '{runId}' não encontrado."), StatusCodes.Status404NotFound)
                : Json(snapshot);
        });

        group.MapPost("/runs/{runId}/cancel", (string runId, BenchmarkService service) =>
            service.Cancel(runId)
                ? Json(new StartRunResponse(runId), StatusCodes.Status202Accepted)
                : Json(new ErrorResponse($"Run '{runId}' não encontrado."), StatusCodes.Status404NotFound));
    }

    private static IResult Json(object value, int? statusCode = null) =>
        Results.Json(value, EngineJson.Options, null, statusCode);

    private static void NoStore(HttpContext http) =>
        http.Response.Headers.CacheControl = "no-store";
}
