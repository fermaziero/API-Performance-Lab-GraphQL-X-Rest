using System.Diagnostics;
using System.Runtime.InteropServices;

namespace ApiBenchmark.Engine;

internal sealed class VariantRuntime
{
    public VariantRuntime(VariantDefinition definition) => Definition = definition;

    public VariantDefinition Definition { get; }

    public ColdResult? Cold;
    public FieldStats? Fields;
    public string? SampleResponse;
    public TraceEntry[] Trace = [];

    public double ColdRequests;
    public double ColdBytesReceived;
    public double ColdBytesSent;
    public double ColdSimulatedMs;

    public readonly List<double> Samples = [];
    public long Completed;
    public long Errors;
    public long TotalRequests;
    public long TotalBytesReceived;
    public long TotalBytesSent;
    public double TotalSimulatedMs;

    public long BlockStartTimestamp;
    public double WallSecondsFinished;
    public long FinishedBlockOps;
    public long? SqlTotal;
    public double? CpuMsTotal;
    public long AllocatedTotal;

    public StatsCache? Cache;
}

internal sealed record StatsCache(int Count, LatencySummary? Summary);

internal sealed class RunState
{
    private readonly object _gate = new();
    private readonly VariantRuntime[] _variants;
    private readonly long _startTimestamp = Stopwatch.GetTimestamp();

    private RunStatus _status = RunStatus.Running;
    private RunPhase _phase = RunPhase.Cold;
    private DateTime? _finishedAt;
    private double? _durationMs;
    private string? _error;

    public RunState(string runId, ScenarioDefinition scenario, RunConfig config)
    {
        RunId = runId;
        Scenario = scenario;
        Config = config;
        StartedAt = DateTime.UtcNow;
        _variants = scenario.Variants.Select(v => new VariantRuntime(v)).ToArray();
        Cts = new CancellationTokenSource();
    }

    public string RunId { get; }

    public ScenarioDefinition Scenario { get; }

    public RunConfig Config { get; }

    public DateTime StartedAt { get; }

    public CancellationTokenSource Cts { get; }

    public IReadOnlyList<VariantRuntime> Variants => _variants;

    public bool IsRunning
    {
        get
        {
            lock (_gate)
            {
                return _status == RunStatus.Running;
            }
        }
    }

    public void SetPhase(RunPhase phase)
    {
        lock (_gate)
        {
            _phase = phase;
        }
    }

    public void SetCold(
        int index,
        ColdResult cold,
        TraceEntry[] trace,
        string? sampleResponse,
        FieldStats fields,
        double requests,
        double bytesReceived,
        double bytesSent,
        double simulatedMs)
    {
        lock (_gate)
        {
            var v = _variants[index];
            v.Cold = cold;
            v.Trace = trace;
            v.SampleResponse = sampleResponse;
            v.Fields = fields;
            v.ColdRequests = requests;
            v.ColdBytesReceived = bytesReceived;
            v.ColdBytesSent = bytesSent;
            v.ColdSimulatedMs = simulatedMs;
        }
    }

    public void RecordOperation(int index, OperationResult result)
    {
        lock (_gate)
        {
            var v = _variants[index];
            v.Samples.Add(result.LatencyMs);
            v.Completed++;
            v.TotalRequests += result.Requests;
            v.TotalBytesReceived += result.BytesReceived;
            v.TotalBytesSent += result.BytesSent;
            v.TotalSimulatedMs += result.SimulatedMs;
            if (result.HasError)
            {
                v.Errors++;
            }
        }
    }

    public void BeginBlock(int index, long timestamp)
    {
        lock (_gate)
        {
            _phase = RunPhase.Benchmark;
            _variants[index].BlockStartTimestamp = timestamp;
        }
    }

    public void EndBlock(int index, double wallSeconds, int operations, long? sqlDelta, double? cpuMsDelta, long allocatedDelta)
    {
        lock (_gate)
        {
            var v = _variants[index];
            v.BlockStartTimestamp = 0;
            v.WallSecondsFinished += wallSeconds;
            v.FinishedBlockOps += operations;
            v.AllocatedTotal += allocatedDelta;

            if (sqlDelta.HasValue)
            {
                v.SqlTotal = (v.SqlTotal ?? 0) + sqlDelta.Value;
            }

            if (cpuMsDelta.HasValue)
            {
                v.CpuMsTotal = (v.CpuMsTotal ?? 0) + cpuMsDelta.Value;
            }
        }
    }

    public void Complete(RunStatus status, string? error)
    {
        lock (_gate)
        {
            foreach (var v in _variants)
            {
                v.BlockStartTimestamp = 0;
            }

            _status = status;
            _phase = RunPhase.Done;
            _error = error;
            _finishedAt = DateTime.UtcNow;
            _durationMs = Math.Round(OperationContext.ToMilliseconds(_startTimestamp, Stopwatch.GetTimestamp()), 3);
        }
    }

    public RunSnapshot Snapshot(bool detail)
    {
        var raw = new VariantRaw[_variants.Length];
        RunStatus status;
        RunPhase phase;
        DateTime? finishedAt;
        double? durationMs;
        string? error;
        var now = Stopwatch.GetTimestamp();

        lock (_gate)
        {
            status = _status;
            phase = _phase;
            finishedAt = _finishedAt;
            durationMs = _durationMs;
            error = _error;

            for (var i = 0; i < _variants.Length; i++)
            {
                raw[i] = CaptureVariant(_variants[i], detail, now);
            }
        }

        var results = new List<VariantResult>(raw.Length);
        var completedTotal = 0L;
        foreach (var r in raw)
        {
            results.Add(BuildResult(r));
            completedTotal += r.Completed;
        }

        var progress = new RunProgress(
            phase == RunPhase.Cold || phase == RunPhase.Warmup ? 0 : (int)completedTotal,
            Config.Iterations * _variants.Length);

        return new RunSnapshot(
            RunId,
            Scenario.Id,
            status,
            phase,
            Config,
            progress,
            StartedAt,
            finishedAt,
            durationMs,
            error,
            results);
    }

    private static VariantRaw CaptureVariant(VariantRuntime v, bool detail, long now)
    {
        var cache = v.Cache;
        double[]? samplesForStats = null;
        if (cache is null || cache.Count != v.Samples.Count)
        {
            samplesForStats = v.Samples.ToArray();
            cache = null;
        }

        var wall = v.WallSecondsFinished;
        if (v.BlockStartTimestamp != 0)
        {
            wall += OperationContext.ToMilliseconds(v.BlockStartTimestamp, now) / 1000.0;
        }

        return new VariantRaw
        {
            Runtime = v,
            Completed = v.Completed,
            Errors = v.Errors,
            TotalRequests = v.TotalRequests,
            TotalBytesReceived = v.TotalBytesReceived,
            TotalBytesSent = v.TotalBytesSent,
            TotalSimulatedMs = v.TotalSimulatedMs,
            WallSeconds = wall,
            FinishedBlockOps = v.FinishedBlockOps,
            SqlTotal = v.SqlTotal,
            CpuMsTotal = v.CpuMsTotal,
            AllocatedTotal = v.AllocatedTotal,
            Cold = v.Cold,
            Fields = v.Fields,
            ColdRequests = v.ColdRequests,
            ColdBytesReceived = v.ColdBytesReceived,
            ColdBytesSent = v.ColdBytesSent,
            ColdSimulatedMs = v.ColdSimulatedMs,
            CachedStats = cache,
            SamplesForStats = samplesForStats,
            SamplesCount = v.Samples.Count,
            Samples = detail ? LatencyStatistics.Downsample(CollectionsMarshal.AsSpan(v.Samples)) : [],
            Trace = detail ? v.Trace : [],
            SampleResponse = detail ? v.SampleResponse : null,
        };
    }

    private static VariantResult BuildResult(VariantRaw r)
    {
        var def = r.Runtime.Definition;

        LatencySummary? summary;
        if (r.CachedStats is not null)
        {
            summary = r.CachedStats.Summary;
        }
        else
        {
            summary = LatencyStatistics.Summarize(r.SamplesForStats);
            r.Runtime.Cache = new StatsCache(r.SamplesCount, summary);
        }

        var hasOps = r.Completed > 0;
        var requestsPerOp = hasOps ? (double)r.TotalRequests / r.Completed : r.ColdRequests;
        var receivedPerOp = hasOps ? (double)r.TotalBytesReceived / r.Completed : r.ColdBytesReceived;
        var sentPerOp = hasOps ? (double)r.TotalBytesSent / r.Completed : r.ColdBytesSent;
        var simulatedPerOp = hasOps ? r.TotalSimulatedMs / r.Completed : r.ColdSimulatedMs;

        double? PerBlockOp(double? total) =>
            total.HasValue && r.FinishedBlockOps > 0 ? Round(total.Value / r.FinishedBlockOps) : null;

        var throughput = LatencyStatistics.Throughput(r.Completed, r.TotalRequests, r.WallSeconds);

        return new VariantResult(
            def.Id,
            def.Label,
            def.Kind,
            r.Completed,
            r.Cold is null ? null : r.Cold with { LatencyMs = Round(r.Cold.LatencyMs) },
            summary is null ? null : RoundSummary(summary),
            throughput is null ? null : new ThroughputSummary(Round(throughput.OpsPerSecond), Round(throughput.HttpRequestsPerSecond)),
            Round(requestsPerOp),
            Round(receivedPerOp),
            Round(sentPerOp),
            Round(simulatedPerOp),
            PerBlockOp(r.SqlTotal),
            PerBlockOp(r.CpuMsTotal),
            r.FinishedBlockOps > 0 ? Round((double)r.AllocatedTotal / r.FinishedBlockOps) : null,
            r.Fields,
            r.Errors,
            r.Completed > 0 ? Round((double)r.Errors / r.Completed) : 0.0,
            r.Samples.Select(Round).ToArray(),
            r.Trace,
            r.SampleResponse);
    }

    private static LatencySummary RoundSummary(LatencySummary s) => new(
        Round(s.Mean), Round(s.Median), Round(s.P95), Round(s.P99), Round(s.Min), Round(s.Max), Round(s.StdDev));

    private static double Round(double value) => Math.Round(value, 4);

    private sealed class VariantRaw
    {
        public required VariantRuntime Runtime { get; init; }
        public long Completed { get; init; }
        public long Errors { get; init; }
        public long TotalRequests { get; init; }
        public long TotalBytesReceived { get; init; }
        public long TotalBytesSent { get; init; }
        public double TotalSimulatedMs { get; init; }
        public double WallSeconds { get; init; }
        public long FinishedBlockOps { get; init; }
        public long? SqlTotal { get; init; }
        public double? CpuMsTotal { get; init; }
        public long AllocatedTotal { get; init; }
        public ColdResult? Cold { get; init; }
        public FieldStats? Fields { get; init; }
        public double ColdRequests { get; init; }
        public double ColdBytesReceived { get; init; }
        public double ColdBytesSent { get; init; }
        public double ColdSimulatedMs { get; init; }
        public StatsCache? CachedStats { get; init; }
        public double[]? SamplesForStats { get; init; }
        public int SamplesCount { get; init; }
        public required double[] Samples { get; init; }
        public required TraceEntry[] Trace { get; init; }
        public string? SampleResponse { get; init; }
    }
}
