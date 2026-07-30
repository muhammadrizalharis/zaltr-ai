"""zaltr.ai runner — eksekusi kode Python terisolasi.

Keamanan berlapis (container SUDAH: network internal tanpa internet, read-only
rootfs, cap-drop ALL, non-root, mem/pids limit dari compose). Lapisan proses:
timeout 30 dtk, RLIMIT_AS 512MB, RLIMIT_CPU 30 dtk, output dipotong 100KB.
"""

import json
import os
import resource
import subprocess
import sys
import tempfile
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

MAX_CODE = 20_000
MAX_OUTPUT = 100_000
TIMEOUT_S = 30


def limit_resources() -> None:
    # RLIMIT_AS = ruang alamat VIRTUAL; OpenBLAS/numpy memesan besar di muka,
    # jadi longgar (2GB). Pagar memori FISIK sesungguhnya = mem_limit container.
    resource.setrlimit(resource.RLIMIT_AS, (2 * 1024 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_CPU, (TIMEOUT_S,) * 2)
    # Pagar jumlah proses sesungguhnya = pids_limit container (128).
    resource.setrlimit(resource.RLIMIT_NPROC, (96, 96))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args) -> None:  # noqa: N802 — jangan spam log
        pass

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/run":
            self._json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            data = json.loads(self.rfile.read(length))
            code = str(data.get("code", ""))
        except Exception:
            self._json(400, {"error": "payload tidak valid"})
            return
        if not code.strip() or len(code) > MAX_CODE:
            self._json(400, {"error": f"kode kosong atau > {MAX_CODE} karakter"})
            return

        with tempfile.TemporaryDirectory(dir="/tmp") as workdir:
            path = os.path.join(workdir, "main.py")
            with open(path, "w") as f:
                f.write(code)
            started = time.monotonic()
            try:
                proc = subprocess.run(
                    [sys.executable, "-I", path],
                    capture_output=True,
                    timeout=TIMEOUT_S,
                    cwd=workdir,
                    preexec_fn=limit_resources,
                    env={"PATH": "/usr/local/bin:/usr/bin", "HOME": workdir,
                         "MPLBACKEND": "Agg", "MPLCONFIGDIR": workdir,
                         "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1"},
                )
                self._json(200, {
                    "stdout": proc.stdout.decode(errors="replace")[:MAX_OUTPUT],
                    "stderr": proc.stderr.decode(errors="replace")[:MAX_OUTPUT],
                    "exitCode": proc.returncode,
                    "timeMs": int((time.monotonic() - started) * 1000),
                })
            except subprocess.TimeoutExpired:
                self._json(200, {
                    "stdout": "", "stderr": f"Dihentikan: melebihi batas {TIMEOUT_S} detik",
                    "exitCode": 124,
                    "timeMs": TIMEOUT_S * 1000,
                })


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8484), Handler).serve_forever()
