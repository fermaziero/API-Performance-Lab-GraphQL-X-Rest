using System.Data.Common;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace ApiBenchmark.Web.Data;

public enum DatabaseProvider
{
    Sqlite,
    Postgres,
}

public sealed class DatabaseSetupException(string message) : Exception(message);

public sealed class DatabaseSettings
{
    public const string DefaultSqliteConnectionString = "Data Source=benchmark.db";
    public const string DefaultPostgresConnectionString = "Host=localhost;Port=5433;Database=lab;Username=lab;Password=lab";
    public const int DefaultPostgresMaxPoolSize = 50;

    private static readonly string[] MaxPoolSizeKeys = ["Maximum Pool Size", "Max Pool Size", "MaxPoolSize"];

    private DatabaseSettings(DatabaseProvider provider, string connectionString)
    {
        Provider = provider;
        ConnectionString = connectionString;
    }

    public DatabaseProvider Provider { get; }

    public string ConnectionString { get; }

    public string Name => Provider == DatabaseProvider.Postgres ? "postgres" : "sqlite";

    public static DatabaseSettings FromConfiguration(IConfiguration configuration, string contentRoot)
    {
        var raw = configuration["Database:Provider"]?.Trim();
        var provider = string.IsNullOrEmpty(raw) || raw.Equals("sqlite", StringComparison.OrdinalIgnoreCase)
            ? DatabaseProvider.Sqlite
            : raw.Equals("postgres", StringComparison.OrdinalIgnoreCase)
                ? DatabaseProvider.Postgres
                : throw new DatabaseSetupException($"Database:Provider inválido: '{raw}'. Valores aceitos: 'sqlite' (padrão) ou 'postgres'.");

        return provider == DatabaseProvider.Postgres
            ? new DatabaseSettings(provider, PreparePostgres(configuration.GetConnectionString("LabPostgres") ?? DefaultPostgresConnectionString))
            : new DatabaseSettings(provider, ResolveSqlite(configuration.GetConnectionString("Lab") ?? DefaultSqliteConnectionString, contentRoot));
    }

    public DbContextOptionsBuilder Configure(DbContextOptionsBuilder options) => Provider switch
    {
        DatabaseProvider.Postgres => options.UseNpgsql(ConnectionString),
        _ => options.UseSqlite(ConnectionString),
    };

    public string Describe()
    {
        if (Provider == DatabaseProvider.Postgres)
        {
            var csb = new NpgsqlConnectionStringBuilder(ConnectionString);
            return $"PostgreSQL em {csb.Host}:{csb.Port}/{csb.Database}";
        }

        return $"SQLite em {new SqliteConnectionStringBuilder(ConnectionString).DataSource}";
    }

    public async Task EnsureReachableAsync(CancellationToken ct = default)
    {
        if (Provider != DatabaseProvider.Postgres)
        {
            return;
        }

        var csb = new NpgsqlConnectionStringBuilder(ConnectionString) { Pooling = false, Timeout = 2 };
        var deadline = TimeSpan.FromSeconds(8);
        var clock = System.Diagnostics.Stopwatch.StartNew();
        Exception? last = null;
        var announced = false;
        while (true)
        {
            try
            {
                await using var connection = new NpgsqlConnection(csb.ConnectionString);
                await connection.OpenAsync(ct);
                return;
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.InvalidCatalogName)
            {
                return;
            }
            catch (Exception ex) when (!ct.IsCancellationRequested && ex is NpgsqlException or TimeoutException or OperationCanceledException)
            {
                last = ex;
                if (ex is PostgresException pg && pg.SqlState != PostgresErrorCodes.CannotConnectNow)
                {
                    throw new DatabaseSetupException(
                        $"PostgreSQL em {csb.Host}:{csb.Port} recusou a conexão: {FirstLine(ex.Message)}{Environment.NewLine}Confira ConnectionStrings:LabPostgres.");
                }

                if (clock.Elapsed >= deadline)
                {
                    break;
                }

                if (!announced)
                {
                    announced = true;
                    Console.WriteLine($"Aguardando PostgreSQL em {csb.Host}:{csb.Port}...");
                }

                await Task.Delay(TimeSpan.FromMilliseconds(500), ct);
            }
        }

        throw new DatabaseSetupException(
            $"PostgreSQL inacessível em {csb.Host}:{csb.Port}. Suba com: docker compose up -d{Environment.NewLine}Detalhe: {FirstLine(last!.GetBaseException().Message)}");
    }

    private static string FirstLine(string message) => message.Split('\n')[0].Trim();

    private static string PreparePostgres(string connectionString)
    {
        try
        {
            var provided = new DbConnectionStringBuilder { ConnectionString = connectionString };
            var csb = new NpgsqlConnectionStringBuilder(connectionString);
            if (!MaxPoolSizeKeys.Any(provided.ContainsKey))
            {
                csb.MaxPoolSize = DefaultPostgresMaxPoolSize;
            }

            return csb.ConnectionString;
        }
        catch (ArgumentException ex)
        {
            throw new DatabaseSetupException($"ConnectionStrings:LabPostgres inválida: {ex.Message}");
        }
    }

    private static string ResolveSqlite(string connectionString, string contentRoot)
    {
        var csb = new SqliteConnectionStringBuilder(connectionString);
        var source = csb.DataSource;
        if (!string.IsNullOrEmpty(source)
            && !source.Equals(":memory:", StringComparison.OrdinalIgnoreCase)
            && !source.StartsWith("file:", StringComparison.OrdinalIgnoreCase)
            && !System.IO.Path.IsPathRooted(source))
        {
            csb.DataSource = System.IO.Path.Combine(contentRoot, source);
        }

        return csb.ToString();
    }
}
