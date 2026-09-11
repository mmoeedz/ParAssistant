"""Real system telemetry for the monitor panel.

Only reports what this machine actually exposes. Anything psutil cannot read on
Windows is omitted rather than filled in with a plausible number.
"""

from __future__ import annotations

import shutil
import subprocess
import threading
import time
from typing import Any

import psutil

_last_net: tuple[float, int, int] | None = None

# GPU comes from a Windows performance counter, which costs ~700ms through
# PowerShell. Sample it on its own slow cadence and serve the cached value.
_gpu: float | None = None
_gpu_at: float = 0.0
_gpu_lock = threading.Lock()
GPU_INTERVAL = 6.0


def _read_gpu() -> float | None:
    try:
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command",
             r"$s=(Get-Counter '\GPU Engine(*)\Utilization Percentage' "
             r"-ErrorAction SilentlyContinue).CounterSamples | "
             r"Measure-Object -Property CookedValue -Sum; [math]::Round($s.Sum,1)"],
            capture_output=True, text=True, timeout=12, check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        value = proc.stdout.strip()
        return min(100.0, float(value)) if value else None
    except Exception:
        return None


def gpu_percent() -> float | None:
    """Last known GPU load, refreshed in the background."""
    global _gpu, _gpu_at

    def refresh() -> None:
        global _gpu, _gpu_at
        value = _read_gpu()
        with _gpu_lock:
            _gpu, _gpu_at = value, time.time()

    if time.time() - _gpu_at > GPU_INTERVAL:
        _gpu_at = time.time()  # claim the slot so only one thread refreshes
        threading.Thread(target=refresh, daemon=True).start()
    return _gpu


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


def _temperature() -> float | None:
    """Windows almost never exposes this through psutil; say nothing if so."""
    getter = getattr(psutil, "sensors_temperatures", None)
    if not getter:
        return None
    try:
        readings = getter()
    except Exception:
        return None
    for entries in readings.values():
        for entry in entries:
            if entry.current:
                return round(float(entry.current), 1)
    return None


def sample() -> dict[str, Any]:
    memory = psutil.virtual_memory()
    disk = shutil.disk_usage("C:\\")

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

    temperature = _temperature()
    if temperature is not None:
        stats["temperature"] = temperature

    gpu = gpu_percent()
    if gpu is not None:
        stats["gpu"] = gpu

    return stats
