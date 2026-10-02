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

    // O modo aproximado do GC (precise: false) usa contadores por heap que, com Server GC, ficam atrasados e podem dar delta zero ou subestimado.
    public static long AllocatedBytes() => GC.GetTotalAllocatedBytes(precise: true);
}
