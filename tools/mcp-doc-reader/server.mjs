#!/usr/bin/env node
// MCP server "calyzr-doc-reader" — TANPA dependency (murni Node.js).
// Protokol MCP = JSON-RPC 2.0 di atas stdio, pesan dipisah baris (newline-delimited).
// Ditangani sendiri tanpa SDK, jadi tak ada satu pun paket npm yang diunduh.
import { createInterface } from "node:readline";
import { readFile, readdir, writeFile, appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { extractText } from "./extract.mjs";

function expand(p) {
  if (!p) return p;
  if (p === "~" || p.startsWith("~/")) return path.join(homedir(), p.slice(1));
  return p;
}
// Batasi akses ke folder tertentu bila DOC_ROOT diset (opsional, untuk keamanan).
const ROOT = process.env.DOC_ROOT ? path.resolve(expand(process.env.DOC_ROOT)) : null;
function resolveSafe(p) {
  const abs = path.resolve(expand(String(p || ".")));
  if (ROOT && !(abs === ROOT || abs.startsWith(ROOT + path.sep))) throw new Error(`Akses ditolak: di luar DOC_ROOT (${ROOT})`);
  return abs;
}

const TOOLS = [
  {
    name: "read_document",
    description:
      "Baca & ekstrak isi teks dari SATU berkas (docx, pdf, xlsx, pptx, csv, txt, kode, json, md, dll) pada path yang diberikan.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Path berkas (absolut/relatif; boleh ~)." } },
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
    description: "Baca & ekstrak isi SEMUA dokumen dalam satu folder, SATU PER SATU.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path folder (boleh ~)." },
        max: { type: "number", description: "Maks berkas yang dibaca (default 20)." },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description:
      "Tulis (atau timpa) teks ke sebuah berkas. Membuat folder induk otomatis. Set append=true untuk menambah di akhir.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path berkas tujuan (boleh ~)." },
        content: { type: "string", description: "Isi teks yang akan ditulis." },
        append: { type: "boolean", description: "true = tambahkan di akhir (default: timpa)." },
      },
      required: ["path", "content"],
    },
  },
];

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
const failResp = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });
const textResult = (text, isError = false) => ({ content: [{ type: "text", text }], isError });

async function callTool(name, args) {
  if (name === "read_document") {
    const p = resolveSafe(args?.path);
    return textResult(`=== ${p} ===\n${await extractText(await readFile(p), path.basename(p))}`);
  }
  if (name === "list_directory") {
    const p = resolveSafe(args?.path);
    const entries = await readdir(p, { withFileTypes: true });
    const lines = entries.map((e) => (e.isDirectory() ? "[DIR]  " : "[FILE] ") + e.name).sort();
    return textResult(`Isi folder ${p} (${entries.length} item):\n${lines.join("\n")}`);
  }
  if (name === "read_folder") {
    const p = resolveSafe(args?.path);
    const max = Math.max(1, Number(args?.max) || 20);
    // Batas TOTAL teks agar tak membanjiri editor (penyebab "window not responding").
    const BUDGET = Number(process.env.DOC_FOLDER_BUDGET) || 120_000;
    const files = (await readdir(p, { withFileTypes: true })).filter((e) => e.isFile());
    const parts = [];
    let total = 0;
    for (const f of files.slice(0, max)) {
      if (total >= BUDGET) break;
      const fp = path.join(p, f.name);
      try {
        let t = await extractText(await readFile(fp), f.name);
        const room = BUDGET - total;
        if (t.length > room) t = t.slice(0, room) + "\n…(dipotong; batas total tercapai)";
        total += t.length;
        parts.push(`=== ${f.name} ===\n${t}`);
      } catch (e) {
        parts.push(`=== ${f.name} ===\n(gagal dibaca: ${e.message})`);
      }
    }
    const note = files.length > parts.length
      ? `\n\n…(berhenti di ${parts.length}/${files.length} berkas demi batas ${BUDGET.toLocaleString("id-ID")} karakter — baca lebih spesifik, atau naikkan 'max'/DOC_FOLDER_BUDGET)`
      : "";
    return textResult((parts.join("\n\n") || "(folder kosong / tidak ada berkas)") + note);
  }
  if (name === "write_file") {
    const p = resolveSafe(args?.path);
    const content = String(args?.content ?? "");
    await mkdir(path.dirname(p), { recursive: true });
    if (args?.append) await appendFile(p, content);
    else await writeFile(p, content);
    return textResult(`OK: ${args?.append ? "ditambahkan ke" : "ditulis ke"} ${p} (${Buffer.byteLength(content, "utf8")} byte)`);
  }
  return textResult(`Tool tidak dikenal: ${name}`, true);
}

async function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "calyzr-doc-reader", version: "2.0.0" },
      });
    case "notifications/initialized":
    case "initialized":
      return; // notifikasi (tanpa id) — tak perlu balasan
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: TOOLS });
    case "resources/list":
      return ok(id, { resources: [] });
    case "prompts/list":
      return ok(id, { prompts: [] });
    case "tools/call":
      try {
        return ok(id, await callTool(params?.name, params?.arguments || {}));
      } catch (e) {
        return ok(id, textResult(`Gagal: ${e.message}`, true));
      }
    default:
      if (id !== undefined && id !== null) failResp(id, -32601, `Method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const s = line.trim();
  if (!s) return;
  let msg;
  try {
    msg = JSON.parse(s);
  } catch {
    return; // baris bukan JSON valid — abaikan
  }
  Promise.resolve(handle(msg)).catch((e) => {
    if (msg && msg.id != null) failResp(msg.id, -32603, String((e && e.message) || e));
  });
});
// Saat stdin ditutup, proses keluar ALAMI setelah tool-call yang tertunda selesai
// (tak memakai process.exit agar tak memotong pekerjaan async yang sedang jalan).
