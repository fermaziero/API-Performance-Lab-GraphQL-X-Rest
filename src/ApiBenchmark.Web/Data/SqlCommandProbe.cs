using ApiBenchmark.Engine;

namespace ApiBenchmark.Web.Data;

public sealed class SqlCommandProbe(SqlCommandCounter counter) : ISqlCommandProbe
{
    public long Count => counter.Count;
}
