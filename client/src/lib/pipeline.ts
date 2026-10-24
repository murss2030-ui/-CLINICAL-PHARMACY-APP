// Document extraction pipeline:
// IMAGE → QUALITY CHECK → VISION/OCR → STRUCTURED EXTRACTION →
// DUPLICATE DETECTION → CONFLICT DETECTION → VERIFICATION QUEUE.
// Nothing is committed to case data here; the trainee verifies every item.
// A failure at any step leaves all existing case data untouched.
import {
  imageAnalysisSchema,
  labExtractionSchema,
  LIMITS,
  medicationExtractionSchema,
  patientExtractionSchema,
  type AIMeta,
  type ImagePart,
  type LabExtraction,
  type MedicationExtraction,
  type PatientExtraction,
} from '@shared/ai';
import { SOURCE_TYPE_LABEL, type SourceType } from '@shared/domain';
import { aiRequest, AiError, type DemoTarget } from './api';
import { db, audit } from './db';
import { detectDuplicatesAndConflicts } from './dedupe';
import { blobToBase64 } from './image';
import type { AIAnalysisRecord, CaseSource, ExtractedItem, SourcePage } from './types';
import { nowIso, uid } from './utils';

type Extractor = 'patient' | 'medications' | 'labs';

/** Only the extractors relevant to a document type are called (cost control). */
export const EXTRACTORS: Record<SourceType, Extractor[]> = {
  patient_chart: ['patient', 'medications', 'labs'],
  admission_note: ['patient', 'medications', 'labs'],
  progress_note: ['patient', 'medications', 'labs'],
  round_note: ['patient', 'medications', 'labs'],
  free_text: ['patient', 'medications', 'labs'],
  voice_note: ['patient', 'medications', 'labs'],
  other: ['patient', 'medications', 'labs'],
  lab_report: ['labs'],
  medication_order: ['medications'],
  mar: ['medications'],
  antibiotic_chart: ['medications'],
  discharge_list: ['medications'],
  oncology_sheet: ['patient', 'medications', 'labs'],
  nursing_note: ['patient', 'medications'],
  diagnostic_report: ['patient'],
  ecg: ['patient'],
  radiology: ['patient'],
};

export function sourceLabel(s: Pick<CaseSource, 'code' | 'type' | 'label'>): string {
  return `${s.code} · ${s.label || SOURCE_TYPE_LABEL[s.type]}`;
}

async function saveAnalysis(caseId: string, sourceId: string, action: string, result: unknown, meta: AIMeta): Promise<void> {
  const rec: AIAnalysisRecord = {
    id: uid(),
    caseId,
    sourceId,
    action,
    provider: meta.provider,
    model: meta.model,
    result,
    warnings: meta.warnings,
    verificationState: 'unreviewed',
    createdAt: nowIso(),
  };
  await db.aiAnalyses.add(rec);
  await audit(`ai.${action}`, { caseId, actor: 'ai', detail: `${meta.provider}/${meta.model}${meta.cached ? ' (cached)' : ''}` });
}

const PATIENT_KIND: Record<string, ExtractedItem['kind']> = {
  age: 'demographic',
  sex: 'demographic',
  weight_kg: 'demographic',
  height_cm: 'demographic',
  chief_complaint: 'history',
  hpi: 'history',
  pmh: 'history',
  social_history: 'history',
  family_history: 'history',
  physical_exam: 'history',
  admission_date: 'history',
  diagnosis: 'diagnosis',
  allergy: 'allergy',
  nkda: 'nkda',
  vital: 'vital',
  diagnostic: 'diagnostic',
};

function base(caseId: string, sourceId: string, x: { page?: number; confidence: number; alternatives?: string[]; evidenceText?: string; handwritten?: boolean }) {
  return {
    id: uid(),
    caseId,
    sourceId,
    page: x.page || undefined,
    confidence: x.confidence,
    alternatives: x.alternatives ?? [],
    evidenceText: x.evidenceText || undefined,
    handwritten: x.handwritten,
    status: 'pending' as const,
    createdAt: nowIso(),
  };
}

export function patientToItems(caseId: string, sourceId: string, r: PatientExtraction): ExtractedItem[] {
  return r.items.map((i) => {
    const kind = PATIENT_KIND[i.field] ?? 'history';
    let data: Record<string, string | undefined>;
    if (kind === 'demographic') data = { field: i.field, value: i.value, unit: i.unit };
    else if (kind === 'history') data = { key: i.field, value: i.value };
    else if (kind === 'allergy') data = { value: i.value, reaction: i.detail };
    else if (kind === 'vital') data = { type: i.detail || 'Vital', value: i.value, unit: i.unit, takenAt: i.date };
    else if (kind === 'diagnostic') data = { type: i.detail || 'Diagnostic', value: i.value, date: i.date };
    else data = { value: i.value };
    return { ...base(caseId, sourceId, i), kind, data };
  });
}

export function medsToItems(caseId: string, sourceId: string, r: MedicationExtraction): ExtractedItem[] {
  return r.medications.map((m) => ({
    ...base(caseId, sourceId, m),
    kind: 'medication' as const,
    data: { name: m.name, dose: m.dose, unit: m.unit, route: m.route, frequency: m.frequency, indication: m.indication, startDate: m.startDate, stopDate: m.stopDate, status: m.status, listType: m.listType },
  }));
}

export function labsToItems(caseId: string, sourceId: string, r: LabExtraction): ExtractedItem[] {
  return r.labs.map((l) => ({
    ...base(caseId, sourceId, l),
    kind: 'lab' as const,
    data: { name: l.name, value: l.value, unit: l.unit, refRange: l.refRange, flag: l.flag, takenAt: l.takenAt },
  }));
}

function demoTarget(caseDemoKey: string | undefined, source: CaseSource): DemoTarget | undefined {
  return caseDemoKey ? { caseKey: caseDemoKey, docKey: source.demoDocKey } : undefined;
}

export interface PipelineProgress {
  step: 'transcribing' | 'extracting' | 'checking' | 'done';
  detail: string;
}

/**
 * Run the full pipeline for one source. Throws AiError on failure; the source
 * is marked "failed" but no case data is changed or lost.
 */
export async function analyzeSource(sourceId: string, opts: { language?: 'en' | 'ar'; onProgress?: (p: PipelineProgress) => void } = {}): Promise<{ items: number; warnings: string[] }> {
  const source = await db.sources.get(sourceId);
  if (!source) throw new AiError('REQUEST_INVALID');
  const record = await db.cases.get(source.caseId);
  if (!record) throw new AiError('REQUEST_INVALID');
  const language = opts.language ?? 'en';
  const demo = demoTarget(record.isDemo ? record.demoKey : undefined, source);
  const warnings: string[] = [];
  const caseId = source.caseId;

  try {
    let text = source.text?.trim() ?? '';
    const images = await db.images.where('sourceId').equals(sourceId).sortBy('order');

    if (images.length) {
      opts.onProgress?.({ step: 'transcribing', detail: `Reading ${images.length} page(s)…` });
      await db.sources.update(sourceId, { processing: 'analyzing', errorCode: undefined, updatedAt: nowIso() });
      const pages: SourcePage[] = [];
      for (let i = 0; i < images.length; i += LIMITS.maxImages) {
        const batch = images.slice(i, i + LIMITS.maxImages);
        const parts: ImagePart[] = await Promise.all(batch.map(async (img, j) => ({ mimeType: 'image/jpeg' as const, data: await blobToBase64(img.blob), page: i + j + 1 })));
        const { data, meta } = await aiRequest('analyze-images', { caseCode: record.code, sourceType: source.type, department: record.department, images: parts, language }, imageAnalysisSchema, { demo });
        await saveAnalysis(caseId, sourceId, 'analyze-images', data, meta);
        warnings.push(...meta.warnings);
        pages.push(...data.pages.map((p) => ({ ...p })));
        if (data.summary && !source.summary) source.summary = data.summary;
      }
      text = pages
        .sort((a, b) => a.page - b.page)
        .map((p) => `=== PAGE ${p.page} ===\n${p.transcription ?? ''}`)
        .join('\n\n');
      await db.sources.update(sourceId, { processing: 'transcribed', pages, summary: source.summary, updatedAt: nowIso() });
    }

    if (!text) throw new AiError('REQUEST_INVALID', ['This source has no images or text to analyse.']);

    opts.onProgress?.({ step: 'extracting', detail: 'Extracting structured data…' });
    await db.sources.update(sourceId, { processing: 'extracting', updatedAt: nowIso() });
    const body = { caseCode: record.code, sourceType: source.type, department: record.department, text: text.slice(0, LIMITS.maxTextChars), language };
    const items: ExtractedItem[] = [];
    // Sequential calls respect the per-minute quota of free-tier AI plans.
    for (const ex of EXTRACTORS[source.type]) {
      if (ex === 'patient') {
        const { data, meta } = await aiRequest('extract-patient', body, patientExtractionSchema, { demo });
        await saveAnalysis(caseId, sourceId, 'extract-patient', data, meta);
        warnings.push(...meta.warnings);
        items.push(...patientToItems(caseId, sourceId, data));
      } else if (ex === 'medications') {
        const { data, meta } = await aiRequest('extract-medications', body, medicationExtractionSchema, { demo });
        await saveAnalysis(caseId, sourceId, 'extract-medications', data, meta);
        warnings.push(...meta.warnings);
        items.push(...medsToItems(caseId, sourceId, data));
      } else {
        const { data, meta } = await aiRequest('extract-labs', body, labExtractionSchema, { demo });
        await saveAnalysis(caseId, sourceId, 'extract-labs', data, meta);
        warnings.push(...meta.warnings);
        items.push(...labsToItems(caseId, sourceId, data));
      }
    }

    opts.onProgress?.({ step: 'checking', detail: 'Checking duplicates and conflicts…' });
    await commitExtraction(caseId, sourceId, items);
    await db.sources.update(sourceId, { processing: 'extracted', updatedAt: nowIso() });
    opts.onProgress?.({ step: 'done', detail: `${items.length} item(s) ready for verification` });
    return { items: items.length, warnings: [...new Set(warnings)] };
  } catch (err) {
    const error = err instanceof AiError ? err : new AiError('SERVER_ERROR');
    await db.sources.update(sourceId, { processing: 'failed', errorCode: error.code, updatedAt: nowIso() });
    await audit('ai.pipeline.failed', { caseId, actor: 'system', detail: error.code });
    throw error;
  }
}

/** Replace this source's pending items with the new extraction, flagging duplicates and conflicts. */
export async function commitExtraction(caseId: string, sourceId: string, items: ExtractedItem[]): Promise<void> {
  const [existingAll, meds, labs, allergies, caseRecord, sources] = await Promise.all([
    db.extracted.where('caseId').equals(caseId).toArray(),
    db.medications.where('caseId').equals(caseId).toArray(),
    db.labs.where('caseId').equals(caseId).toArray(),
    db.allergies.where('caseId').equals(caseId).toArray(),
    db.cases.get(caseId),
    db.sources.where('caseId').equals(caseId).toArray(),
  ]);
  // Re-analysis replaces earlier undecided items from the same source; decided items are kept.
  const stale = existingAll.filter((e) => e.sourceId === sourceId && e.status === 'pending').map((e) => e.id);
  const existing = existingAll.filter((e) => !stale.includes(e.id));
  const labelOf = (id: string) => {
    const s = sources.find((x) => x.id === id);
    return s ? sourceLabel(s) : 'another source';
  };
  const { items: checked, updates } = detectDuplicatesAndConflicts(items, { existing, meds, labs, allergies, caseRecord, sourceLabel: labelOf });
  await db.transaction('rw', db.extracted, async () => {
    if (stale.length) await db.extracted.bulkDelete(stale);
    await db.extracted.bulkAdd(checked);
    for (const u of updates) await db.extracted.update(u.id, { conflictWith: u.conflictWith, conflictNote: u.conflictNote });
  });
}
