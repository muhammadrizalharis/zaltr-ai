#!/usr/bin/env node
// MCP server "calyzr-doc-reader" — memberi Continue kemampuan MEMBACA & MENGEKSTRAK
// dokumen (docx, pdf, xlsx, pptx, csv, teks, kode) langsung dari mesin pengguna.
// Continue mengeksekusi tool ini di sisi klien, jadi berkas lokal/remote terbaca
// dengan ekstraksi yang benar — bukan byte mentah.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { extractText } from "./extract.mjs";

// Batasi akses baca ke root tertentu bila DOC_ROOT diset (opsional, untuk keamanan).
const ROOT = process.env.DOC_ROOT ? path.resolve(expand(process.env.DOC_ROOT)) : null;

function expand(p) {
  if (!p) return p;
  if (p === "~" || p.startsWith("~/")) return path.join(homedir(), p.slice(1));
  return p;
}
function resolveSafe(p) {
  const abs = path.resolve(expand(String(p || ".")));
  if (ROOT && !(abs === ROOT || abs.startsWith(ROOT + path.sep))) {
    throw new Error(`Akses ditolak: di luar DOC_ROOT (${ROOT})`);
  }
  return abs;
}

const TOOLS = [
  {
    name: "read_document",
    description:
      "Baca & ekstrak isi teks dari SATU berkas (docx, pdf, xlsx, pptx, csv, txt, kode, json, md, dll) pada path yang diberikan. Kembalikan teksnya.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Path berkas (absolut atau relatif ke folder kerja; boleh ~)." } },
      required: ["path"],
    },
  },
  {
    name: "list_directory",
    description: "Daftar isi sebuah folder (berkas & subfolder) pada path yang diberikan.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Path folder (boleh ~)." } },
      required: ["path"],
    },
  },
  {
    name: "read_folder",
    description:
      "Baca & ekstrak isi SEMUA dokumen dalam satu folder, SATU PER SATU. Berguna untuk memeriksa banyak berkas sekaligus.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path folder (boleh ~)." },
        max: { type: "number", description: "Maks berkas yang dibaca (default 20)." },
      },
      required: ["path"],
    },
  },
];

const server = new Server({ name: "calyzr-doc-reader", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    if (name === "read_document") {
      const p = resolveSafe(args?.path);
      const buf = await readFile(p);
      const text = await extractText(buf, path.basename(p));
      return { content: [{ type: "text", text: `=== ${p} ===\n${text}` }] };
    }
    if (name === "list_directory") {
      const p = resolveSafe(args?.path);
      const entries = await readdir(p, { withFileTypes: true });
      const lines = entries
        .map((e) => (e.isDirectory() ? "[DIR]  " : "[FILE] ") + e.name)
        .sort();
      return { content: [{ type: "text", text: `Isi folder ${p} (${entries.length} item):\n${lines.join("\n")}` }] };
    }
    if (name === "read_folder") {
      const p = resolveSafe(args?.path);
      const max = Math.max(1, Number(args?.max) || 20);
      const entries = await readdir(p, { withFileTypes: true });
      const files = entries.filter((e) => e.isFile()).slice(0, max);
      const parts = [];
      for (const f of files) {
        const fp = path.join(p, f.name);
        try {
          const buf = await readFile(fp);
          parts.push(`=== ${f.name} ===\n${await extractText(buf, f.name)}`);
        } catch (e) {
          parts.push(`=== ${f.name} ===\n(gagal dibaca: ${e.message})`);
        }
      }
      const note = entries.filter((e) => e.isFile()).length > files.length
        ? `\n\n…(${entries.filter((e) => e.isFile()).length - files.length} berkas lagi tidak dibaca — naikkan 'max')`
        : "";
      return { content: [{ type: "text", text: (parts.join("\n\n") || "(folder kosong / tidak ada berkas)") + note }] };
    }
    return { content: [{ type: "text", text: `Tool tidak dikenal: ${name}` }], isError: true };
  } catch (e) {
    return { content: [{ type: "text", text: `Gagal: ${e.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
