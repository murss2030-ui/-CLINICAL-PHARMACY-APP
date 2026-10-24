// Client-side entity model. Every clinical record references its Case by
// caseId (normalised relationships) and carries provenance so the UI can
// always show where a value came from and whether it was verified.
import type {
  AIProviderName,
  Discussion,
  ModelProviderName,
  Presentation as PresentationData,
  ReasoningEvaluation,
  RoundNote as RoundNoteData,
} from '@shared/ai';
import type { DepartmentId } from '@shared/departments';
import type {
  CaseMode,
  CompetencyDomain,
  CompetencyLevel,
  DrpCategory,
  DrpStatus,
  FollowUpStatus,
  FollowUpWindow,
  InterventionType,
  MonitoringCategory,
  Priority,
  SourceType,
  StageId,
} from '@shared/domain';

export type VerificationStatus = 'verified' | 'pending' | 'corrected' | 'rejected' | 'conflict';

export interface Provenance {
  origin: 'manual' | 'extracted' | 'ai' | 'demo';
  sourceId?: string;
  sourceLabel?: string;
  page?: number;
  confidence?: number;
  verification: VerificationStatus;
  verifiedAt?: string;
  alternatives?: string[];
  handwritten?: boolean;
  evidenceText?: string;
}

export interface Rotation {
  id: string;
  name: string;
  department: DepartmentId;
  startDate?: string;
  endDate?: string;
  objectives: string[];
  diseaseStates: string[];
  medicationClasses: string[];
  clinicalSkills: string[];
  epas: string[];
  presentationRequirements?: string;
  isCurrent: boolean;
  createdAt: string;
}

export type Sex = 'Female' | 'Male' | 'Other' | 'Unknown';

export interface CaseRecord {
  id: string;
  code: string;
  department: DepartmentId;
  ward?: string;
  encounter?: string;
  age?: number;
  sex?: Sex;
  weightKg?: number;
  heightCm?: number;
  demographicsProv?: Partial<Record<'age' | 'sex' | 'weightKg' | 'heightCm', Provenance>>;
  mainProblem?: string;
  priority: Priority;
  status: 'active' | 'completed' | 'archived';
  stage: StageId;
  mode: CaseMode;
  nkda?: boolean;
  diagnosticsNotApplicable?: boolean;
  noDrpReasoning?: string;
  goals?: string;
  nonPharmPlan?: string;
  outcome?: string;
  isDemo?: boolean;
  demoKey?: string;
  rotationId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export type ProcessingStatus = 'captured' | 'analyzing' | 'transcribed' | 'extracting' | 'extracted' | 'failed';

export interface SourcePage {
  page: number;
  transcription?: string;
  readable?: boolean;
  qualityIssues?: string[];
  rotationDegrees?: number;
  handwritten?: boolean;
  pageConfidence?: number;
  uncertainReadings?: Array<{ text: string; bestReading: string; alternatives: string[]; confidence: number }>;
}

export interface CaseSource {
  id: string;
  caseId: string;
  code: string;
  type: SourceType;
  label?: string;
  date: string;
  pageCount: number;
  text?: string;
  audioMime?: string;
  audio?: Blob;
  processing: ProcessingStatus;
  errorCode?: string;
  pages?: SourcePage[];
  summary?: string;
  demoDocKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImageQuality {
  ready: boolean;
  score: number;
  issues: Array<{ code: string; message: string; severity: 'fail' | 'warn' }>;
  metrics: { width: number; height: number; brightness: number; contrast: number; sharpness: number; bytesPerPixel: number };
}

export interface SourceImage {
  id: string;
  caseId: string;
  sourceId: string;
  order: number;
  blob: Blob;
  width: number;
  height: number;
  sha256: string;
  dhash: string;
  quality: ImageQuality;
  createdAt: string;
}

export type ExtractedKind = 'demographic' | 'history' | 'allergy' | 'nkda' | 'medication' | 'lab' | 'vital' | 'diagnostic' | 'diagnosis';

export interface ExtractedItem {
  id: string;
  caseId: string;
  sourceId: string;
  kind: ExtractedKind;
  /** Kind-specific payload, e.g. { name, dose, unit, route, frequency, listType } for medications. */
  data: Record<string, string | undefined>;
  page?: number;
  confidence: number;
  alternatives: string[];
  evidenceText?: string;
  handwritten?: boolean;
  status: 'pending' | 'verified' | 'corrected' | 'rejected';
  duplicateOf?: string;
  duplicateNote?: string;
  conflictWith?: string[];
  conflictNote?: string;
  committedRef?: { table: string; id: string };
  createdAt: string;
  decidedAt?: string;
}

export type ProfileKey = 'chief_complaint' | 'hpi' | 'pmh' | 'social_history' | 'family_history' | 'physical_exam' | 'admission_date';

export interface ProfileEntry {
  id: string;
  caseId: string;
  key: ProfileKey;
  value: string;
  prov: Provenance;
  createdAt: string;
}

export interface Allergy {
  id: string;
  caseId: string;
  substance: string;
  reaction?: string;
  severity?: string;
  prov: Provenance;
  createdAt: string;
}

export type MedList = 'home' | 'admission' | 'current' | 'discharge';

export interface Medication {
  id: string;
  caseId: string;
  name: string;
  dose?: string;
  unit?: string;
  route?: string;
  frequency?: string;
  indication?: string;
  startDate?: string;
  stopDate?: string;
  list: MedList;
  status: 'active' | 'stopped' | 'held' | 'unknown';
  prov: Provenance;
  createdAt: string;
}

export interface LabResult {
  id: string;
  caseId: string;
  name: string;
  value: string;
  unit?: string;
  refRange?: string;
  flag?: string;
  takenAt?: string;
  prov: Provenance;
  createdAt: string;
}

export interface VitalSign {
  id: string;
  caseId: string;
  type: string;
  value: string;
  unit?: string;
  takenAt?: string;
  prov: Provenance;
  createdAt: string;
}

export interface Diagnostic {
  id: string;
  caseId: string;
  type: string;
  result: string;
  date?: string;
  prov: Provenance;
  createdAt: string;
}

export interface ClinicalProblem {
  id: string;
  caseId: string;
  name: string;
  status: 'active' | 'resolved' | 'suspected';
  priority?: Priority;
  rank?: number;
  origin: 'student' | 'documented' | 'ai';
  rationale?: string;
  priorityReason?: string;
  prov: Provenance;
  createdAt: string;
}

export interface TimelineEvent {
  id: string;
  caseId: string;
  date?: string;
  dayLabel?: string;
  kind: string;
  label: string;
  detail?: string;
  origin: 'ai' | 'manual' | 'demo';
  sourceLabel?: string;
  createdAt: string;
}

export interface Drp {
  id: string;
  caseId: string;
  category: DrpCategory;
  medication?: string;
  condition?: string;
  description: string;
  patientEvidence: string[];
  clinicalSignificance?: string;
  priority: Priority;
  evidenceBasis?: string;
  suggestedAction?: string;
  monitoring?: string;
  followUp?: string;
  missingData?: string[];
  confidence?: number;
  status: DrpStatus;
  origin: 'student' | 'ai' | 'demo';
  studentReasoning?: string;
  discussion?: Discussion;
  discussionProvider?: AIProviderName;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Intervention {
  id: string;
  caseId: string;
  drpId?: string;
  type: InterventionType;
  recommendation: string;
  rationale?: string;
  alternative?: string;
  expectedOutcome?: string;
  goal?: string;
  communicatedTo?: string;
  status: 'draft' | 'proposed' | 'accepted' | 'modified' | 'rejected' | 'implemented';
  outcome?: string;
  origin: 'student' | 'ai_draft' | 'demo';
  createdAt: string;
  updatedAt: string;
}

export interface MonitoringItem {
  id: string;
  caseId: string;
  interventionId?: string;
  drpId?: string;
  parameter: string;
  category: MonitoringCategory;
  why?: string;
  baseline?: string;
  target?: string;
  timing?: string;
  frequency?: string;
  actionIfAbnormal?: string;
  relatedTo?: string;
  origin: 'student' | 'ai_draft' | 'demo';
  createdAt: string;
}

export interface FollowUp {
  id: string;
  caseId: string;
  interventionId?: string;
  drpId?: string;
  window: FollowUpWindow;
  dueDate?: string;
  parameter: string;
  reassess?: string;
  target?: string;
  failureCriteria?: string;
  actionIfAbnormal?: string;
  outcome?: string;
  status: FollowUpStatus;
  origin: 'student' | 'ai_draft' | 'demo';
  createdAt: string;
  completedAt?: string;
}

export interface Task {
  id: string;
  caseId?: string;
  title: string;
  priority: Priority;
  dueDate?: string;
  owner?: string;
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
  outcome?: string;
  followUpId?: string;
  origin: 'manual' | 'followup' | 'round';
  createdAt: string;
  completedAt?: string;
}

export interface Reflection {
  id: string;
  caseId?: string;
  answers: Record<string, string>;
  nextLearningTarget?: string;
  createdAt: string;
}

export interface EvidenceRecord {
  id: string;
  caseId: string;
  drpId?: string;
  sourceType: 'guideline' | 'drug_reference' | 'study' | 'systematic_review' | 'protocol' | 'other';
  title: string;
  year?: string;
  citation?: string;
  url?: string;
  dateChecked: string;
  application?: string;
  createdAt: string;
}

export interface PresentationRecord {
  id: string;
  caseId: string;
  minutes: 5 | 10 | 15;
  data: PresentationData;
  generatedBy: 'template' | AIProviderName;
  createdAt: string;
}

export interface AIAnalysisRecord {
  id: string;
  caseId?: string;
  sourceId?: string;
  action: string;
  provider: AIProviderName;
  model: string;
  result: unknown;
  warnings: string[];
  verificationState: 'unreviewed' | 'reviewed' | 'accepted' | 'dismissed';
  /** Per-suggestion trainee decisions, keyed by the suggestion's index in the result. */
  decisions?: Record<number, 'accepted' | 'dismissed'>;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  caseId?: string;
  ts: string;
  actor: 'student' | 'ai' | 'system';
  action: string;
  detail?: string;
}

export interface StudentAnswer {
  id: string;
  caseId?: string;
  exerciseId?: string;
  context: 'case' | 'training';
  stage?: string;
  question: string;
  answer: string;
  referencePoints?: string[];
  evaluation?: ReasoningEvaluation;
  evaluatedBy?: AIProviderName | 'self';
  createdAt: string;
}

export interface ReconDecision {
  id: string;
  caseId: string;
  key: string;
  classification: 'intentional' | 'potentially_unintentional' | 'uncertain';
  note?: string;
  verified: boolean;
  updatedAt: string;
}

export interface Dialogue {
  id: string;
  caseId?: string;
  mode: 'argue' | 'defense';
  drpId?: string;
  turns: Array<{ role: 'preceptor' | 'student'; text: string }>;
  done: boolean;
  summary?: { strengths: string[]; gaps: string[]; learningPoint: string };
  provider?: AIProviderName;
  createdAt: string;
  updatedAt: string;
}

export interface RoundEntry {
  id: string;
  caseId: string;
  text: string;
  structured?: RoundNoteData;
  provider?: AIProviderName;
  createdAt: string;
}

export interface Competency {
  id: CompetencyDomain;
  level: CompetencyLevel;
  notes?: string;
  supervisorFeedback?: string;
  updatedAt: string;
}

export interface KnowledgeGap {
  id: string;
  topic: string;
  domain: CompetencyDomain;
  count: number;
  lastSeen: string;
  examples: string[];
  status: 'open' | 'improving' | 'resolved';
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

export interface AppSettings {
  apiBase: string;
  accessCode: string;
  /** Provider the server should try first; 'auto' uses the server's failover order. */
  aiProvider: 'auto' | ModelProviderName;
  language: 'en' | 'ar';
  largeText: boolean;
  defaultDepartment: DepartmentId;
  ownerName: string;
  privacyAcknowledged: boolean;
}
