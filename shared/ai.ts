// Request and response contracts for every AI action.
// The server validates requests with these schemas, asks the configured model
// provider (Gemini, DeepSeek or Kimi) for JSON that matches the response
// schemas, and re-validates the result before returning it. The client
// validates again before rendering.
import { z } from 'zod';
import {
  AI_DRP_STATUSES,
  COMPETENCY_DOMAINS,
  DRP_CATEGORIES,
  FOLLOWUP_WINDOWS,
  MONITORING_CATEGORIES,
  PRIORITIES,
  SOURCE_TYPES,
} from './domain';

// ───────────────────────── shared pieces ─────────────────────────

export const LIMITS = {
  maxImages: 12,
  maxImageBase64Chars: 6_000_000, // ≈4.5 MB decoded per image (client compresses to ~300 KB)
  maxTextChars: 60_000,
  maxAudioBase64Chars: 14_000_000, // ≈10 MB decoded
  maxAnswerChars: 6_000,
} as const;

// Range is normalised and clamped server-side (guards.ts); some models answer 0–100.
const confidence = z.number().describe('Confidence from 0 to 1 (1 = certain).');
const shortText = (max = 2000) => z.string().max(max);
const list = <T extends z.ZodTypeAny>(item: T, max = 60) => z.array(item).max(max).default([]);

export const languageSchema = z.enum(['en', 'ar']).default('en');

export const imagePartSchema = z.object({
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
  data: z.string().min(16).max(LIMITS.maxImageBase64Chars).regex(/^[A-Za-z0-9+/=]+$/, 'Image data must be base64'),
  page: z.number().int().min(1).max(200),
});
export type ImagePart = z.infer<typeof imagePartSchema>;

/** Compact, de-identified case data the client sends for reasoning tasks. */
export const caseContextSchema = z.object({
  caseCode: shortText(40),
  department: shortText(60),
  demographics: z
    .object({
      age: z.number().min(0).max(130).optional(),
      sex: shortText(20).optional(),
      weightKg: z.number().min(0.2).max(400).optional(),
      heightCm: z.number().min(20).max(260).optional(),
    })
    .default({}),
  history: z
    .object({
      chiefComplaint: shortText(3000).optional(),
      hpi: shortText(6000).optional(),
      pmh: shortText(3000).optional(),
      socialHistory: shortText(2000).optional(),
      familyHistory: shortText(2000).optional(),
      physicalExam: shortText(3000).optional(),
    })
    .default({}),
  allergies: list(z.object({ substance: shortText(200), reaction: shortText(300).optional(), verified: z.boolean().default(false) })),
  nkda: z.boolean().optional(),
  medications: list(
    z.object({
      name: shortText(200),
      dose: shortText(100).optional(),
      route: shortText(60).optional(),
      frequency: shortText(100).optional(),
      indication: shortText(300).optional(),
      list: z.enum(['home', 'admission', 'current', 'discharge']).default('current'),
      status: z.enum(['active', 'stopped', 'held', 'unknown']).default('active'),
      startDate: shortText(40).optional(),
      verified: z.boolean().default(false),
    }),
    150,
  ),
  labs: list(
    z.object({
      name: shortText(120),
      value: shortText(60),
      unit: shortText(40).optional(),
      takenAt: shortText(40).optional(),
      flag: shortText(20).optional(),
      verified: z.boolean().default(false),
    }),
    300,
  ),
  vitals: list(z.object({ type: shortText(60), value: shortText(60), takenAt: shortText(40).optional() }), 120),
  diagnostics: list(z.object({ type: shortText(120), result: shortText(2000), date: shortText(40).optional() }), 60),
  problems: list(z.object({ name: shortText(300), status: shortText(30).optional(), priority: shortText(20).optional() }), 60),
  calculated: z
    .object({
      crclMlMin: z.number().optional(),
      egfr: z.number().optional(),
      bmi: z.number().optional(),
      bsa: z.number().optional(),
    })
    .default({}),
  drps: list(
    z.object({ category: shortText(60), medication: shortText(200).optional(), description: shortText(1500), status: shortText(30) }),
    40,
  ),
  interventions: list(z.object({ type: shortText(60), recommendation: shortText(1500), status: shortText(30).optional() }), 40),
  notes: shortText(LIMITS.maxTextChars).optional(),
});
export type CaseContext = z.infer<typeof caseContextSchema>;

// ───────────────────────── requests ─────────────────────────

export const analyzeImagesRequestSchema = z.object({
  caseCode: shortText(40).optional(),
  sourceType: z.enum(SOURCE_TYPES),
  department: shortText(60).optional(),
  images: z.array(imagePartSchema).min(1).max(LIMITS.maxImages),
  language: languageSchema,
});
export type AnalyzeImagesRequest = z.infer<typeof analyzeImagesRequestSchema>;

export const extractRequestSchema = z
  .object({
    caseCode: shortText(40).optional(),
    sourceType: z.enum(SOURCE_TYPES),
    department: shortText(60).optional(),
    text: shortText(LIMITS.maxTextChars).optional(),
    images: z.array(imagePartSchema).max(LIMITS.maxImages).optional(),
    language: languageSchema,
  })
  .refine((v) => (v.text && v.text.trim().length > 0) || (v.images && v.images.length > 0), {
    message: 'Provide document text or at least one image.',
  });
export type ExtractRequest = z.infer<typeof extractRequestSchema>;

export const caseRequestSchema = z.object({ context: caseContextSchema, language: languageSchema });
export type CaseRequest = z.infer<typeof caseRequestSchema>;

export const timelineRequestSchema = z.object({
  context: caseContextSchema,
  sourceTexts: list(z.object({ label: shortText(120), date: shortText(40).optional(), text: shortText(20_000) }), 20),
  language: languageSchema,
});
export type TimelineRequest = z.infer<typeof timelineRequestSchema>;

export const drpInputSchema = z.object({
  category: shortText(60),
  medication: shortText(200).optional(),
  condition: shortText(300).optional(),
  description: shortText(2000),
  patientEvidence: list(shortText(500), 20),
  status: shortText(30).optional(),
  studentReasoning: shortText(LIMITS.maxAnswerChars).optional(),
});

export const discussionRequestSchema = z.object({ context: caseContextSchema, drp: drpInputSchema, language: languageSchema });
export type DiscussionRequest = z.infer<typeof discussionRequestSchema>;

export const presentationRequestSchema = z.object({
  context: caseContextSchema,
  minutes: z.union([z.literal(5), z.literal(10), z.literal(15)]),
  language: languageSchema,
});
export type PresentationRequest = z.infer<typeof presentationRequestSchema>;

export const TEACHING_MODES = ['questions', 'evaluate', 'argue', 'defense', 'generate_case', 'lesson'] as const;
export type TeachingMode = (typeof TEACHING_MODES)[number];

export const teachingRequestSchema = z
  .object({
    mode: z.enum(TEACHING_MODES),
    context: caseContextSchema.optional(),
    stage: shortText(30).optional(),
    question: shortText(2000).optional(),
    answer: shortText(LIMITS.maxAnswerChars).optional(),
    referencePoints: list(shortText(500), 20),
    scenario: shortText(8000).optional(),
    history: list(z.object({ role: z.enum(['preceptor', 'student']), text: shortText(LIMITS.maxAnswerChars) }), 30),
    level: shortText(30).optional(),
    department: shortText(60).optional(),
    focus: shortText(300).optional(),
    language: languageSchema,
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'evaluate' && !v.answer?.trim()) ctx.addIssue({ code: 'custom', message: 'An answer is required for evaluation.' });
    if ((v.mode === 'argue' || v.mode === 'defense') && v.history.length === 0)
      ctx.addIssue({ code: 'custom', message: 'Start the dialogue with the student statement.' });
  });
export type TeachingRequest = z.infer<typeof teachingRequestSchema>;

export const roundNoteRequestSchema = z.object({
  context: caseContextSchema.optional(),
  text: shortText(LIMITS.maxTextChars).min(1),
  language: languageSchema,
});
export type RoundNoteRequest = z.infer<typeof roundNoteRequestSchema>;

export const transcribeRequestSchema = z.object({
  audio: z.object({
    mimeType: z.enum(['audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/flac']),
    data: z.string().min(16).max(LIMITS.maxAudioBase64Chars).regex(/^[A-Za-z0-9+/=]+$/),
  }),
  languageHint: z.enum(['en', 'ar', 'mixed']).default('mixed'),
});
export type TranscribeRequest = z.infer<typeof transcribeRequestSchema>;

// ───────────────────────── responses ─────────────────────────

export const QUALITY_ISSUES = ['blur', 'low_light', 'glare', 'rotated', 'cut_off', 'unreadable_text', 'compression', 'not_a_document'] as const;

export const imageAnalysisSchema = z.object({
  pages: list(
    z.object({
      page: z.number().int().min(1),
      documentType: z.enum(SOURCE_TYPES).describe('Best matching document type for this page.'),
      readable: z.boolean(),
      qualityIssues: list(z.enum(QUALITY_ISSUES), 8),
      rotationDegrees: z.number().int().describe('Clockwise rotation needed to make the text upright: 0, 90, 180 or 270.').default(0),
      handwritten: z.boolean().describe('True if clinically relevant parts are handwritten.'),
      transcription: shortText(20_000).describe(
        'Faithful transcription of the page in reading order. Mark any uncertain word as [?best reading?]. Write [illegible] where text cannot be read. Never complete or correct the document.',
      ),
      uncertainReadings: list(
        z.object({
          text: shortText(200).describe('The uncertain token as it appears.'),
          bestReading: shortText(200),
          alternatives: list(shortText(200), 5),
          confidence,
        }),
        40,
      ),
      pageConfidence: confidence.describe('Overall confidence that the transcription is faithful (0 to 1).'),
    }),
    LIMITS.maxImages,
  ),
  documentDate: shortText(40).optional().describe('Date printed on the document, ISO format if possible.'),
  summary: shortText(800).describe('One or two sentences describing what the document contains. No interpretation.'),
});
export type ImageAnalysis = z.infer<typeof imageAnalysisSchema>;

const extractedBase = {
  page: z.number().int().min(0).describe('Page number (1-based); 0 if unknown.').default(0),
  confidence,
  alternatives: list(shortText(200), 5).describe('Other plausible readings when uncertain.'),
  evidenceText: shortText(500).describe('Short verbatim quote from the source supporting this value.').default(''),
  handwritten: z.boolean().default(false),
};

export const PATIENT_FIELDS = [
  'age',
  'sex',
  'weight_kg',
  'height_cm',
  'chief_complaint',
  'hpi',
  'pmh',
  'social_history',
  'family_history',
  'physical_exam',
  'diagnosis',
  'allergy',
  'nkda',
  'vital',
  'diagnostic',
  'admission_date',
] as const;
export type PatientField = (typeof PATIENT_FIELDS)[number];

export const patientExtractionSchema = z.object({
  items: list(
    z.object({
      field: z.enum(PATIENT_FIELDS),
      value: shortText(3000).describe('Value exactly as documented (normalise units only when explicit).'),
      unit: shortText(40).optional(),
      detail: shortText(300).optional().describe('allergy: reaction/severity; vital: vital type (BP, HR, RR, Temp, SpO2, Pain); diagnostic: test type.'),
      date: shortText(40).optional(),
      ...extractedBase,
    }),
    120,
  ),
  notDocumented: list(shortText(80), 30).describe('Important patient fields that are not documented in this source.'),
});
export type PatientExtraction = z.infer<typeof patientExtractionSchema>;

export const medicationExtractionSchema = z.object({
  medications: list(
    z.object({
      name: shortText(200).describe('Drug name exactly as written (generic or brand). Do not substitute.'),
      dose: shortText(80).optional(),
      unit: shortText(40).optional(),
      route: shortText(60).optional(),
      frequency: shortText(100).optional(),
      indication: shortText(300).optional(),
      startDate: shortText(40).optional(),
      stopDate: shortText(40).optional(),
      status: z.enum(['active', 'stopped', 'held', 'unknown']).default('unknown'),
      listType: z.enum(['home', 'admission', 'current', 'discharge', 'unknown']).default('unknown'),
      ...extractedBase,
    }),
    150,
  ),
});
export type MedicationExtraction = z.infer<typeof medicationExtractionSchema>;

export const labExtractionSchema = z.object({
  labs: list(
    z.object({
      name: shortText(120),
      value: shortText(60).describe('Result exactly as written.'),
      unit: shortText(40).optional(),
      refRange: shortText(80).optional(),
      flag: z.enum(['high', 'low', 'critical', 'normal', 'unknown']).default('unknown'),
      takenAt: shortText(40).optional().describe('Collection date/time if documented.'),
      ...extractedBase,
    }),
    300,
  ),
});
export type LabExtraction = z.infer<typeof labExtractionSchema>;

export const timelineSchema = z.object({
  events: list(
    z.object({
      date: shortText(40).optional().describe('ISO date if documented; omit if not documented.'),
      dayLabel: shortText(40).optional().describe('Relative label as documented, e.g. "Day 2 of admission".'),
      kind: z.enum(['admission', 'diagnosis', 'medication_start', 'medication_stop', 'medication_change', 'lab', 'procedure', 'clinical_event', 'discharge', 'other']),
      label: shortText(200),
      detail: shortText(600).default(''),
      sourceLabel: shortText(120).optional(),
    }),
    80,
  ),
  gaps: list(shortText(300), 15).describe('Periods or events where the chronology is unclear.'),
});
export type Timeline = z.infer<typeof timelineSchema>;

export const caseAnalysisSchema = z.object({
  overview: z.object({
    presentingProblem: shortText(1000),
    relevantHistory: shortText(1500).default(''),
    importantMedications: list(shortText(300), 20),
    importantFindings: list(shortText(300), 20),
    clinicalInstability: list(shortText(300), 10),
    potentialMedicationConcerns: list(shortText(400), 15),
  }),
  suggestedProblems: list(
    z.object({
      name: shortText(200),
      rationale: shortText(800),
      supportingData: list(shortText(300), 10).describe('Only data present in the case context.'),
      priority: z.enum(PRIORITIES),
      priorityReason: shortText(500).default(''),
    }),
    15,
  ),
  missingInformation: list(z.object({ item: shortText(200), whyItMatters: shortText(500) }), 20),
  inferences: list(z.object({ statement: shortText(500), basis: shortText(500) }), 15).describe('Interpretations that are not documented facts.'),
});
export type CaseAnalysis = z.infer<typeof caseAnalysisSchema>;

export const drpAnalysisSchema = z.object({
  drps: list(
    z.object({
      category: z.enum(DRP_CATEGORIES),
      medication: shortText(200).optional().describe('Medication involved, exactly as named in the case. Omit for untreated indications.'),
      condition: shortText(300).optional(),
      description: shortText(800),
      patientEvidence: list(shortText(400), 10).describe('Specific data points from the case context. Never invent values.'),
      clinicalSignificance: shortText(800),
      priority: z.enum(PRIORITIES),
      evidenceBasis: shortText(800).describe('General pharmacotherapy principle. No citations, URLs, or quoted guideline text.'),
      suggestedAction: shortText(800),
      monitoring: shortText(600).default(''),
      followUp: shortText(400).default(''),
      missingData: list(shortText(300), 10),
      confidence,
      status: z.enum(AI_DRP_STATUSES),
    }),
    20,
  ),
  medicationsReviewed: list(
    z.object({ name: shortText(200), concern: z.enum(['none', 'review', 'flag']), note: shortText(400).default('') }),
    150,
  ),
});
export type DrpAnalysis = z.infer<typeof drpAnalysisSchema>;

export const discussionSchema = z.object({
  problem: shortText(800),
  patientEvidence: list(shortText(400), 12),
  assessment: shortText(2000),
  evidenceSummary: shortText(1500).describe('General principles only — no citations, URLs or invented guideline statements.'),
  referencesToConsult: list(shortText(200), 6).describe('Types of authoritative reference to check, e.g. "renal dosing reference", "local antimicrobial protocol".'),
  options: list(z.object({ option: shortText(400), benefits: list(shortText(300), 6), risks: list(shortText(300), 6) }), 6),
  recommendationDraft: shortText(1500),
  rationale: shortText(1500),
  monitoring: list(shortText(300), 10),
  followUp: shortText(600),
  questionsForStudent: list(shortText(300), 5),
});
export type Discussion = z.infer<typeof discussionSchema>;

export const monitoringPlanSchema = z.object({
  items: list(
    z.object({
      parameter: shortText(200),
      category: z.enum(MONITORING_CATEGORIES),
      why: shortText(500),
      baseline: shortText(200).describe('Baseline value from the case, or "not available".'),
      target: shortText(300),
      timing: shortText(200),
      frequency: shortText(200),
      actionIfAbnormal: shortText(500),
      relatedTo: shortText(200).optional().describe('Medication or DRP this parameter relates to.'),
    }),
    30,
  ),
});
export type MonitoringPlan = z.infer<typeof monitoringPlanSchema>;

export const followUpPlanSchema = z.object({
  items: list(
    z.object({
      window: z.enum(FOLLOWUP_WINDOWS),
      dueInDays: z.number().int().min(0).max(365).optional(),
      problem: shortText(300),
      reassess: shortText(500),
      expected: shortText(400),
      failureCriteria: shortText(400),
      nextAction: shortText(500),
    }),
    20,
  ),
});
export type FollowUpPlan = z.infer<typeof followUpPlanSchema>;

export const teachingQuestionsSchema = z.object({
  questions: list(
    z.object({
      question: shortText(500),
      domain: z.enum(COMPETENCY_DOMAINS),
      hint: shortText(300).default(''),
      keyPoints: list(shortText(300), 8).describe('Points a strong answer would include (hidden from the student until they answer).'),
    }),
    8,
  ),
});
export type TeachingQuestions = z.infer<typeof teachingQuestionsSchema>;

export const reasoningEvaluationSchema = z.object({
  overall: z.enum(['on_track', 'partially', 'needs_work']),
  correctElements: list(shortText(400), 12),
  missedElements: list(shortText(400), 12),
  inaccuracies: list(shortText(400), 8),
  explanation: shortText(2500),
  nextTimeStrategy: shortText(800),
  followUpQuestion: shortText(400).optional(),
  domains: list(z.enum(COMPETENCY_DOMAINS), 6),
  knowledgeGaps: list(z.object({ topic: shortText(160), domain: z.enum(COMPETENCY_DOMAINS) }), 6),
});
export type ReasoningEvaluation = z.infer<typeof reasoningEvaluationSchema>;

export const ARGUE_FOCUS = ['why', 'evidence', 'alternative', 'risk', 'monitoring', 'missing_data', 'dose', 'outcome', 'summary'] as const;

export const argueTurnSchema = z.object({
  acknowledgement: shortText(600).describe('Brief, neutral response to what the student said.'),
  challenge: shortText(600).describe('The next single question for the student. Empty when done.'),
  focus: z.enum(ARGUE_FOCUS),
  done: z.boolean(),
  summary: z
    .object({ strengths: list(shortText(300), 6), gaps: list(shortText(300), 6), learningPoint: shortText(500).default('') })
    .optional(),
});
export type ArgueTurn = z.infer<typeof argueTurnSchema>;

export const generatedCaseSchema = z.object({
  title: shortText(200),
  scenario: shortText(4000).describe('Synthetic patient scenario with all data needed for the questions. Fictional.'),
  questions: list(
    z.object({ question: shortText(500), domain: z.enum(COMPETENCY_DOMAINS), keyPoints: list(shortText(300), 8) }),
    6,
  ),
});
export type GeneratedCase = z.infer<typeof generatedCaseSchema>;

export const lessonSchema = z.object({
  topic: shortText(200),
  keyConcepts: list(shortText(400), 8),
  commonPitfalls: list(shortText(300), 6),
  practiceQuestion: shortText(500),
  referencesToConsult: list(shortText(200), 5),
});
export type Lesson = z.infer<typeof lessonSchema>;

export const presentationSchema = z.object({
  title: shortText(200),
  slides: list(
    z.object({
      heading: shortText(120),
      bullets: list(shortText(400), 10),
      speakerNotes: shortText(1500).default(''),
      dataAvailable: z.boolean().describe('False when the section relies on data the case does not contain.'),
    }),
    24,
  ),
  learningPoints: list(shortText(400), 6),
});
export type Presentation = z.infer<typeof presentationSchema>;

export const roundNoteSchema = z.object({
  summary: shortText(800),
  changes: list(shortText(400), 15),
  medicationChanges: list(z.object({ medication: shortText(200), change: shortText(400) }), 20),
  decisions: list(shortText(400), 15),
  possibleNewDrps: list(shortText(400), 10),
  followUpsRequired: list(shortText(400), 10),
  tasks: list(shortText(300), 10),
});
export type RoundNote = z.infer<typeof roundNoteSchema>;

export const transcriptionSchema = z.object({
  transcript: shortText(20_000).describe('Verbatim transcript. Keep drug names and numbers exactly as spoken.'),
  detectedLanguage: z.enum(['en', 'ar', 'mixed', 'unknown']),
  uncertainSegments: list(z.object({ text: shortText(200), alternatives: list(shortText(200), 4) }), 20),
  confidence,
});
export type Transcription = z.infer<typeof transcriptionSchema>;

// ───────────────────────── providers ─────────────────────────

/** Model providers the server can route to. Their keys exist only in the server environment. */
export const MODEL_PROVIDERS = ['gemini', 'deepseek', 'kimi', 'openai', 'anthropic'] as const;
export type ModelProviderName = (typeof MODEL_PROVIDERS)[number];
export type AIProviderName = ModelProviderName | 'demo';

/** What a request needs from a model: plain text, page images, or a voice note. */
export type AICapability = 'text' | 'vision' | 'audio';

export const PROVIDER_INFO: Record<ModelProviderName, { label: string; keyEnv: string; modelEnv: string; account: string }> = {
  gemini: { label: 'Gemini', keyEnv: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL', account: 'Google AI Studio / Google Cloud' },
  deepseek: { label: 'DeepSeek', keyEnv: 'DEEPSEEK_API_KEY', modelEnv: 'DEEPSEEK_MODEL', account: 'DeepSeek platform' },
  kimi: { label: 'Kimi', keyEnv: 'KIMI_API_KEY', modelEnv: 'KIMI_MODEL', account: 'Kimi (Moonshot AI) platform' },
  openai: { label: 'OpenAI', keyEnv: 'OPENAI_API_KEY', modelEnv: 'OPENAI_MODEL', account: 'OpenAI platform' },
  anthropic: { label: 'Claude', keyEnv: 'ANTHROPIC_API_KEY', modelEnv: 'ANTHROPIC_MODEL', account: 'Anthropic Console' },
};

export const CAPABILITY_LABELS: Record<AICapability, string> = { text: 'Text', vision: 'Images', audio: 'Voice' };

export function isModelProvider(value: unknown): value is ModelProviderName {
  return typeof value === 'string' && (MODEL_PROVIDERS as readonly string[]).includes(value);
}

export function providerLabel(name?: string): string {
  if (name === 'demo') return 'Synthetic demo';
  return isModelProvider(name) ? PROVIDER_INFO[name].label : 'AI';
}

// ───────────────────────── envelopes & errors ─────────────────────────

export interface AIMeta {
  provider: AIProviderName;
  model: string;
  cached: boolean;
  latencyMs: number;
  /** Warnings added by server-side guards (grounding, stripped links, clamped values) or failover. */
  warnings: string[];
  /** Providers that failed before the one that answered (automatic failover). */
  fallbackFrom?: ModelProviderName[];
  generatedAt: string;
}

export interface AIEnvelope<T> {
  ok: true;
  data: T;
  meta: AIMeta;
}

export const AI_ERROR_CODES = [
  'AI_KEY_NOT_CONFIGURED',
  'AI_KEY_INVALID',
  'AI_PERMISSION_DENIED',
  'AI_BILLING_REQUIRED',
  'AI_QUOTA_EXCEEDED',
  'AI_SERVICE_UNAVAILABLE',
  'AI_MODEL_NOT_FOUND',
  'AI_PROVIDER_UNREACHABLE',
  'AI_CAPABILITY_UNAVAILABLE',
  'AI_TIMEOUT',
  'AI_NETWORK_ERROR',
  'AI_RESPONSE_INVALID',
  'AI_BLOCKED',
  'REQUEST_TOO_LARGE',
  'REQUEST_INVALID',
  'RATE_LIMITED',
  'UNAUTHORIZED',
  'SERVER_ERROR',
] as const;
export type AIErrorCode = (typeof AI_ERROR_CODES)[number];

export interface AIErrorBody {
  ok: false;
  error: { code: AIErrorCode; message: string; retryable: boolean; provider?: ModelProviderName; details?: string[] };
}

/**
 * Student-facing wording for each error code. Never includes secrets or raw
 * provider output. Provider codes are templates — read them through
 * describeAIError() so the title names the provider that failed
 * (e.g. "GEMINI API KEY INVALID", "DEEPSEEK QUOTA EXCEEDED").
 */
export const AI_ERROR_MESSAGES: Record<AIErrorCode, { title: string; message: string; retryable: boolean }> = {
  AI_KEY_NOT_CONFIGURED: {
    title: '{PROVIDER} API KEY NOT CONFIGURED',
    message: 'The server has no API key for {provider}. Ask the administrator to set {key} in the server environment. You can continue manually.',
    retryable: false,
  },
  AI_KEY_INVALID: {
    title: '{PROVIDER} API KEY INVALID',
    message: '{Provider} rejected the server API key. The administrator needs to replace {key} on the server.',
    retryable: false,
  },
  AI_PERMISSION_DENIED: {
    title: '{PROVIDER} ACCESS DENIED',
    message: 'The server key is not allowed to use the configured model or API on {provider}. Check the key restrictions, the enabled APIs and {model}.',
    retryable: false,
  },
  AI_BILLING_REQUIRED: {
    title: '{PROVIDER} BILLING REQUIRED',
    message: '{Provider} needs billing or account credit for this request. The administrator should check the {account} account.',
    retryable: false,
  },
  AI_QUOTA_EXCEEDED: {
    title: '{PROVIDER} QUOTA EXCEEDED',
    message: '{Provider} reached the quota or rate limit for this key. Wait a minute and retry, or continue manually.',
    retryable: true,
  },
  AI_SERVICE_UNAVAILABLE: {
    title: '{PROVIDER} SERVICE UNAVAILABLE',
    message: '{Provider} is temporarily unavailable. Retry in a moment or continue manually.',
    retryable: true,
  },
  AI_MODEL_NOT_FOUND: {
    title: '{PROVIDER} MODEL NOT AVAILABLE',
    message: 'The configured model is not available on {provider} for this key. The administrator should update {model}.',
    retryable: false,
  },
  AI_PROVIDER_UNREACHABLE: {
    title: 'CANNOT REACH {PROVIDER}',
    message: 'The PRECEPTOR server could not connect to {provider}. The server may be offline or a firewall may block it. Retry later or continue manually.',
    retryable: true,
  },
  AI_CAPABILITY_UNAVAILABLE: {
    title: 'NO AI PROVIDER FOR THIS INPUT',
    message: 'None of the AI providers configured on the server can process this kind of input (voice notes need Gemini; images need Gemini, Kimi, OpenAI or Claude). Continue manually.',
    retryable: false,
  },
  AI_TIMEOUT: { title: 'AI REQUEST TIMED OUT', message: 'The AI took too long to answer. Retry, or send fewer pages at once.', retryable: true },
  AI_NETWORK_ERROR: {
    title: 'AI SERVICE UNAVAILABLE',
    message: 'The PRECEPTOR server could not be reached. You may be offline. Your case data is stored on this device.',
    retryable: true,
  },
  AI_RESPONSE_INVALID: {
    title: 'AI RESPONSE COULD NOT BE VALIDATED',
    message: 'The AI returned a response that did not pass validation, so it was not shown as clinical information. Retry or continue manually.',
    retryable: true,
  },
  AI_BLOCKED: { title: 'AI RESPONSE BLOCKED', message: 'The AI declined to answer this request. Rephrase or continue manually.', retryable: false },
  REQUEST_TOO_LARGE: {
    title: 'REQUEST TOO LARGE',
    message: 'Too many or too large images/text for one request. Analyse fewer pages at a time.',
    retryable: false,
  },
  REQUEST_INVALID: { title: 'REQUEST INVALID', message: 'Some of the data sent to the AI was not valid.', retryable: false },
  RATE_LIMITED: { title: 'TOO MANY REQUESTS', message: 'Too many AI requests in a short time. Wait a minute and retry.', retryable: true },
  UNAUTHORIZED: {
    title: 'SERVER ACCESS CODE REQUIRED',
    message: 'This PRECEPTOR server requires an access code. Enter it in Settings → Server.',
    retryable: false,
  },
  SERVER_ERROR: { title: 'AI SERVICE UNAVAILABLE', message: 'Unexpected server problem. Your case data is safe. Retry or continue manually.', retryable: true },
};

const GENERIC_FILL = {
  PROVIDER: 'AI',
  Provider: 'The AI provider',
  provider: 'the AI provider',
  key: 'a provider key (GEMINI_API_KEY, DEEPSEEK_API_KEY, KIMI_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY)',
  model: 'the model setting',
  account: 'AI provider',
};

/** Error wording with the failing provider filled in (generic wording when it is unknown). */
export function describeAIError(code: AIErrorCode, provider?: string): { title: string; message: string; retryable: boolean } {
  const info = AI_ERROR_MESSAGES[code] ?? AI_ERROR_MESSAGES.SERVER_ERROR;
  const fill: typeof GENERIC_FILL = isModelProvider(provider)
    ? {
        PROVIDER: PROVIDER_INFO[provider].label.toUpperCase(),
        Provider: PROVIDER_INFO[provider].label,
        provider: PROVIDER_INFO[provider].label,
        key: PROVIDER_INFO[provider].keyEnv,
        model: PROVIDER_INFO[provider].modelEnv,
        account: PROVIDER_INFO[provider].account,
      }
    : GENERIC_FILL;
  const sub = (text: string) => text.replace(/\{(PROVIDER|Provider|provider|key|model|account)\}/g, (_, k: keyof typeof GENERIC_FILL) => fill[k]);
  return { title: sub(info.title), message: sub(info.message), retryable: info.retryable };
}

export interface AIProviderStatus {
  name: ModelProviderName;
  label: string;
  configured: boolean;
  model: string;
  /** Extra routing detail, e.g. the vision model or the Google backend in use. */
  note?: string;
  capabilities: AICapability[];
  reachable?: boolean;
  probeError?: AIErrorCode;
  probeDetails?: string[];
}

export interface AIStatus {
  /** True when at least one model provider has a key on the server. */
  configured: boolean;
  /** Failover order used when the client has no preferred provider. */
  order: ModelProviderName[];
  providers: AIProviderStatus[];
  demoAvailable: boolean;
  accessCodeRequired: boolean;
  limits: { maxImages: number; rateLimitPerMinute: number };
  usage: { requests24h: number; errors24h: Partial<Record<AIErrorCode, number>>; cacheHits24h: number };
}
