using System.Diagnostics;

namespace ApiBenchmark.Engine;

// Custo de rede injetado por requisição: latência fixa + tempo de transferência (bytes enviados + recebidos ÷ banda).
// A latência corre em paralelo para todas as requisições; a banda é um enlace único e compartilhado: o tempo de transferência
// ocupa o enlace, e requisições simultâneas esperam a vez em vez de cada uma receber a banda inteira.
internal sealed class NetworkSimulation
{
    private readonly object _linkGate = new();
    private readonly long _latencyTicks;
    private readonly double _bitsPerMillisecond;
    private readonly PreciseDelayScheduler _scheduler;

    private long _linkFreeAt;

    private NetworkSimulation(double latencyMs, double? bandwidthMbps, PreciseDelayScheduler scheduler)
    {
        _latencyTicks = PreciseDelayScheduler.MillisecondsToTicks(latencyMs);
        _bitsPerMillisecond = bandwidthMbps is { } mbps ? mbps * 1000.0 : 0;
        _scheduler = scheduler;
    }

    public static NetworkSimulation? Create(RunConfig config, Func<PreciseDelayScheduler> scheduler) =>
        config.SimulatedLatencyMs <= 0 && config.SimulatedBandwidthMbps is null
            ? null
            : new NetworkSimulation(config.SimulatedLatencyMs, config.SimulatedBandwidthMbps, scheduler());

    // Instante (Stopwatch) em que a requisição passa a valer como concluída. Sem banda limitada é só a latência;
    // com banda, a transferência começa quando a resposta chegou (readyTimestamp) ou quando o enlace ficar livre, o que for depois.
    public long ReserveDeadline(long readyTimestamp, long bytesSent, long bytesReceived)
    {
        if (_bitsPerMillisecond <= 0)
        {
            return readyTimestamp + _latencyTicks;
        }

        var transferTicks = PreciseDelayScheduler.MillisecondsToTicks((bytesSent + bytesReceived) * 8.0 / _bitsPerMillisecond);
        lock (_linkGate)
        {
            var transferStart = Math.Max(readyTimestamp, _linkFreeAt);
            _linkFreeAt = transferStart + transferTicks;
            return _linkFreeAt + _latencyTicks;
        }
    }

    // Espera até o prazo e devolve o instante real (Stopwatch) em que a espera terminou.
    public ValueTask<long> WaitAsync(long deadline, CancellationToken ct)
    {
        if (deadline - Stopwatch.GetTimestamp() > PreciseDelayScheduler.InlineSpinTicks)
        {
            return new ValueTask<long>(_scheduler.DelayUntilAsync(deadline, ct));
        }

        PreciseDelayScheduler.SpinUntil(deadline);
        return new ValueTask<long>(Stopwatch.GetTimestamp());
    }
}
