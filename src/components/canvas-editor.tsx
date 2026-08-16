"use client";

import { useRef } from "react";

/** Editor kode ringan: gutter nomor baris + Tab (2 spasi). Tanpa dependensi. */
export function CanvasEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const lineCount = value.split("\n").length;

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    onChange(value.slice(0, start) + "  " + value.slice(end));
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + 2;
    });
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <div
        ref={gutterRef}
        className="select-none overflow-hidden bg-bg py-3 pl-3 pr-2 text-right font-mono text-[13px] leading-relaxed text-muted/60"
        aria-hidden
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={() => {
          if (gutterRef.current && taRef.current) gutterRef.current.scrollTop = taRef.current.scrollTop;
        }}
        spellCheck={false}
        className="flex-1 resize-none bg-bg py-3 pl-2 pr-3 font-mono text-[13px] leading-relaxed outline-none"
      />
    </div>
  );
}
