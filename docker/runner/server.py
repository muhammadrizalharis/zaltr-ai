"""zaltr.ai runner — eksekusi kode Python / shell terisolasi dengan WORKSPACE.

Keamanan berlapis (container SUDAH: network internal tanpa internet, read-only
rootfs, cap-drop ALL, non-root, mem/pids limit dari compose). Lapisan proses:
timeout, RLIMIT_AS/CPU/NPROC, output dipotong.

Protokol POST /run:
  { "code": str, "lang": "python"|"sh" (default python),
    "files": { "rel/path": "<base64>" }   # workspace masuk (opsional)
    , "timeout": int (dtk, maks 120) }
  -> { stdout, stderr, exitCode, timeMs,
       files: { "rel/path": "<base64>" }  # berkas BARU/BERUBAH di workspace (maks total 20MB)
       , listing: ["rel/path", ...] }
"""

import base64
import hashlib
import json
import os
import resource
import subprocess
import sys
import tempfile
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

MAX_CODE = 60_000
MAX_OUTPUT = 100_000
DEFAULT_TIMEOUT_S = 30
MAX_TIMEOUT_S = 120
MAX_IN_BYTES = 40 * 1024 * 1024     # total berkas masuk
MAX_OUT_BYTES = 20 * 1024 * 1024    # total berkas keluar
MAX_OUT_FILES = 60


def limit_resources() -> None:
    resource.setrlimit(resource.RLIMIT_AS, (2 * 1024 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_CPU, (MAX_TIMEOUT_S,) * 2)
    resource.setrlimit(resource.RLIMIT_NPROC, (96, 96))


def safe_rel(p: str) -> str | None:
    p = p.replace("\\", "/").lstrip("/")
    if not p or p.startswith("..") or "/../" in p or "/./" in p or "\x00" in p:
        return None
    norm = os.path.normpath(p)
    if norm.startswith("..") or os.path.isabs(norm):
        return None
    return norm


def snapshot(root: str) -> dict[str, tuple[int, str]]:
    """rel -> (size, sha1) untuk semua berkas di workspace."""
    out: dict[str, tuple[int, str]] = {}
    for dp, _dn, fns in os.walk(root):
        for fn in fns:
            full = os.path.join(dp, fn)
            rel = os.path.relpath(full, root)
            if rel.startswith("__pycache__") or "/__pycache__/" in rel or rel == "__main__.py" or rel == "__main__.sh":
                continue
            try:
                st = os.stat(full)
                if not os.path.isfile(full):
                    continue
                h = hashlib.sha1()
                with open(full, "rb") as f:
                    for chunk in iter(lambda: f.read(1 << 16), b""):
                        h.update(chunk)
                out[rel] = (st.st_size, h.hexdigest())
            except OSError:
                continue
    return out


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
            lang = str(data.get("lang", "python") or "python").lower()
            files = data.get("files") or {}
            timeout = int(data.get("timeout") or DEFAULT_TIMEOUT_S)
        except Exception:
            self._json(400, {"error": "payload tidak valid"})
            return
        if not code.strip() or len(code) > MAX_CODE:
            self._json(400, {"error": f"kode kosong atau > {MAX_CODE} karakter"})
            return
        if lang not in ("python", "sh"):
            self._json(400, {"error": "lang harus python|sh"})
            return
        timeout = max(1, min(MAX_TIMEOUT_S, timeout))

        with tempfile.TemporaryDirectory(dir="/tmp") as workdir:
            # Hidrasi workspace masuk.
            total_in = 0
            for rel, b64 in (files.items() if isinstance(files, dict) else []):
                srel = safe_rel(str(rel))
                if not srel:
                    continue
                try:
                    raw = base64.b64decode(str(b64), validate=False)
                except Exception:
                    continue
                total_in += len(raw)
                if total_in > MAX_IN_BYTES:
                    break
                full = os.path.join(workdir, srel)
                os.makedirs(os.path.dirname(full), exist_ok=True)
                with open(full, "wb") as f:
                    f.write(raw)
            before = snapshot(workdir)

            if lang == "python":
                path = os.path.join(workdir, "__main__.py")
                cmd = [sys.executable, path]  # tanpa -I agar bisa import modul di workspace
            else:
                path = os.path.join(workdir, "__main__.sh")
                cmd = ["/bin/sh", "-e", path]
            with open(path, "w") as f:
                f.write(code)

            started = time.monotonic()
            env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": workdir,
                   "MPLBACKEND": "Agg", "MPLCONFIGDIR": workdir, "PYTHONDONTWRITEBYTECODE": "1",
                   "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1", "LANG": "C.UTF-8"}
            try:
                proc = subprocess.run(
                    cmd, capture_output=True, timeout=timeout, cwd=workdir,
                    preexec_fn=limit_resources, env=env,
                )
                stdout = proc.stdout.decode(errors="replace")[:MAX_OUTPUT]
                stderr = proc.stderr.decode(errors="replace")[:MAX_OUTPUT]
                exit_code = proc.returncode
            except subprocess.TimeoutExpired as te:
                stdout = (te.stdout or b"").decode(errors="replace")[:MAX_OUTPUT]
                stderr = f"Dihentikan: melebihi batas {timeout} detik"
                exit_code = 124
            time_ms = int((time.monotonic() - started) * 1000)

            # Kumpulkan berkas BARU/BERUBAH.
            after = snapshot(workdir)
            out_files: dict[str, str] = {}
            total_out = 0
            for rel, (size, sha) in sorted(after.items()):
                if rel in before and before[rel] == (size, sha):
                    continue
                if len(out_files) >= MAX_OUT_FILES or total_out + size > MAX_OUT_BYTES:
                    stderr += f"\n[runner] berkas '{rel}' dilewati: melebihi batas keluaran"
                    continue
                try:
                    with open(os.path.join(workdir, rel), "rb") as f:
                        out_files[rel] = base64.b64encode(f.read()).decode()
                    total_out += size
                except OSError:
                    continue

            self._json(200, {
                "stdout": stdout, "stderr": stderr, "exitCode": exit_code, "timeMs": time_ms,
                "files": out_files, "listing": sorted(after.keys()),
            })


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8484), Handler).serve_forever()
