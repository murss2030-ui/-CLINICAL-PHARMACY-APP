// Camera / gallery intake with multi-page handling, quality check,
// duplicate detection, reorder, rotate, crop, retake and preview.
import { ArrowDown, ArrowUp, Camera, Crop, Eye, ImagePlus, RefreshCcw, RotateCw, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { SOURCE_TYPE_LABEL, type SourceType } from '@shared/domain';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Spinner } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/sheet';
import { audit, db, nextSourceCode, touchCase } from '@/lib/db';
import { cropImage, hammingHex, NEAR_DUPLICATE_BITS, prepareImage, rotateImage, type PreparedImage } from '@/lib/image';
import type { SourceImage } from '@/lib/types';
import { cn, nowIso, todayIso, uid } from '@/lib/utils';
import { ImageCropper } from './ImageCropper';

export interface TrayImage extends PreparedImage {
  key: string;
  url: string;
  duplicateNote?: string;
}

async function toTray(blob: Blob): Promise<TrayImage> {
  const prepared = await prepareImage(blob);
  return { ...prepared, key: uid(), url: URL.createObjectURL(prepared.blob) };
}

export function CaptureTray({ caseId, type, onTypeChange, onSaved, autoFocusCamera }: { caseId: string; type: SourceType; onTypeChange: (t: SourceType) => void; onSaved: (sourceId: string, analyse: boolean) => void; autoFocusCamera?: boolean }) {
  const [images, setImages] = useState<TrayImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [date, setDate] = useState(todayIso());
  const [preview, setPreview] = useState<TrayImage | null>(null);
  const [crop, setCrop] = useState<TrayImage | null>(null);
  const [overrideQuality, setOverrideQuality] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const retakeRef = useRef<HTMLInputElement>(null);
  const retakeKey = useRef<string | null>(null);
  const cameraButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (autoFocusCamera) cameraButton.current?.focus();
  }, [autoFocusCamera]);

  useEffect(() => () => images.forEach((i) => URL.revokeObjectURL(i.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Flag exact or near duplicates against this tray and images already in the case. */
  const markDuplicates = async (list: TrayImage[]): Promise<TrayImage[]> => {
    const existing = await db.images.where('caseId').equals(caseId).toArray();
    const sources = await db.sources.where('caseId').equals(caseId).toArray();
    const label = (img: SourceImage) => `${sources.find((s) => s.id === img.sourceId)?.code ?? 'another source'} page ${img.order + 1}`;
    return list.map((img, i) => {
      const prior = list.slice(0, i).find((o) => o.sha256 === img.sha256 || hammingHex(o.dhash, img.dhash) <= NEAR_DUPLICATE_BITS);
      if (prior) return { ...img, duplicateNote: `Looks like page ${list.indexOf(prior) + 1} in this capture.` };
      const saved = existing.find((o) => o.sha256 === img.sha256 || hammingHex(o.dhash, img.dhash) <= NEAR_DUPLICATE_BITS);
      return { ...img, duplicateNote: saved ? `Looks like ${label(saved)} already in this case.` : undefined };
    });
  };

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const added: TrayImage[] = [];
      for (const f of files) if (f.type.startsWith('image/')) added.push(await toTray(f));
      setImages(await markDuplicates([...images, ...added]));
    } finally {
      setBusy(false);
    }
  };

  const takeFiles = (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []);
    input.value = '';
    void addFiles(files);
  };

  const replace = async (key: string, blob: Blob) => {
    setBusy(true);
    try {
      const fresh = await toTray(blob);
      const next = images.map((i) => {
        if (i.key !== key) return i;
        URL.revokeObjectURL(i.url);
        return { ...fresh, key };
      });
      setImages(await markDuplicates(next));
    } finally {
      setBusy(false);
    }
  };

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...images];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    setImages(next);
  };

  const remove = async (key: string) => {
    const img = images.find((i) => i.key === key);
    if (img) URL.revokeObjectURL(img.url);
    setImages(await markDuplicates(images.filter((i) => i.key !== key)));
  };

  const allReady = images.every((i) => i.quality.ready);
  const save = async (analyse: boolean) => {
    setBusy(true);
    try {
      const sourceId = uid();
      await db.sources.add({
        id: sourceId,
        caseId,
        code: await nextSourceCode(caseId),
        type,
        label: label.trim() || undefined,
        date,
        pageCount: images.length,
        processing: 'captured',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      await db.images.bulkAdd(
        images.map((img, order) => ({ id: uid(), caseId, sourceId, order, blob: img.blob, width: img.width, height: img.height, sha256: img.sha256, dhash: img.dhash, quality: img.quality, createdAt: nowIso() })),
      );
      await touchCase(caseId);
      await audit('source.capture', { caseId, detail: `${SOURCE_TYPE_LABEL[type]} · ${images.length} page(s)` });
      images.forEach((i) => URL.revokeObjectURL(i.url));
      setImages([]);
      setLabel('');
      setOverrideQuality(false);
      onSaved(sourceId, analyse);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => takeFiles(e.target)} data-testid="camera-input" />
      <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => takeFiles(e.target)} data-testid="gallery-input" />
      <input
        ref={retakeRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f && retakeKey.current) void replace(retakeKey.current, f);
        }}
      />
      <div className="grid grid-cols-2 gap-2">
        <Button ref={cameraButton} size="lg" onClick={() => cameraRef.current?.click()}>
          <Camera /> Camera
        </Button>
        <Button size="lg" variant="secondary" onClick={() => galleryRef.current?.click()}>
          <ImagePlus /> Gallery (multiple)
        </Button>
      </div>
      {busy && (
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <Spinner className="size-4" /> Compressing and checking image quality…
        </p>
      )}

      {images.length > 0 && (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-semibold text-navy-900">
            {images.length} page{images.length > 1 ? 's' : ''} captured — {SOURCE_TYPE_LABEL[type]}
          </p>
          <ol className="space-y-2">
            {images.map((img, i) => (
              <li key={img.key} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-2">
                <button type="button" onClick={() => setPreview(img)} className="relative shrink-0" aria-label={`Preview page ${i + 1}`}>
                  <img src={img.url} alt={`Page ${i + 1}`} className="h-24 w-18 rounded-lg object-cover" />
                  <span className="absolute left-1 top-1 rounded bg-navy-900 px-1.5 text-xs font-bold text-white">{i + 1}</span>
                </button>
                <div className="min-w-0 flex-1">
                  {img.quality.ready ? (
                    <Badge tone="green">Ready for analysis</Badge>
                  ) : (
                    <Badge tone="red">Quality too low — retake image</Badge>
                  )}
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {img.quality.issues.map((q) => (
                      <li key={q.code} className={q.severity === 'fail' ? 'text-red-700' : 'text-amber-700'}>
                        {q.message}
                      </li>
                    ))}
                    {img.duplicateNote && <li className="font-semibold text-orange-700">Possible duplicate: {img.duplicateNote}</li>}
                  </ul>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <Button size="icon" variant="ghost" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
                      <ArrowUp />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === images.length - 1}>
                      <ArrowDown />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label="Rotate" onClick={async () => replace(img.key, await rotateImage(img.blob, 90))}>
                      <RotateCw />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label="Crop" onClick={() => setCrop(img)}>
                      <Crop />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Retake"
                      onClick={() => {
                        retakeKey.current = img.key;
                        retakeRef.current?.click();
                      }}
                    >
                      <RefreshCcw />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label="Preview" onClick={() => setPreview(img)}>
                      <Eye />
                    </Button>
                    <Button size="icon" variant="ghost" className="text-red-700" aria-label="Delete page" onClick={() => remove(img.key)}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Document type">
              {(id) => (
                <select id={id} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3" value={type} onChange={(e) => onTypeChange(e.target.value as SourceType)}>
                  {Object.entries(SOURCE_TYPE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Label (optional)">{(id) => <Input id={id} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Day 2 labs" />}</Field>
            <Field label="Document date">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          </div>
          {!allReady && (
            <label className="flex items-start gap-2 text-sm text-amber-900">
              <input type="checkbox" className="mt-1 size-4" checked={overrideQuality} onChange={(e) => setOverrideQuality(e.target.checked)} />
              Save anyway — I understand low-quality pages may be misread and every value must be verified.
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="med" onClick={() => save(true)} disabled={busy || (!allReady && !overrideQuality)}>
              Save & analyse with AI
            </Button>
            <Button variant="secondary" onClick={() => save(false)} disabled={busy || (!allReady && !overrideQuality)}>
              Save to source library
            </Button>
          </div>
        </div>
      )}

      <Sheet open={preview !== null} onOpenChange={(o) => !o && setPreview(null)} title="Page preview" wide>
        {preview && (
          <div className="space-y-2">
            <img src={preview.url} alt="Page preview" className="mx-auto max-h-[70dvh] rounded-lg" />
            <p className={cn('text-center text-xs text-slate-500')}>
              {preview.width}×{preview.height}px · brightness {preview.quality.metrics.brightness} · contrast {preview.quality.metrics.contrast} · sharpness {preview.quality.metrics.sharpness}
            </p>
          </div>
        )}
      </Sheet>
      <ImageCropper
        blob={crop?.blob ?? null}
        onCancel={() => setCrop(null)}
        onCrop={async (rect) => {
          if (crop) await replace(crop.key, await cropImage(crop.blob, rect));
          setCrop(null);
        }}
      />
    </div>
  );
}
