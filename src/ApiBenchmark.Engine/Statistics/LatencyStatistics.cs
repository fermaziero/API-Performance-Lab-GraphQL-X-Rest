namespace ApiBenchmark.Engine;

public sealed record LatencySummary(
    double Mean,
    double Median,
    double P95,
    double P99,
    double Min,
    double Max,
    double StdDev);

public static class LatencyStatistics
{
    public const int MaxSamplePoints = 2000;

    public static LatencySummary? Summarize(ReadOnlySpan<double> samples)
    {
        if (samples.IsEmpty)
        {
            return null;
        }

        var sorted = samples.ToArray();
        Array.Sort(sorted);
        return SummarizeSorted(sorted);
    }

    public static LatencySummary? SummarizeSorted(ReadOnlySpan<double> sorted)
    {
        var n = sorted.Length;
        if (n == 0)
        {
            return null;
        }

        double sum = 0;
        foreach (var value in sorted)
        {
            sum += value;
        }

        var mean = sum / n;
        double squares = 0;
        foreach (var value in sorted)
        {
            var d = value - mean;
            squares += d * d;
        }

        var stdDev = n > 1 ? Math.Sqrt(squares / (n - 1)) : 0.0;

        return new LatencySummary(
            mean,
            Median(sorted),
            Percentile(sorted, 95),
            Percentile(sorted, 99),
            sorted[0],
            sorted[n - 1],
            stdDev);
    }

    public static double Median(ReadOnlySpan<double> sorted)
    {
        var n = sorted.Length;
        if (n == 0)
        {
            throw new ArgumentException("Amostra vazia.", nameof(sorted));
        }

        return n % 2 == 1 ? sorted[n / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0;
    }

    public static double Percentile(ReadOnlySpan<double> sorted, double percentile)
    {
        var n = sorted.Length;
        if (n == 0)
        {
            throw new ArgumentException("Amostra vazia.", nameof(sorted));
        }

        if (percentile < 0 || percentile > 100)
        {
            throw new ArgumentOutOfRangeException(nameof(percentile));
        }

        var rank = (int)Math.Ceiling(percentile * n / 100.0);
        rank = Math.Clamp(rank, 1, n);
        return sorted[rank - 1];
    }

    public static ThroughputSummary? Throughput(long operations, long httpRequests, double wallSeconds)
    {
        if (operations <= 0 || wallSeconds <= 0)
        {
            return null;
        }

        return new ThroughputSummary(operations / wallSeconds, httpRequests / wallSeconds);
    }

    public static double[] Downsample(ReadOnlySpan<double> samples, int maxPoints = MaxSamplePoints)
    {
        if (maxPoints < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(maxPoints));
        }

        var n = samples.Length;
        if (n <= maxPoints)
        {
            return samples.ToArray();
        }

        var result = new double[maxPoints];
        if (maxPoints == 1)
        {
            result[0] = samples[0];
            return result;
        }

        for (var i = 0; i < maxPoints; i++)
        {
            var index = (long)i * (n - 1) / (maxPoints - 1);
            result[i] = samples[(int)index];
        }

        return result;
    }
}
