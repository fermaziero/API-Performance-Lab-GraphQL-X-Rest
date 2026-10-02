using System.Buffers;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace ApiBenchmark.Engine;

internal sealed class BenchmarkRunner
{
    private const int TargetBlocks = 10;
    private const int MinOperationsPerWorkerInBlock = 4;
    private const int WarmupWindow = 100;
    private const int SampleResponseLimit = 4000;
    private const int SampleBudgetBytes = SampleResponseLimit * 4;
    private const string TruncationMarker = "\n… [truncado]";

    private static readonly TimeSpan FirstRunWarmupFloor = TimeSpan.FromSeconds(1);

    private static readonly JsonWriterOptions IndentedWriter = new()
    {
        Indented = true,
        NewLine = "\n",
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private readonly RunState _state;
    private readonly HttpClient _http;
    private readonly ISqlCommandProbe? _probe;
    private readonly NetworkSimulation? _network;
    private readonly ConcurrentDictionary<string, byte> _seenVariants;
    private readonly IReadOnlyList<VariantDefinition> _variants;

    public BenchmarkRunner(
        RunState state,
        HttpClient http,
        ISqlCommandProbe? probe,
        NetworkSimulation? network,
        ConcurrentDictionary<string, byte> seenVariants)
    {
        _state = state;
        _http = http;
        _probe = probe;
        _network = network;
        _seenVariants = seenVariants;
        _variants = state.Scenario.Variants;
    }

    public async Task RunAsync(CancellationToken ct)
    {
        await RunColdAsync(ct).ConfigureAwait(false);
        await RunWarmupAsync(ct).ConfigureAwait(false);
        await RunBenchmarkAsync(ct).ConfigureAwait(false);
    }

    private async Task RunColdAsync(CancellationToken ct)
    {
        _state.SetPhase(RunPhase.Cold);

        for (var i = 0; i < _variants.Count; i++)
        {
            ct.ThrowIfCancellationRequested();
            await RunColdVariantAsync(i, ct).ConfigureAwait(false);
        }
    }

    // Método próprio para o corpo da resposta (dezenas de MB no cenário volume) não ficar preso no estado da máquina async
    // enquanto a próxima variante executa.
    private async Task RunColdVariantAsync(int index, CancellationToken ct)
    {
        var variant = _variants[index];
        var result = await ExecuteOperationAsync(variant, capture: true, simulate: true, ct).ConfigureAwait(false);

        if (result.TransportError is not null)
        {
            throw new InvalidOperationException(
                $"Falha ao chamar o servidor em {_http.BaseAddress} ({_state.Scenario.Id}/{variant.Id}): {result.TransportError}");
        }

        var first = _seenVariants.TryAdd($"{_state.Scenario.Id}/{variant.Id}", 0);
        var graphQl = variant.Kind == VariantKind.Graphql;

        var fields = default(FieldCount);
        foreach (var record in result.Records)
        {
            if (record.ResponseBody is { Length: > 0 })
            {
                fields += FieldCounter.Count(record.ResponseBody, variant.UsedFieldPaths, graphQl);
            }
        }

        var trace = result.Records
            .Select(r => new TraceEntry(r.Method, r.Url, r.Status, Math.Round(r.DurationMs, 4), Math.Round(r.SimulatedDelayMs, 4), r.BytesReceived, r.BytesSent, r.Body))
            .ToArray();

        var sample = result.Records.Count > 0 ? FormatSample(result.Records[^1].ResponseBody) : null;

        _state.SetCold(
            index,
            new ColdResult(result.LatencyMs, first),
            trace,
            sample,
            new FieldStats(fields.Received, fields.Used, fields.Unused),
            result.Requests,
            result.BytesReceived,
            result.BytesSent,
            result.SimulatedMs);
    }

    private async Task RunWarmupAsync(CancellationToken ct)
    {
        var warmup = _state.Config.Warmup;
        if (warmup <= 0)
        {
            return;
        }

        _state.SetPhase(RunPhase.Warmup);

        for (var variantIndex = 0; variantIndex < _variants.Count; variantIndex++)
        {
            var started = Stopwatch.GetTimestamp();
            await RunWorkersAsync(variantIndex, warmup, new BlockCounter(), record: false, ct).ConfigureAwait(false);

            // Na 1ª execução da variante desde que o processo subiu, o JIT em camadas ainda está promovendo o código
            // quente: o warm-up configurado vira um mínimo e segue até um piso de tempo, para o regime medido ser o estável.
            // A janela encolhe quando a operação é lenta (cenário volume): 100 operações de 0,8 s passariam longe do piso de 1 s.
            if (_state.Variants[variantIndex].Cold is { FirstSinceStartup: true })
            {
                var done = warmup;
                var elapsed = Stopwatch.GetElapsedTime(started);
                while (elapsed < FirstRunWarmupFloor)
                {
                    var perOperation = elapsed / done;
                    var window = (int)Math.Clamp(
                        Math.Ceiling((FirstRunWarmupFloor - elapsed) / perOperation),
                        _state.Config.Concurrency,
                        WarmupWindow);

                    await RunWorkersAsync(variantIndex, window, new BlockCounter(), record: false, ct).ConfigureAwait(false);
                    done += window;
                    elapsed = Stopwatch.GetElapsedTime(started);
                }
            }
        }
    }

    private async Task RunBenchmarkAsync(CancellationToken ct)
    {
        var iterations = _state.Config.Iterations;
        var concurrency = _state.Config.Concurrency;
        var minBlockSize = concurrency > 1 ? concurrency * MinOperationsPerWorkerInBlock : 1;
        var blocks = Math.Clamp(iterations / minBlockSize, 1, Math.Min(TargetBlocks, iterations));
        var baseSize = iterations / blocks;
        var remainder = iterations % blocks;

        _state.SetPhase(RunPhase.Benchmark);

        for (var block = 0; block < blocks; block++)
        {
            var size = baseSize + (block < remainder ? 1 : 0);
            var order = Enumerable.Range(0, _variants.Count).ToArray();
            if (block % 2 == 1)
            {
                Array.Reverse(order);
            }

            foreach (var variantIndex in order)
            {
                ct.ThrowIfCancellationRequested();
                await RunBlockAsync(variantIndex, size, ct).ConfigureAwait(false);
            }
        }
    }

    private async Task RunBlockAsync(int variantIndex, int size, CancellationToken ct)
    {
        var counter = new BlockCounter();

        var sqlBefore = _probe?.Count;
        var cpuBefore = ProcessProbe.CpuMilliseconds();
        var spinBefore = PreciseDelayScheduler.SpinMilliseconds;
        var allocatedBefore = ProcessProbe.AllocatedBytes();
        var start = Stopwatch.GetTimestamp();
        _state.BeginBlock(variantIndex, start);

        try
        {
            await RunWorkersAsync(variantIndex, size, counter, record: true, ct).ConfigureAwait(false);
        }
        finally
        {
            var end = Stopwatch.GetTimestamp();
            var wallSeconds = OperationContext.ToMilliseconds(start, end) / 1000.0;

            if (ct.IsCancellationRequested)
            {
                // Operações abortadas em voo já gastaram SQL, CPU e alocação no servidor sem entrar no denominador.
                _state.EndBlock(variantIndex, wallSeconds, 0, null, null, 0);
            }
            else
            {
                var allocatedAfter = ProcessProbe.AllocatedBytes();
                var cpuAfter = ProcessProbe.CpuMilliseconds();
                var sqlAfter = _probe?.Count;
                var spinMs = PreciseDelayScheduler.SpinMilliseconds - spinBefore;

                _state.EndBlock(
                    variantIndex,
                    wallSeconds,
                    counter.Done,
                    sqlBefore.HasValue && sqlAfter.HasValue ? sqlAfter.Value - sqlBefore.Value : null,
                    cpuBefore.HasValue && cpuAfter.HasValue ? cpuAfter.Value - cpuBefore.Value - spinMs : null,
                    Math.Max(0, allocatedAfter - allocatedBefore));
            }
        }
    }

    private async Task RunWorkersAsync(int variantIndex, int count, BlockCounter counter, bool record, CancellationToken ct)
    {
        var variant = _variants[variantIndex];
        var next = -1;
        var workerCount = Math.Min(_state.Config.Concurrency, count);

        async Task WorkerAsync()
        {
            while (true)
            {
                ct.ThrowIfCancellationRequested();

                if (Interlocked.Increment(ref next) >= count)
                {
                    return;
                }

                var result = await ExecuteOperationAsync(variant, capture: false, simulate: record, ct).ConfigureAwait(false);
                if (record)
                {
                    _state.RecordOperation(variantIndex, result);
                }

                counter.Increment();
            }
        }

        var workers = new Task[workerCount];
        for (var i = 0; i < workerCount; i++)
        {
            workers[i] = Task.Run(WorkerAsync, CancellationToken.None);
        }

        await Task.WhenAll(workers).ConfigureAwait(false);
    }

    private async Task<OperationResult> ExecuteOperationAsync(VariantDefinition variant, bool capture, bool simulate, CancellationToken ct)
    {
        var context = new OperationContext(_http, simulate ? _network : null, capture, _state.Config.RestParallel, ct);
        var fallbackStart = Stopwatch.GetTimestamp();

        try
        {
            await variant.ExecuteAsync(context).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            context.MarkError(ex.Message);
        }

        return context.ToResult(fallbackStart, Stopwatch.GetTimestamp());
    }

    private static string? FormatSample(byte[]? body)
    {
        if (body is null || body.Length == 0)
        {
            return null;
        }

        string text;
        try
        {
            text = IndentPrefix(body);
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or ArgumentException)
        {
            text = Encoding.UTF8.GetString(body.AsSpan(0, Math.Min(body.Length, SampleBudgetBytes)));
        }

        if (text.Length <= SampleResponseLimit)
        {
            return text;
        }

        var keep = SampleResponseLimit - TruncationMarker.Length;
        if (char.IsHighSurrogate(text[keep - 1]))
        {
            keep--;
        }

        return text[..keep] + TruncationMarker;
    }

    // Reindenta token a token e para ao passar de SampleBudgetBytes: o custo depende do trecho inicial, não do tamanho do corpo.
    // Corpos que cabem no orçamento saem inteiros, idênticos a serializar o documento todo com indentação.
    private static string IndentPrefix(byte[] body)
    {
        var output = new ArrayBufferWriter<byte>(SampleBudgetBytes + 1024);
        using var writer = new Utf8JsonWriter(output, IndentedWriter);
        var reader = new Utf8JsonReader(body);
        var tokens = 0;

        while (reader.Read())
        {
            switch (reader.TokenType)
            {
                case JsonTokenType.StartObject:
                    writer.WriteStartObject();
                    break;
                case JsonTokenType.EndObject:
                    writer.WriteEndObject();
                    break;
                case JsonTokenType.StartArray:
                    writer.WriteStartArray();
                    break;
                case JsonTokenType.EndArray:
                    writer.WriteEndArray();
                    break;
                case JsonTokenType.PropertyName:
                    if (reader.ValueIsEscaped)
                    {
                        writer.WritePropertyName(reader.GetString()!);
                    }
                    else
                    {
                        writer.WritePropertyName(reader.ValueSpan);
                    }

                    break;
                case JsonTokenType.String:
                    if (reader.ValueIsEscaped)
                    {
                        writer.WriteStringValue(reader.GetString());
                    }
                    else
                    {
                        writer.WriteStringValue(reader.ValueSpan);
                    }

                    break;
                case JsonTokenType.Number:
                    JsonElement.ParseValue(ref reader).WriteTo(writer);
                    break;
                case JsonTokenType.True:
                    writer.WriteBooleanValue(true);
                    break;
                case JsonTokenType.False:
                    writer.WriteBooleanValue(false);
                    break;
                case JsonTokenType.Null:
                    writer.WriteNullValue();
                    break;
            }

            if ((++tokens & 63) == 0)
            {
                writer.Flush();
                if (output.WrittenCount >= SampleBudgetBytes)
                {
                    break;
                }
            }
        }

        writer.Flush();
        return Encoding.UTF8.GetString(output.WrittenSpan);
    }

    private sealed class BlockCounter
    {
        private int _done;

        public int Done => Volatile.Read(ref _done);

        public void Increment() => Interlocked.Increment(ref _done);
    }
}
