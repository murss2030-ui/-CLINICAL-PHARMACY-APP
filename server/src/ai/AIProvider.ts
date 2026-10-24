// Provider-agnostic AI contract. Routes depend on this interface only: each
// model provider (Gemini, DeepSeek, Kimi) implements it through ModelService,
// the router implements it by delegating to them, and the demo provider
// implements it with scripted responses.
import type {
  AICapability,
  AIProviderName,
  AnalyzeImagesRequest,
  ArgueTurn,
  CaseAnalysis,
  CaseRequest,
  Discussion,
  DiscussionRequest,
  DrpAnalysis,
  ExtractRequest,
  FollowUpPlan,
  GeneratedCase,
  ImageAnalysis,
  LabExtraction,
  Lesson,
  MedicationExtraction,
  MonitoringPlan,
  PatientExtraction,
  Presentation,
  PresentationRequest,
  ReasoningEvaluation,
  RoundNote,
  RoundNoteRequest,
  TeachingQuestions,
  TeachingRequest,
  Timeline,
  TimelineRequest,
  ModelProviderName,
  TranscribeRequest,
  Transcription,
} from '../../../shared/ai';

export interface AIResult<T> {
  data: T;
  warnings: string[];
  /** Set by the router: who actually answered (after any failover). */
  provider?: AIProviderName;
  model?: string;
  fallbackFrom?: ModelProviderName[];
}

export interface AIProvider {
  readonly name: AIProviderName;
  readonly model: string;
  readonly configured: boolean;
  /** Inputs this provider can process. */
  readonly capabilities: readonly AICapability[];
  /** Short routing detail for the status page (never a secret). */
  readonly note?: string;
  /** Model used for a given input type, when it differs from `model`. */
  modelFor?(capability: AICapability): string;
  probe(): Promise<void>;

  analyzeImages(req: AnalyzeImagesRequest): Promise<AIResult<ImageAnalysis>>;
  extractPatientData(req: ExtractRequest): Promise<AIResult<PatientExtraction>>;
  extractMedications(req: ExtractRequest): Promise<AIResult<MedicationExtraction>>;
  extractLabs(req: ExtractRequest): Promise<AIResult<LabExtraction>>;
  transcribeAudio(req: TranscribeRequest): Promise<AIResult<Transcription>>;

  buildTimeline(req: TimelineRequest): Promise<AIResult<Timeline>>;
  analyzeCase(req: CaseRequest): Promise<AIResult<CaseAnalysis>>;
  identifyPotentialDRPs(req: CaseRequest): Promise<AIResult<DrpAnalysis>>;
  generateClinicalDiscussion(req: DiscussionRequest): Promise<AIResult<Discussion>>;
  generateMonitoringPlan(req: CaseRequest): Promise<AIResult<MonitoringPlan>>;
  generateFollowUp(req: CaseRequest): Promise<AIResult<FollowUpPlan>>;
  structureRoundNote(req: RoundNoteRequest): Promise<AIResult<RoundNote>>;
  generatePresentation(req: PresentationRequest): Promise<AIResult<Presentation>>;

  generateTeachingQuestions(req: TeachingRequest): Promise<AIResult<TeachingQuestions>>;
  evaluateStudentReasoning(req: TeachingRequest): Promise<AIResult<ReasoningEvaluation>>;
  continueDialogue(req: TeachingRequest): Promise<AIResult<ArgueTurn>>;
  generateTrainingCase(req: TeachingRequest): Promise<AIResult<GeneratedCase>>;
  generateLesson(req: TeachingRequest): Promise<AIResult<Lesson>>;
}
