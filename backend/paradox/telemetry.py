"""Real system telemetry for the monitor panel.

Only reports what this machine actually exposes. Anything not readable here is
omitted rather than filled in with a plausible number.
"""

from __future__ import annotations

import shutil
import subprocess
import threading
import time
from typing import Any

import psutil

_last_net: tuple[float, int, int] | None = None

# psutil.cpu_percent() measures against whenever it was last called. The very
# first call in a process has nothing to compare against and returns a
# meaningless number (0.0, or the since-boot average) — so warm it up once at
# import time and throw that first reading away. Every call after this one,
# including the first real sample the telemetry loop takes, is a genuine
# delta over a known interval.
psutil.cpu_percent(interval=None)

# GPU% and both temperatures all come from one PowerShell round trip, which
# costs several hundred ms. Sample it on its own slow cadence in the
# background and serve the cached values in between.
_hw: dict[str, float | None] = {"gpu": None, "cpu_temp": None, "gpu_temp": None}
_hw_at: float = 0.0
_hw_lock = threading.Lock()
HW_INTERVAL = 6.0

# Windows Task Manager's headline "GPU" percentage is not a sum of every
# engine instance — a GPU exposes several engine *types* (3D, Copy, Video
# Decode, Video Encode, ...), and several processes can each be partially
# using the same engine type at once. Task Manager sums the instances that
# share an engine type (that IS the type's true load) and then reports the
# busiest type as "the" GPU percentage. Summing everything instead — which
# earlier code here did — double-counts whenever more than one engine type is
# active at once (e.g. 3D + video decode) and overstates load.
#
# Temperatures have no single reliable source across arbitrary Windows PCs,
# so this tries three, in order, and keeps whatever the first working one
# reports:
#
#  1. LibreHardwareMonitor / OpenHardwareMonitor, if the user has either
#     running — real per-sensor labels ("CPU Package", "GPU Core"), no
#     guessing needed. Most machines will not have this installed, but any
#     that do get the most accurate reading.
#  2. ACPI thermal zones (Win32_PerfFormattedData_...), readable without
#     admin rights. Zone names are OEM-defined — some boards name them "CPU"/
#     "GFX" and this matches those by substring; a great many others use
#     opaque identifiers like "\_TZ.TZ10" with nothing to match on, and this
#     source simply reports nothing rather than guess which zone is which.
#     (MSAcpi_ThermalZoneTemperature under root/wmi needs elevation and is
#     not used.) When more than one zone matches, the hottest is reported —
#     that is the one that would throttle first.
#  3. For GPU only: nvidia-smi, which ships with every NVIDIA driver and
#     needs no admin rights — unambiguous when present, so it overrides
#     whatever the two sources above found. AMD/Intel have no equivalent
#     always-installed CLI, so there is no step 3 for those.
_HW_SCRIPT = r"""
$ProgressPreference = 'SilentlyContinue'
$gpuPct = ''
try {
    $samples = (Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction Stop).CounterSamples
    $groups = $samples | Where-Object { $_.CookedValue -gt 0 -and $_.InstanceName -match 'engtype_(\w+)' } |
        ForEach-Object { [PSCustomObject]@{ Type = $matches[1]; Value = $_.CookedValue } } |
        Group-Object Type |
        ForEach-Object { ($_.Group | Measure-Object Value -Sum).Sum }
    if ($groups) { $gpuPct = [math]::Round(($groups | Measure-Object -Maximum).Maximum, 1) }
} catch {}

$cpuC = ''
$gpuC = ''

foreach ($ns in 'root/LibreHardwareMonitor', 'root/OpenHardwareMonitor') {
    if ($cpuC -and $gpuC) { break }
    try {
        $sensors = Get-CimInstance -Namespace $ns -ClassName Sensor -ErrorAction Stop |
            Where-Object { $_.SensorType -eq 'Temperature' }
        if (-not $cpuC) {
            $cpu = $sensors | Where-Object { $_.Name -match 'CPU Package|CPU Core' } |
                Sort-Object Value -Descending | Select-Object -First 1
            if ($cpu) { $cpuC = [math]::Round($cpu.Value, 1) }
        }
        if (-not $gpuC) {
            $gpu = $sensors | Where-Object { $_.Name -match 'GPU Core|GPU Hot Spot' } |
                Sort-Object Value -Descending | Select-Object -First 1
            if ($gpu) { $gpuC = [math]::Round($gpu.Value, 1) }
        }
    } catch {}
}

if (-not $cpuC -or -not $gpuC) {
    try {
        $zones = Get-CimInstance -Namespace root/cimv2 `
            -ClassName Win32_PerfFormattedData_Counters_ThermalZoneInformation -ErrorAction Stop
        if (-not $cpuC) {
            $cpuVals = $zones | Where-Object { $_.Name -match 'CPU' } |
                ForEach-Object { $_.HighPrecisionTemperature / 10.0 - 273.15 }
            if ($cpuVals) { $cpuC = [math]::Round(($cpuVals | Measure-Object -Maximum).Maximum, 1) }
        }
        if (-not $gpuC) {
            $gpuVals = $zones | Where-Object { $_.Name -match 'GFX|GPU' } |
                ForEach-Object { $_.HighPrecisionTemperature / 10.0 - 273.15 }
            if ($gpuVals) { $gpuC = [math]::Round(($gpuVals | Measure-Object -Maximum).Maximum, 1) }
        }
    } catch {}
}

Write-Output "$gpuPct|$cpuC|$gpuC"
"""


def _parse_hw_line(line: str) -> dict[str, float | None]:
    parts = (line.strip().split("|") + ["", "", ""])[:3]

    def num(text: str) -> float | None:
        text = text.strip()
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            return None

    gpu = num(parts[0])
    return {
        "gpu": min(100.0, gpu) if gpu is not None else None,
        "cpu_temp": num(parts[1]),
        "gpu_temp": num(parts[2]),
    }


def _read_nvidia_gpu_temp() -> float | None:
    """NVIDIA's own driver tool — unambiguous when there's an NVIDIA GPU, and
    needs no admin rights or separate install; it ships with the driver."""
    try:
        proc = subprocess.run(
            ["nvidia-smi", "--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5, check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        lines = [line for line in proc.stdout.splitlines() if line.strip()]
        return float(lines[0].strip()) if lines else None
    except Exception:
        return None


def _read_hardware() -> dict[str, float | None]:
    try:
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", _HW_SCRIPT],
            capture_output=True, text=True, timeout=12, check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        # PowerShell may print a blank line or two before the result; take the
        # last non-empty one.
        lines = [line for line in proc.stdout.splitlines() if line.strip()]
        values = _parse_hw_line(lines[-1]) if lines and "|" in lines[-1] else {
            "gpu": None, "cpu_temp": None, "gpu_temp": None,
        }
    except Exception:
        values = {"gpu": None, "cpu_temp": None, "gpu_temp": None}

    nvidia_temp = _read_nvidia_gpu_temp()
    if nvidia_temp is not None:
        values["gpu_temp"] = nvidia_temp

    return values


def hardware() -> dict[str, float | None]:
    """Last known GPU%/CPU temp/GPU temp, refreshed in the background."""
    global _hw, _hw_at

    def refresh() -> None:
        global _hw, _hw_at
        values = _read_hardware()
        with _hw_lock:
            _hw, _hw_at = values, time.time()

    if time.time() - _hw_at > HW_INTERVAL:
        _hw_at = time.time()  # claim the slot so only one thread refreshes
        threading.Thread(target=refresh, daemon=True).start()
    return _hw


def _network_rates() -> dict[str, float] | None:
    """Bytes/sec since the previous sample. None on the first call."""
    global _last_net
    counters = psutil.net_io_counters()
    now = time.time()
    previous, _last_net = _last_net, (now, counters.bytes_sent, counters.bytes_recv)
    if previous is None:
        return None
    elapsed = max(now - previous[0], 0.001)
    return {
        "up": max(0.0, (counters.bytes_sent - previous[1]) / elapsed),
        "down": max(0.0, (counters.bytes_recv - previous[2]) / elapsed),
    }


def sample() -> dict[str, Any]:
    memory = psutil.virtual_memory()
    disk = shutil.disk_usage("C:\\")
    hw = hardware()

    stats: dict[str, Any] = {
        "cpu": round(psutil.cpu_percent(interval=None), 1),
        "cores": psutil.cpu_count(logical=True) or 0,
        "memory": {
            "percent": round(memory.percent, 1),
            "usedBytes": memory.used,
            "totalBytes": memory.total,
        },
        "disk": {
            "percent": round(disk.used / disk.total * 100, 1),
            "usedBytes": disk.used,
            "totalBytes": disk.total,
        },
        "processes": len(psutil.pids()),
        "capturedAt": int(time.time() * 1000),
    }

    network = _network_rates()
    if network:
        stats["network"] = network

    if hw["gpu"] is not None:
        stats["gpu"] = hw["gpu"]
    if hw["cpu_temp"] is not None:
        stats["cpuTempC"] = hw["cpu_temp"]
    if hw["gpu_temp"] is not None:
        stats["gpuTempC"] = hw["gpu_temp"]

    return stats
