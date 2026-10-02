using System.Text.Json;

namespace ApiBenchmark.Engine;

public readonly record struct FieldCount(long Received, long Used)
{
    public long Unused => Received - Used;

    public static FieldCount operator +(FieldCount a, FieldCount b) => new(a.Received + b.Received, a.Used + b.Used);
}

public static class FieldCounter
{
    public static FieldCount Count(ReadOnlyMemory<byte> json, IReadOnlySet<string>? usedPaths, bool graphQlEnvelope)
    {
        if (json.IsEmpty)
        {
            return default;
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            long received = 0, used = 0;
            var root = document.RootElement;

            if (graphQlEnvelope)
            {
                if (root.ValueKind == JsonValueKind.Object &&
                    root.TryGetProperty("data", out var data) &&
                    data.ValueKind != JsonValueKind.Null)
                {
                    Walk(data, string.Empty, usedPaths, ref received, ref used);
                }
            }
            else
            {
                Walk(root, string.Empty, usedPaths, ref received, ref used);
            }

            return new FieldCount(received, used);
        }
        catch (JsonException)
        {
            return default;
        }
    }

    private static void Walk(JsonElement element, string path, IReadOnlySet<string>? usedPaths, ref long received, ref long used)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    var childPath = path.Length == 0 ? property.Name : path + "." + property.Name;
                    Walk(property.Value, childPath, usedPaths, ref received, ref used);
                }

                break;
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                {
                    Walk(item, path, usedPaths, ref received, ref used);
                }

                break;
            default:
                received++;
                if (usedPaths is null || usedPaths.Contains(path))
                {
                    used++;
                }

                break;
        }
    }
}
