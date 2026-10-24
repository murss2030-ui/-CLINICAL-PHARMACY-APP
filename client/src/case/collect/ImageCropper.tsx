import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';

type Rect = { x: number; y: number; w: number; h: number };

/** Drag a rectangle over the page to crop (relative coordinates). */
export function ImageCropper({ blob, onCancel, onCrop }: { blob: Blob | null; onCancel: () => void; onCrop: (rect: Rect) => void }) {
  const [url, setUrl] = useState<string>();
  const [rect, setRect] = useState<Rect>({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
  const start = useRef<{ x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    setRect({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  const rel = (e: PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  return (
    <Sheet
      open={blob !== null}
      onOpenChange={(o) => !o && onCancel()}
      title="Crop page"
      description="Drag across the area to keep."
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onCrop(rect)} disabled={rect.w < 0.05 || rect.h < 0.05}>
            Apply crop
          </Button>
        </>
      }
    >
      {url && (
        <div
          ref={box}
          className="relative mx-auto max-w-md touch-none select-none"
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            start.current = rel(e);
            setRect({ ...start.current, w: 0, h: 0 });
          }}
          onPointerMove={(e) => {
            if (!start.current) return;
            const p = rel(e);
            const s = start.current;
            setRect({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
          }}
          onPointerUp={() => (start.current = null)}
        >
          <img src={url} alt="Page to crop" className="w-full rounded-lg" draggable={false} />
          <div className="pointer-events-none absolute inset-0 bg-navy-900/40" style={{ clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 ${rect.y * 100}%,${rect.x * 100}% ${rect.y * 100}%,${rect.x * 100}% ${(rect.y + rect.h) * 100}%,${(rect.x + rect.w) * 100}% ${(rect.y + rect.h) * 100}%,${(rect.x + rect.w) * 100}% ${rect.y * 100}%,0 ${rect.y * 100}%)` }} />
          <div className="pointer-events-none absolute border-2 border-white" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }} />
        </div>
      )}
    </Sheet>
  );
}
