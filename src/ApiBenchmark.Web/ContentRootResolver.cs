using IoPath = System.IO.Path;

namespace ApiBenchmark.Web;

internal static class ContentRootResolver
{
    // O content root precisa conter wwwroot e appsettings.json. Sem isso, rodar a DLL de outra pasta derruba o dashboard
    // e perde a configuração de log (o EF passaria a logar cada comando e contaminaria a medição).
    public static string? Resolve()
    {
        var candidates = new[]
        {
            Directory.GetCurrentDirectory(),
            AppContext.BaseDirectory,
            IoPath.GetFullPath(IoPath.Combine(AppContext.BaseDirectory, "..", "..", "..")),
        };

        return candidates.FirstOrDefault(dir => File.Exists(IoPath.Combine(dir, "wwwroot", "index.html")));
    }
}
