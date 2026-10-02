using System.Text.Json;

namespace ApiBenchmark.Engine;

public readonly record struct FieldCount(long Received, long Used)
{
    public long Unused => Received - Used;

    public static FieldCount operator +(FieldCount a, FieldCount b) => new(a.Received + b.Received, a.Used + b.Used);
}

public static class FieldCounter
{
    private const int MaxDepth = 64;

    // Lê o JSON token a token (sem montar o documento): corpos de dezenas de MB custam tempo, não memória.
    public static FieldCount Count(ReadOnlyMemory<byte> json, IReadOnlySet<string>? usedPaths, bool graphQlEnvelope)
    {
        if (json.IsEmpty)
        {
            return default;
        }

        try
        {
            var reader = new Utf8JsonReader(json.Span);
            var root = usedPaths is null ? null : PathNode.Build(usedPaths);
            long received = 0, used = 0;

            if (!reader.Read())
            {
                return default;
            }

            if (graphQlEnvelope)
            {
                if (reader.TokenType != JsonTokenType.StartObject)
                {
                    return default;
                }

                while (reader.Read() && reader.TokenType == JsonTokenType.PropertyName)
                {
                    var isData = reader.ValueTextEquals("data"u8);
                    reader.Read();

                    if (isData && reader.TokenType != JsonTokenType.Null)
                    {
                        received = 0;
                        used = 0;
                        Walk(ref reader, root, usedPaths is null, ref received, ref used);
                    }
                    else
                    {
                        reader.Skip();
                    }
                }
            }
            else
            {
                Walk(ref reader, root, usedPaths is null, ref received, ref used);
            }

            reader.Read();
            return new FieldCount(received, used);
        }
        catch (JsonException)
        {
            return default;
        }
    }

    // Consome um valor inteiro a partir do token atual. Cada folha (qualquer valor que não seja objeto ou array) é um campo;
    // arrays são transparentes no caminho, como em "orders.items.product.name".
    private static void Walk(ref Utf8JsonReader reader, PathNode? root, bool countAll, ref long received, ref long used)
    {
        var stack = new PathNode?[MaxDepth + 2];
        var depth = 0;
        var current = root;

        do
        {
            switch (reader.TokenType)
            {
                case JsonTokenType.StartObject:
                case JsonTokenType.StartArray:
                    stack[depth++] = current;
                    break;
                case JsonTokenType.EndObject:
                case JsonTokenType.EndArray:
                    depth--;
                    current = depth > 0 ? stack[depth - 1] : null;
                    break;
                case JsonTokenType.PropertyName:
                    current = stack[depth - 1]?.Find(ref reader);
                    break;
                default:
                    received++;
                    if (countAll || current is { Used: true })
                    {
                        used++;
                    }

                    current = depth > 0 ? stack[depth - 1] : null;
                    break;
            }
        }
        while (depth > 0 && reader.Read());
    }

    private sealed class PathNode
    {
        private readonly List<(string Name, PathNode Node)> _children = [];

        public bool Used { get; private set; }

        public static PathNode Build(IReadOnlySet<string> paths)
        {
            var root = new PathNode();
            foreach (var path in paths)
            {
                var node = root;
                if (path.Length > 0)
                {
                    foreach (var segment in path.Split('.'))
                    {
                        node = node.GetOrAdd(segment);
                    }
                }

                node.Used = true;
            }

            return root;
        }

        public PathNode? Find(ref Utf8JsonReader reader)
        {
            foreach (var (name, node) in _children)
            {
                if (reader.ValueTextEquals(name))
                {
                    return node;
                }
            }

            return null;
        }

        private PathNode GetOrAdd(string name)
        {
            foreach (var (existing, node) in _children)
            {
                if (existing == name)
                {
                    return node;
                }
            }

            var created = new PathNode();
            _children.Add((name, created));
            return created;
        }
    }
}
