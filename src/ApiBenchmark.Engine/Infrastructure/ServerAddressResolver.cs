using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

namespace ApiBenchmark.Engine;

internal static partial class ServerAddressResolver
{
    private static readonly HashSet<string> WildcardHosts = new(StringComparer.OrdinalIgnoreCase)
    {
        "", "+", "*", "0.0.0.0", "[::]", "[::0]", "::", "[::ffff:0.0.0.0]",
    };

    public static Uri Resolve(string? configuredAddress, IServer server)
    {
        if (!string.IsNullOrWhiteSpace(configuredAddress))
        {
            return Normalize(configuredAddress)
                ?? throw new InvalidOperationException($"Valor inválido em 'Lab:BaseAddress': '{configuredAddress}'.");
        }

        var addresses = server.Features.Get<IServerAddressesFeature>()?.Addresses ?? [];
        var candidates = addresses.Select(Normalize).Where(u => u is not null).Cast<Uri>().ToList();

        var chosen = candidates.FirstOrDefault(u => u.Scheme == Uri.UriSchemeHttp)
            ?? candidates.FirstOrDefault();

        return chosen ?? throw new InvalidOperationException(
            "Não foi possível descobrir o endereço do servidor (IServerAddressesFeature vazio). " +
            "Configure 'Lab:BaseAddress' (ex.: http://localhost:5080).");
    }

    internal static Uri? Normalize(string address)
    {
        var match = AddressPattern().Match(address.Trim());
        if (!match.Success)
        {
            return null;
        }

        var scheme = match.Groups["scheme"].Value.ToLowerInvariant();
        var host = match.Groups["host"].Value;
        var port = match.Groups["port"].Value;

        if (WildcardHosts.Contains(host))
        {
            host = "localhost";
        }

        var text = port.Length > 0 ? $"{scheme}://{host}:{port}/" : $"{scheme}://{host}/";
        return Uri.TryCreate(text, UriKind.Absolute, out var uri) ? uri : null;
    }

    [GeneratedRegex(@"^(?<scheme>https?)://(?<host>\[[^\]]*\]|[^/:]*)(:(?<port>\d+))?(/.*)?$", RegexOptions.IgnoreCase)]
    private static partial Regex AddressPattern();
}
