// Post-processing applied to every validated AI result before it leaves the
// server. These guards never add clinical content; they only remove or
// down-grade content that could be mistaken for verified information.
import type {
  CaseContext,
  DrpAnalysis,
  ImageAnalysis,
  LabExtraction,
  MedicationExtraction,
  PatientExtraction,
  Transcription,
} from '../../../shared/ai';

const LINK_PATTERN = /\b(?:https?:\/\/|www\.)[^\s)\]]+|\bdoi:\s*10\.\d{4,9}\/[^\s)\]]+|\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/gi;
export const LINK_REPLACEMENT = '[link removed — SOURCE NOT VERIFIED]';

export function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const scaled = value > 1 ? value / 100 : value;
  return Math.round(Math.min(1, Math.max(0, scaled)) * 100) / 100;
}

/** Recursively replace URLs/DOIs in string fields; the AI must not present links as checked sources. */
export function stripLinks<T>(value: T, warnings: string[]): T {
  let removed = 0;
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      return node.replace(LINK_PATTERN, () => {
        removed++;
        return LINK_REPLACEMENT;
      });
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v);
      return out;
    }
    return node;
  };
  const result = walk(value) as T;
  if (removed > 0) warnings.push(`${removed} link(s) or DOI(s) removed: AI-provided references are not verified sources.`);
  return result;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[\s,]+/g, ' ').trim();
}

/**
 * When extraction ran on text, every value should appear in that text.
 * Values that do not are kept (the trainee decides) but their confidence is
 * capped below the review threshold.
 */
function groundInText<T extends { value?: string; name?: string; confidence: number }>(
  items: T[],
  sourceText: string | undefined,
  pick: (item: T) => string | undefined,
  warnings: string[],
): T[] {
  if (!sourceText) return items;
  const haystack = normalizeText(sourceText);
  let lowered = 0;
  const out = items.map((item) => {
    const needle = pick(item);
    if (!needle) return item;
    const n = normalizeText(needle);
    if (n.length === 0 || haystack.includes(n)) return item;
    lowered++;
    return { ...item, confidence: Math.min(item.confidence, 0.55) };
  });
  if (lowered > 0) warnings.push(`${lowered} extracted value(s) were not found verbatim in the source text; confidence lowered to "review".`);
  return out;
}

export function guardImageAnalysis(data: ImageAnalysis, warnings: string[]): ImageAnalysis {
  const cleaned = stripLinks(data, warnings);
  return {
    ...cleaned,
    pages: cleaned.pages.map((p) => ({
      ...p,
      rotationDegrees: [0, 90, 180, 270].includes(p.rotationDegrees) ? p.rotationDegrees : 0,
      pageConfidence: normalizeConfidence(p.pageConfidence),
      uncertainReadings: p.uncertainReadings.map((u) => ({ ...u, confidence: normalizeConfidence(u.confidence) })),
    })),
  };
}

export function guardPatientExtraction(data: PatientExtraction, text: string | undefined, warnings: string[]): PatientExtraction {
  const items = data.items.map((i) => ({ ...i, confidence: normalizeConfidence(i.confidence) }));
  const shortFields = new Set(['age', 'sex', 'weight_kg', 'height_cm', 'allergy', 'vital', 'admission_date']);
  return stripLinks(
    { ...data, items: groundInText(items, text, (i) => (shortFields.has(i.field) ? i.value : undefined), warnings) },
    warnings,
  );
}

export function guardMedicationExtraction(data: MedicationExtraction, text: string | undefined, warnings: string[]): MedicationExtraction {
  const meds = data.medications.map((m) => ({ ...m, confidence: normalizeConfidence(m.confidence) }));
  return stripLinks({ medications: groundInText(meds, text, (m) => m.name, warnings) }, warnings);
}

export function guardLabExtraction(data: LabExtraction, text: string | undefined, warnings: string[]): LabExtraction {
  const labs = data.labs.map((l) => ({ ...l, confidence: normalizeConfidence(l.confidence) }));
  return stripLinks({ labs: groundInText(labs, text, (l) => l.value, warnings) }, warnings);
}

export function guardTranscription(data: Transcription, warnings: string[]): Transcription {
  return stripLinks({ ...data, confidence: normalizeConfidence(data.confidence) }, warnings);
}

function medKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/)[0] ?? '';
}

/**
 * DRPs must reference medications that exist in the case. A DRP naming an
 * unknown medication (other than "needs additional therapy") is down-graded
 * to "needs_data" so it cannot be mistaken for a grounded finding.
 */
export function guardDrpAnalysis(data: DrpAnalysis, ctx: CaseContext, warnings: string[]): DrpAnalysis {
  const known = new Set(ctx.medications.map((m) => medKey(m.name)).filter(Boolean));
  let ungrounded = 0;
  const drps = data.drps.map((d) => {
    const drp = { ...d, confidence: normalizeConfidence(d.confidence) };
    if (drp.medication && drp.category !== 'needs_additional_therapy') {
      const key = medKey(drp.medication);
      const matched = [...known].some((k) => k === key || k.includes(key) || key.includes(k));
      if (!matched) {
        ungrounded++;
        return {
          ...drp,
          status: 'needs_data' as const,
          confidence: Math.min(drp.confidence, 0.4),
          missingData: [...drp.missingData, `"${drp.medication}" is not in the case medication list — verify before use.`],
        };
      }
    }
    return drp;
  });
  if (ungrounded > 0) warnings.push(`${ungrounded} potential DRP(s) referenced medications not found in the case and were marked "needs additional data".`);
  return stripLinks({ ...data, drps }, warnings);
}
