import { describe, it, expect } from "vitest";
import { MERMAID_MAX_CHARS, diagramFileName, isMermaidClass, pngScale, svgSize } from "@/components/mermaid-utils";

describe("isMermaidClass", () => {
  it.each([
    ["language-mermaid", true],
    ["hljs language-mermaid", true],
    ["language-mermaid block", true],
    ["language-python", false],
    ["language-mermaidish", false],
    ["", false],
    [undefined, false],
  ])("%s -> %s", (cls, expected) => {
    expect(isMermaidClass(cls as string | undefined)).toBe(expected);
  });
});

describe("svgSize", () => {
  it("memakai viewBox (utama), termasuk koma/desimal/offset negatif", () => {
    expect(svgSize('<svg viewBox="0 0 640.5 320">')).toEqual({ w: 640.5, h: 320 });
    expect(svgSize('<svg viewBox="-8,-8,500,250">')).toEqual({ w: 500, h: 250 });
  });
  it("jatuh ke atribut width/height bila tak ada viewBox", () => {
    expect(svgSize('<svg width="400px" height="200">')).toEqual({ w: 400, h: 200 });
  });
  it("viewBox mendahului width/height", () => {
    expect(svgSize('<svg width="10" height="10" viewBox="0 0 700 350">')).toEqual({ w: 700, h: 350 });
  });
  it.each(['<svg viewBox="0 0 0 0">', "<svg>", "bukan svg", '<svg width="0" height="5">'])("tak bisa ditentukan -> null: %s", (s) => {
    expect(svgSize(s)).toBeNull();
  });
});

describe("pngScale", () => {
  it("diagram kecil diperbesar sampai lebar ±1600px, maks 4x", () => {
    expect(pngScale(800)).toBe(2);
    expect(pngScale(400)).toBe(4);
    expect(pngScale(100)).toBe(4);
  });
  it("diagram yang sudah lebar tidak diperbesar (minimum 1x)", () => {
    expect(pngScale(1600)).toBe(1);
    expect(pngScale(3000)).toBe(1);
  });
  it("hasil tak pernah melebihi 6000px lebar", () => {
    expect(pngScale(5000) * 5000).toBeLessThanOrEqual(6000);
    expect(pngScale(8000) * 8000).toBeLessThanOrEqual(6000);
  });
});

describe("diagramFileName", () => {
  it.each([
    ['xychart-beta\n    title "Perbandingan Kinerja Model"\n', "perbandingan-kinerja-model"],
    ["pie title Pangsa Pasar 2026\n  \"A\": 1", "pangsa-pasar-2026"],
    ["---\ntitle: Alur Kerja Sistem\n---\nflowchart TD", "alur-kerja-sistem"],
    ['title "Café & Données: été"', "cafe-donnees-ete"],
  ])("judul -> nama berkas", (code, expected) => {
    expect(diagramFileName(code)).toBe(expected);
  });
  it("tanpa judul / judul hanya simbol -> 'diagram'", () => {
    expect(diagramFileName("flowchart TD\n A-->B")).toBe("diagram");
    expect(diagramFileName('title "!!!"')).toBe("diagram");
  });
  it("tak mengandung karakter bermasalah untuk nama berkas & dibatasi 60 karakter", () => {
    const name = diagramFileName('title "' + "a/b\\c:d*e?".repeat(20) + '"');
    expect(name).toMatch(/^[a-z0-9-]+$/);
    expect(name.length).toBeLessThanOrEqual(60);
  });
});

describe("batas ukuran", () => {
  it("MERMAID_MAX_CHARS wajar (cukup untuk diagram besar, mencegah render berlebihan)", () => {
    expect(MERMAID_MAX_CHARS).toBeGreaterThanOrEqual(10_000);
    expect(MERMAID_MAX_CHARS).toBeLessThanOrEqual(50_000);
  });
});
