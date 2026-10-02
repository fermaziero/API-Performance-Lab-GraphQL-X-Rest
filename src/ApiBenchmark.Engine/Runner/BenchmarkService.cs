using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ApiBenchmark.Engine;

internal enum StartOutcome { Started, Invalid, Conflict }

internal readonly record struct StartResult(StartOutcome Outcome, string? RunId, string? Error);

internal sealed class BenchmarkService : IDisposable
{
    public const int HistoryLimit = 20;
    public const int MaxIterations = 10000;
    public const int MaxWarmup = 1000;
    public const int MaxConcurrency = 32;
    public const int MaxSimulatedLatencyMs = 1000;
    public const double MinSimulatedBandwidthMbps = 0.1;
    public const double MaxSimulatedBandwidthMbps = 10000;

    private const int DefaultIterations = 1000;
    private const int DefaultWarmup = 50;
    private const int DefaultConcurrency = 1;

    private readonly object _lock = new();
    private readonly object _clientLock = new();
    private readonly List<RunState> _history = [];
    private readonly ConcurrentDictionary<string, byte> _seenVariants = new();
    private readonly IServiceProvider _services;
    private readonly IConfiguration _configuration;
    private readonly ILogger<BenchmarkService> _logger;

    private RunState? _current;
    private HttpClient? _client;
    private PreciseDelayScheduler? _scheduler;
    private int _connectionPrimed;

    public BenchmarkService(
        IServiceProvider services,
        IConfiguration configuration,
        IHostApplicationLifetime lifetime,
        ILogger<BenchmarkService> logger)
    {
        _services = services;
        _configuration = configuration;
        _logger = logger;
        lifetime.ApplicationStopping.Register(CancelAll);
    }

    public IReadOnlyList<ScenarioInfo> GetScenarios() => ScenarioCatalog.All.Select(s => s.ToInfo()).ToList();

    public StartResult Start(StartRunRequest? request)
    {
        if (!TryValidate(request, out var scenario, out var config, out var error))
        {
            return new StartResult(StartOutcome.Invalid, null, error);
        }

        RunState state;
        lock (_lock)
        {
            if (_current is { IsRunning: true } running)
            {
                return new StartResult(
                    StartOutcome.Conflict,
                    running.RunId,
                    $"Já existe um run em execução ({running.RunId}). Aguarde o término ou cancele-o.");
            }

            state = new RunState(Guid.NewGuid().ToString("N")[..12], scenario!, config!);
            _current = state;
            _history.Insert(0, state);
            if (_history.Count > HistoryLimit)
            {
                _history.RemoveRange(HistoryLimit, _history.Count - HistoryLimit);
            }
        }

        _ = Task.Run(() => ExecuteAsync(state));
        return new StartResult(StartOutcome.Started, state.RunId, null);
    }

    public RunSnapshot? Get(string runId)
    {
        RunState? state;
        lock (_lock)
        {
            state = _history.FirstOrDefault(r => r.RunId == runId);
        }

        return state?.Snapshot(detail: true);
    }

    public IReadOnlyList<RunSnapshot> List()
    {
        RunState[] states;
        lock (_lock)
        {
            states = [.. _history];
        }

        return states.Select(s => s.Snapshot(detail: false)).ToList();
    }

    public bool Cancel(string runId)
    {
        RunState? state;
        lock (_lock)
        {
            state = _history.FirstOrDefault(r => r.RunId == runId);
        }

        if (state is null)
        {
            return false;
        }

        if (state.IsRunning)
        {
            state.Cts.Cancel();
        }

        return true;
    }

    public void Dispose()
    {
        CancelAll();
        lock (_clientLock)
        {
            _client?.Dispose();
            _client = null;
            _scheduler?.Dispose();
            _scheduler = null;
        }
    }

    internal static bool TryValidate(
        StartRunRequest? request,
        out ScenarioDefinition? scenario,
        out RunConfig? config,
        out string? error)
    {
        scenario = null;
        config = null;

        if (request is null)
        {
            error = "Corpo da requisição ausente ou inválido.";
            return false;
        }

        if (string.IsNullOrWhiteSpace(request.ScenarioId))
        {
            error = "O campo 'scenarioId' é obrigatório.";
            return false;
        }

        scenario = ScenarioCatalog.Find(request.ScenarioId.Trim());
        if (scenario is null)
        {
            var known = string.Join(", ", ScenarioCatalog.All.Select(s => s.Id));
            error = $"Cenário desconhecido: '{request.ScenarioId}'. Cenários disponíveis: {known}.";
            return false;
        }

        var iterations = request.Iterations ?? DefaultIterations;
        var warmup = request.Warmup ?? DefaultWarmup;
        var concurrency = request.Concurrency ?? DefaultConcurrency;

        if (iterations is < 1 or > MaxIterations)
        {
            error = $"'iterations' deve estar entre 1 e {MaxIterations}.";
            return false;
        }

        if (warmup is < 0 or > MaxWarmup)
        {
            error = $"'warmup' deve estar entre 0 e {MaxWarmup}.";
            return false;
        }

        if (concurrency is < 1 or > MaxConcurrency)
        {
            error = $"'concurrency' deve estar entre 1 e {MaxConcurrency}.";
            return false;
        }

        var latency = request.SimulatedLatencyMs ?? 0;
        if (double.IsNaN(latency) || latency < 0 || latency > MaxSimulatedLatencyMs || latency != Math.Floor(latency))
        {
            error = $"'simulatedLatencyMs' deve ser um inteiro entre 0 e {MaxSimulatedLatencyMs}.";
            return false;
        }

        var bandwidth = request.SimulatedBandwidthMbps;
        if (bandwidth is { } mbps && !(mbps >= MinSimulatedBandwidthMbps && mbps <= MaxSimulatedBandwidthMbps))
        {
            error = "'simulatedBandwidthMbps' deve ser null (sem limite) ou estar entre 0.1 e 10000.";
            return false;
        }

        config = new RunConfig(iterations, warmup, concurrency, request.RestParallel ?? false, (int)latency, bandwidth);
        error = null;
        return true;
    }

    private async Task ExecuteAsync(RunState state)
    {
        var status = RunStatus.Completed;
        string? error = null;
        IServiceScope? scope = null;

        try
        {
            scope = _services.CreateScope();
            var probe = scope.ServiceProvider.GetService<ISqlCommandProbe>();
            var client = GetClient();
            await PrimeConnectionAsync(client, state.Cts.Token).ConfigureAwait(false);

            var network = NetworkSimulation.Create(state.Config, GetScheduler);
            var runner = new BenchmarkRunner(state, client, probe, network, _seenVariants);
            await runner.RunAsync(state.Cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (state.Cts.IsCancellationRequested)
        {
            status = RunStatus.Cancelled;
        }
        catch (Exception ex)
        {
            status = RunStatus.Failed;
            error = ex.Message;
            _logger.LogWarning("Run {RunId} falhou: {Message}", state.RunId, ex.Message);
        }
        finally
        {
            scope?.Dispose();
            state.Complete(status, error);
        }
    }

    // Abre a conexão TCP e aquece o HttpClient e o pipeline do Kestrel com uma rota sem SQL, fora das métricas,
    // para o cold run da primeira variante não carregar sozinho esse custo compartilhado.
    private async Task PrimeConnectionAsync(HttpClient client, CancellationToken ct)
    {
        if (Interlocked.Exchange(ref _connectionPrimed, 1) != 0)
        {
            return;
        }

        try
        {
            using var response = await client.GetAsync("/api/lab/scenarios", ct).ConfigureAwait(false);
            await response.Content.ReadAsByteArrayAsync(ct).ConfigureAwait(false);
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            Interlocked.Exchange(ref _connectionPrimed, 0);
        }
    }

    private PreciseDelayScheduler GetScheduler()
    {
        lock (_clientLock)
        {
            return _scheduler ??= new PreciseDelayScheduler();
        }
    }

    private HttpClient GetClient()
    {
        lock (_clientLock)
        {
            if (_client is not null)
            {
                return _client;
            }

            var server = _services.GetRequiredService<IServer>();
            var baseAddress = ServerAddressResolver.Resolve(_configuration["Lab:BaseAddress"], server);
            _client = CreateClient(baseAddress);
            return _client;
        }
    }

    private static HttpClient CreateClient(Uri baseAddress)
    {
        var handler = new SocketsHttpHandler
        {
            PooledConnectionLifetime = TimeSpan.FromHours(12),
            PooledConnectionIdleTimeout = TimeSpan.FromMinutes(30),
            MaxConnectionsPerServer = 512,
            UseProxy = false,
            Proxy = null,
            AutomaticDecompression = DecompressionMethods.None,
            UseCookies = false,
            AllowAutoRedirect = false,
            ConnectTimeout = TimeSpan.FromSeconds(10),
        };

        if (baseAddress.IsLoopback)
        {
            handler.SslOptions.RemoteCertificateValidationCallback = static (_, _, _, _) => true;
        }

        var client = new HttpClient(handler, disposeHandler: true)
        {
            BaseAddress = baseAddress,
            Timeout = TimeSpan.FromSeconds(60),
            DefaultRequestVersion = HttpVersion.Version11,
            DefaultVersionPolicy = HttpVersionPolicy.RequestVersionOrLower,
        };
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return client;
    }

    private void CancelAll()
    {
        RunState[] states;
        lock (_lock)
        {
            states = [.. _history];
        }

        foreach (var state in states)
        {
            if (state.IsRunning)
            {
                state.Cts.Cancel();
            }
        }
    }
}
