using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace ApiBenchmark.Engine;

// Agendador de atrasos de alta precisão: uma única thread dedicada mantém uma fila de prazos e completa cada espera
// no instante devido. Dorme com temporizador de alta resolução (Windows) ou com espera de ms (demais plataformas)
// até um pouco antes do prazo e gira só no trecho final, então o custo de CPU é de uma thread, não de uma por requisição.
// Task.Delay puro tem granularidade de ~15 ms no Windows e não serve para simular rede.
internal sealed class PreciseDelayScheduler : IDisposable
{
    private const long InlineSpinMicroseconds = 100;
    private const long HighResolutionSpinMicroseconds = 1_000;
    private const long CoarseWindowsSpinMicroseconds = 16_000;
    private const long CoarseSpinMicroseconds = 2_000;

    private static long _totalSpinTicks;

    private readonly object _gate = new();
    private readonly PriorityQueue<DelayEntry, long> _queue = new();
    private readonly AutoResetEvent _wake = new(false);
    private readonly HighResolutionTimer? _timer;
    private readonly WaitHandle[] _handles;
    private readonly long _spinTicks;
    private readonly Thread _thread;

    private int _pending;
    private volatile bool _disposed;

    public PreciseDelayScheduler()
    {
        _timer = HighResolutionTimer.TryCreate();
        _handles = _timer is null ? [_wake] : [_timer, _wake];
        _spinTicks = MicrosecondsToTicks(
            _timer is not null
                ? HighResolutionSpinMicroseconds
                : OperatingSystem.IsWindows() ? CoarseWindowsSpinMicroseconds : CoarseSpinMicroseconds);

        _thread = new Thread(Run)
        {
            IsBackground = true,
            Name = "lab-network-scheduler",
            Priority = ThreadPriority.Highest,
        };
        _thread.Start();
        Prime();
    }

    public bool UsesHighResolutionTimer => _timer is not null;

    public static long InlineSpinTicks { get; } = MicrosecondsToTicks(InlineSpinMicroseconds);

    // CPU gasta girando para esperar com precisão: é custo do simulador, não do sistema medido.
    public static double SpinMilliseconds => Volatile.Read(ref _totalSpinTicks) * 1000.0 / Stopwatch.Frequency;

    public static long MillisecondsToTicks(double milliseconds) =>
        (long)(milliseconds * Stopwatch.Frequency / 1000.0);

    public static void SpinUntil(long deadline)
    {
        var started = Stopwatch.GetTimestamp();
        while (Stopwatch.GetTimestamp() < deadline)
        {
            Thread.SpinWait(8);
        }

        Interlocked.Add(ref _totalSpinTicks, Stopwatch.GetTimestamp() - started);
    }

    // Devolve o instante (Stopwatch) em que a thread do agendador disparou a espera: o atraso medido não inclui o salto
    // de volta ao ThreadPool, que é ruído do cliente e não parte da rede simulada.
    public async Task<long> DelayUntilAsync(long deadline, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        ObjectDisposedException.ThrowIf(_disposed, this);

        var entry = new DelayEntry();
        using var registration = ct.UnsafeRegister(
            static (state, token) => ((DelayEntry)state!).TrySetCanceled(token), entry);

        bool newEarliest;
        lock (_gate)
        {
            newEarliest = !_queue.TryPeek(out _, out var earliest) || deadline < earliest;
            _queue.Enqueue(entry, deadline);
        }

        if (newEarliest)
        {
            Volatile.Write(ref _pending, 1);
            _wake.Set();
        }

        return await entry.Task.ConfigureAwait(false);
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _wake.Set();

        if (!_thread.Join(TimeSpan.FromSeconds(2)))
        {
            return;
        }

        lock (_gate)
        {
            while (_queue.TryDequeue(out var entry, out _))
            {
                entry.TrySetCanceled();
            }
        }

        _timer?.Dispose();
        _wake.Dispose();
    }

    // Esquenta caminhos de código (JIT, P/Invoke, thread) para a primeira espera real já sair precisa.
    private void Prime()
    {
        for (var i = 0; i < 3; i++)
        {
            DelayUntilAsync(Stopwatch.GetTimestamp() + MillisecondsToTicks(2), CancellationToken.None).Wait();
        }
    }

    private static long MicrosecondsToTicks(long microseconds) => microseconds * Stopwatch.Frequency / 1_000_000;

    private void Run()
    {
        while (!_disposed)
        {
            try
            {
                Pump();
            }
            catch (Exception) when (!_disposed)
            {
                Thread.Sleep(1);
            }
        }
    }

    private void Pump()
    {
        Interlocked.Exchange(ref _pending, 0);

        DelayEntry? ready = null;
        var deadline = 0L;
        var empty = true;

        lock (_gate)
        {
            while (_queue.TryPeek(out var top, out var due))
            {
                if (top.Task.IsCompleted)
                {
                    _queue.Dequeue();
                    continue;
                }

                empty = false;
                deadline = due;
                if (due <= Stopwatch.GetTimestamp())
                {
                    _queue.Dequeue();
                    ready = top;
                }

                break;
            }
        }

        if (ready is not null)
        {
            ready.TrySetResult(Stopwatch.GetTimestamp());
            return;
        }

        if (empty)
        {
            _wake.WaitOne();
            return;
        }

        var sleepTicks = deadline - Stopwatch.GetTimestamp() - _spinTicks;
        if (sleepTicks > 0 && TryPark(sleepTicks))
        {
            return;
        }

        var started = Stopwatch.GetTimestamp();
        while (Stopwatch.GetTimestamp() < deadline && Volatile.Read(ref _pending) == 0)
        {
            Thread.SpinWait(8);
        }

        Interlocked.Add(ref _totalSpinTicks, Stopwatch.GetTimestamp() - started);
    }

    private bool TryPark(long ticks)
    {
        if (_timer is not null && _timer.TryArm(ticks))
        {
            WaitHandle.WaitAny(_handles);
            return true;
        }

        var milliseconds = ticks * 1000 / Stopwatch.Frequency;
        if (milliseconds < 1)
        {
            return false;
        }

        _wake.WaitOne((int)Math.Min(milliseconds, int.MaxValue));
        return true;
    }

    private sealed class DelayEntry : TaskCompletionSource<long>
    {
        public DelayEntry()
            : base(TaskCreationOptions.RunContinuationsAsynchronously)
        {
        }
    }

    private sealed class HighResolutionTimer : WaitHandle
    {
        private const uint CreateWaitableTimerHighResolution = 0x00000002;
        private const uint TimerAllAccess = 0x1F0003;

        private HighResolutionTimer(IntPtr handle) => SafeWaitHandle = new SafeWaitHandle(handle, ownsHandle: true);

        public static HighResolutionTimer? TryCreate()
        {
            if (!OperatingSystem.IsWindows())
            {
                return null;
            }

            try
            {
                var handle = CreateWaitableTimerExW(IntPtr.Zero, null, CreateWaitableTimerHighResolution, TimerAllAccess);
                return handle == IntPtr.Zero ? null : new HighResolutionTimer(handle);
            }
            catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException)
            {
                return null;
            }
        }

        public bool TryArm(long ticks)
        {
            var due = -Math.Max(1L, (long)(ticks * 10_000_000.0 / Stopwatch.Frequency));
            return SetWaitableTimer(SafeWaitHandle.DangerousGetHandle(), ref due, 0, IntPtr.Zero, IntPtr.Zero, false);
        }

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateWaitableTimerExW(IntPtr attributes, string? name, uint flags, uint desiredAccess);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetWaitableTimer(
            IntPtr timer, ref long dueTime, int period, IntPtr completionRoutine, IntPtr argument, [MarshalAs(UnmanagedType.Bool)] bool resume);
    }
}
