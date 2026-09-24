# calyzr-doc-reader (MCP)

MCP server yang memberi **Continue** kemampuan membaca & mengekstrak dokumen
(**docx, pdf, xlsx, pptx, csv, txt, kode, json, md, dll**) **langsung dari mesin tempat
Continue berjalan** — jadi berkas lokal/remote terbaca dengan ekstraksi yang benar,
bukan byte mentah.

Tools yang disediakan:

| Tool | Fungsi |
|---|---|
| `read_document` | Baca & ekstrak satu berkas pada `path`. |
| `list_directory` | Daftar isi folder pada `path`. |
| `read_folder` | Baca & ekstrak SEMUA dokumen dalam folder, satu per satu. |
| `write_file` | Tulis/timpa teks ke berkas pada `path` (opsi `append`). |

## Instalasi

Jalankan di mesin yang menjalankan Continue (mesin lokal, atau host Remote‑SSH/WSL):

```bash
cd tools/mcp-doc-reader
node smoke.mjs     # verifikasi (opsional)
```

**Tanpa dependency apa pun** — tak perlu `npm install`. Cukup **Node.js 18+**. PDF memakai `pdftotext` (poppler) **sistem** bila tersedia (Linux: `sudo apt install poppler-utils` · macOS: `brew install poppler`); docx/xlsx/pptx/teks tak butuh apa pun.

## Konfigurasi Continue

Continue versi baru (`~/.continue/config.yaml`):

```yaml
mcpServers:
  - name: calyzr-doc-reader
    command: node
    args:
      - /ABSOLUTE/PATH/ke/zaltr-ai/tools/mcp-doc-reader/server.mjs
```

Continue versi lama (`~/.continue/config.json`):

```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "stdio",
          "command": "node",
          "args": ["/ABSOLUTE/PATH/ke/zaltr-ai/tools/mcp-doc-reader/server.mjs"]
        }
      }
    ]
  }
}
```

Ganti `/ABSOLUTE/PATH/...` dengan path nyata. Restart Continue, lalu di mode **Agent**
minta mis. _"baca folder JURNAL_SAYA satu per satu"_ — model akan memanggil tool ini.

Opsional: set `DOC_ROOT=/path/aman` untuk membatasi akses baca hanya ke folder itu.
