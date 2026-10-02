using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ApiBenchmark.Engine;

internal readonly record struct HttpResult(int Status, byte[] Body, bool Success);

internal sealed record RequestRecord(
    string Method,
    string Url,
    int Status,
    double DurationMs,
    double SimulatedDelayMs,
    long BytesReceived,
    long BytesSent,
    string? Body,
    byte[]? ResponseBody,
    long StartTimestamp);

internal sealed record OperationResult(
    double LatencyMs,
    int Requests,
    long BytesSent,
    long BytesReceived,
    double SimulatedMs,
    bool HasError,
    string? TransportError,
    string? ErrorMessage,
    IReadOnlyList<RequestRecord> Records);

internal sealed class OperationContext
{
    private static readonly ConcurrentDictionary<string, string> CompactCache = new();

    private static readonly JsonSerializerOptions GraphQLJson = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly HttpClient _http;
    private readonly NetworkSimulation? _network;
    private readonly CancellationToken _ct;
    private readonly object _gate = new();
    private readonly List<RequestRecord>? _records;

    private int _requests;
    private long _bytesSent;
    private long _bytesReceived;
    private double _simulatedMs;
    private long _firstStart = long.MaxValue;
    private long _lastEnd;
    private bool _hasError;
    private string? _transportError;
    private string? _errorMessage;

    public OperationContext(HttpClient http, NetworkSimulation? network, bool capture, bool restParallel, CancellationToken ct)
    {
        _http = http;
        _network = network;
        _ct = ct;
        RestParallel = restParallel;
        _records = capture ? [] : null;
    }

    public bool RestParallel { get; }

    public Task<HttpResult> GetAsync(string pathAndQuery) =>
        SendAsync(HttpMethod.Get, pathAndQuery, null, null, false);

    public Task<HttpResult> GraphQLAsync(string query, object? variables = null)
    {
        var compact = CompactCache.GetOrAdd(query, CompactQuery);
        var payload = JsonSerializer.SerializeToUtf8Bytes(new GraphQLPayload(compact, variables), GraphQLJson);
        return SendAsync(HttpMethod.Post, "/graphql", payload, query, true);
    }

    public void MarkError(string message)
    {
        lock (_gate)
        {
            _hasError = true;
            _errorMessage ??= message;
        }
    }

    public OperationResult ToResult(long fallbackStart, long fallbackEnd)
    {
        lock (_gate)
        {
            var hasTimes = _requests > 0 && _firstStart != long.MaxValue;
            var latency = hasTimes ? ToMilliseconds(_firstStart, _lastEnd) : ToMilliseconds(fallbackStart, fallbackEnd);
            IReadOnlyList<RequestRecord> records = _records is null
                ? []
                : _records.OrderBy(r => r.StartTimestamp).ToList();

            return new OperationResult(
                latency, _requests, _bytesSent, _bytesReceived, _simulatedMs, _hasError, _transportError, _errorMessage, records);
        }
    }

    internal static double ToMilliseconds(long startTimestamp, long endTimestamp) =>
        (endTimestamp - startTimestamp) * 1000.0 / Stopwatch.Frequency;

    private async Task<HttpResult> SendAsync(HttpMethod method, string url, byte[]? payload, string? displayBody, bool graphQl)
    {
        _ct.ThrowIfCancellationRequested();

        var sent = method.Method.Length + 1 + Encoding.UTF8.GetByteCount(url) + " HTTP/1.1\r\n".Length + (payload?.Length ?? 0);

        using var request = new HttpRequestMessage(method, url);
        if (payload is not null)
        {
            request.Content = new ByteArrayContent(payload);
            request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        }

        var status = 0;
        var body = Array.Empty<byte>();
        var success = false;
        string? failure = null;
        var transport = false;

        var start = Stopwatch.GetTimestamp();
        try
        {
            using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, _ct).ConfigureAwait(false);
            status = (int)response.StatusCode;
            body = await response.Content.ReadAsByteArrayAsync(_ct).ConfigureAwait(false);
            success = status is >= 200 and <= 299;

            if (!success)
            {
                failure = $"HTTP {status} em {method.Method} {url}";
            }
            else if (graphQl && GraphQLHasErrors(body))
            {
                success = false;
                failure = $"Resposta GraphQL com 'errors' em {url}";
            }
        }
        catch (OperationCanceledException) when (_ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            failure = ex is OperationCanceledException ? $"Timeout em {method.Method} {url}" : ex.Message;
            transport = true;
        }

        var realEnd = Stopwatch.GetTimestamp();
        var end = realEnd;
        var simulatedMs = 0.0;

        if (_network is not null && !transport)
        {
            var deadline = _network.ReserveDeadline(realEnd, sent, body.Length);
            if (deadline > realEnd)
            {
                end = await _network.WaitAsync(deadline, _ct).ConfigureAwait(false);
                simulatedMs = ToMilliseconds(realEnd, end);
            }
        }

        lock (_gate)
        {
            _requests++;
            _bytesSent += sent;
            _bytesReceived += body.Length;
            _simulatedMs += simulatedMs;
            if (start < _firstStart)
            {
                _firstStart = start;
            }

            if (end > _lastEnd)
            {
                _lastEnd = end;
            }

            if (!success)
            {
                _hasError = true;
                _errorMessage ??= failure;
            }

            if (transport)
            {
                _transportError ??= failure;
            }

            _records?.Add(new RequestRecord(
                method.Method, url, status, ToMilliseconds(start, realEnd), simulatedMs, body.Length, sent, displayBody, body, start));
        }

        return new HttpResult(status, body, success);
    }

    private static bool GraphQLHasErrors(byte[] body)
    {
        if (body.Length == 0)
        {
            return true;
        }

        if (body.AsSpan().IndexOf("\"errors\""u8) < 0)
        {
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(body);
            if (document.RootElement.ValueKind != JsonValueKind.Object ||
                !document.RootElement.TryGetProperty("errors", out var errors))
            {
                return false;
            }

            return errors.ValueKind switch
            {
                JsonValueKind.Null or JsonValueKind.Undefined => false,
                JsonValueKind.Array => errors.GetArrayLength() > 0,
                _ => true,
            };
        }
        catch (JsonException)
        {
            return true;
        }
    }

    private static string CompactQuery(string query)
    {
        var builder = new StringBuilder(query.Length);
        var previousWasSpace = false;
        foreach (var ch in query.Trim())
        {
            if (char.IsWhiteSpace(ch))
            {
                if (!previousWasSpace)
                {
                    builder.Append(' ');
                }

                previousWasSpace = true;
            }
            else
            {
                builder.Append(ch);
                previousWasSpace = false;
            }
        }

        return builder.ToString();
    }

    private sealed record GraphQLPayload(
        [property: JsonPropertyName("query")] string Query,
        [property: JsonPropertyName("variables")] object? Variables);
}
