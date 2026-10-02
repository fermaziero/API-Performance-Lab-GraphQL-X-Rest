using System.Diagnostics;

namespace ApiBenchmark.Engine;

// Custo de rede injetado por requisição: latência fixa + tempo de transferência (bytes enviados + recebidos ÷ banda).
internal sealed class NetworkSimulation
{
    private readonly double _latencyMs;
    private readonly double _bitsPerMillisecond;
    private readonly PreciseDelayScheduler _scheduler;

    private NetworkSimulation(double latencyMs, double? bandwidthMbps, PreciseDelayScheduler scheduler)
    {
        _latencyMs = latencyMs;
        _bitsPerMillisecond = bandwidthMbps is { } mbps ? mbps * 1000.0 : 0;
        _scheduler = scheduler;
    }

    public static NetworkSimulation? Create(RunConfig config, Func<PreciseDelayScheduler> scheduler) =>
        config.SimulatedLatencyMs <= 0 && config.SimulatedBandwidthMbps is null
            ? null
            : new NetworkSimulation(config.SimulatedLatencyMs, config.SimulatedBandwidthMbps, scheduler());

    public double TargetDelayMs(long bytesSent, long bytesReceived) =>
        _bitsPerMillisecond > 0
            ? _latencyMs + (bytesSent + bytesReceived) * 8.0 / _bitsPerMillisecond
            : _latencyMs;

    // Espera até startTimestamp + targetMs e devolve o instante real (Stopwatch) em que a espera terminou.
    public ValueTask<long> WaitAsync(long startTimestamp, double targetMs, CancellationToken ct)
    {
        var deadline = startTimestamp + PreciseDelayScheduler.MillisecondsToTicks(targetMs);

        if (deadline - Stopwatch.GetTimestamp() > PreciseDelayScheduler.InlineSpinTicks)
        {
            return new ValueTask<long>(_scheduler.DelayUntilAsync(deadline, ct));
        }

        PreciseDelayScheduler.SpinUntil(deadline);
        return new ValueTask<long>(Stopwatch.GetTimestamp());
    }
}
