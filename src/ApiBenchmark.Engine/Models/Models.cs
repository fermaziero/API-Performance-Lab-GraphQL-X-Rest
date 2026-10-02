namespace ApiBenchmark.Engine;

public enum VariantKind { Rest, Graphql }

public enum RunStatus { Running, Completed, Failed, Cancelled }

public enum RunPhase { Cold, Warmup, Benchmark, Done }

public sealed record ScenarioInfo(
    string Id,
    string Title,
    string Description,
    string Need,
    IReadOnlyList<VariantInfo> Variants);

public sealed record VariantInfo(
    string Id,
    string Label,
    VariantKind Kind,
    string Description,
    string RequestPreview);

public sealed record StartRunRequest(
    string? ScenarioId,
    int? Iterations,
    int? Warmup,
    int? Concurrency,
    bool? RestParallel,
    double? SimulatedLatencyMs,
    double? SimulatedBandwidthMbps);

public sealed record StartRunResponse(string RunId);

public sealed record ErrorResponse(string Error);

public sealed record RunConfig(
    int Iterations,
    int Warmup,
    int Concurrency,
    bool RestParallel,
    int SimulatedLatencyMs,
    double? SimulatedBandwidthMbps);

public sealed record RunProgress(int Completed, int Total);

public sealed record ColdResult(double LatencyMs, bool FirstSinceStartup);

public sealed record ThroughputSummary(double OpsPerSecond, double HttpRequestsPerSecond);

public sealed record FieldStats(long Received, long Used, long Unused);

public sealed record TraceEntry(
    string Method,
    string Url,
    int Status,
    double DurationMs,
    double SimulatedDelayMs,
    long BytesReceived,
    long BytesSent,
    string? Body);

public sealed record VariantResult(
    string Id,
    string Label,
    VariantKind Kind,
    long Completed,
    ColdResult? Cold,
    LatencySummary? Latency,
    ThroughputSummary? Throughput,
    double RequestsPerOperation,
    double BytesReceivedPerOperation,
    double BytesSentPerOperation,
    double SimulatedNetworkMsPerOperation,
    double? SqlQueriesPerOperation,
    double? CpuMsPerOperation,
    double? AllocatedBytesPerOperation,
    FieldStats? Fields,
    long Errors,
    double ErrorRate,
    IReadOnlyList<double> Samples,
    IReadOnlyList<TraceEntry> Trace,
    string? SampleResponse);

public sealed record RunSnapshot(
    string RunId,
    string ScenarioId,
    RunStatus Status,
    RunPhase Phase,
    RunConfig Config,
    RunProgress Progress,
    DateTime StartedAt,
    DateTime? FinishedAt,
    double? DurationMs,
    string? Error,
    IReadOnlyList<VariantResult> Variants);
