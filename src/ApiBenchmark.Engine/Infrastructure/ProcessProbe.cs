using System.Diagnostics;

namespace ApiBenchmark.Engine;

internal static class ProcessProbe
{
    public static double? CpuMilliseconds()
    {
        try
        {
            using var process = Process.GetCurrentProcess();
            return process.TotalProcessorTime.TotalMilliseconds;
        }
        catch
        {
            return null;
        }
    }

    public static long AllocatedBytes() => GC.GetTotalAllocatedBytes(false);
}
