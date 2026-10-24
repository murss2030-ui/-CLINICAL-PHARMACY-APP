import {
  argueTurnSchema,
  caseAnalysisSchema,
  discussionSchema,
  drpAnalysisSchema,
  followUpPlanSchema,
  generatedCaseSchema,
  imageAnalysisSchema,
  labExtractionSchema,
  lessonSchema,
  medicationExtractionSchema,
  monitoringPlanSchema,
  patientExtractionSchema,
  presentationSchema,
  reasoningEvaluationSchema,
  roundNoteSchema,
  teachingQuestionsSchema,
  timelineSchema,
  transcriptionSchema,
  type AnalyzeImagesRequest,
  type CaseRequest,
  type DiscussionRequest,
  type ExtractRequest,
  type PresentationRequest,
  type RoundNoteRequest,
  type TeachingRequest,
  type TimelineRequest,
  type TranscribeRequest,
} from '../../../shared/ai';
import type { AICapability } from '../../../shared/ai';
import type { AIProvider, AIResult } from './AIProvider';
import type { ModelClient, ModelPart } from './modelClient';
import * as P from './prompts';
import {
  guardDrpAnalysis,
  guardImageAnalysis,
  guardLabExtraction,
  guardMedicationExtraction,
  guardPatientExtraction,
  guardTranscription,
  stripLinks,
} from './guards';
import type { z } from 'zod';

const EXTRACTION_TEMPERATURE = 0.1;

/**
 * The clinical AI tasks (specialised prompts, guards) on top of any model
 * client. Prompts and guards are identical for every provider; only the
 * transport differs.
 */
export class ModelService implements AIProvider {
  constructor(private readonly client: ModelClient) {}

  get name() {
    return this.client.provider;
  }

  get model(): string {
    return this.client.model;
  }

  get configured(): boolean {
    return this.client.configured;
  }

  get capabilities(): readonly AICapability[] {
    return this.client.capabilities;
  }

  get note(): string | undefined {
    return this.client.note;
  }

  modelFor(capability: AICapability): string {
    return this.client.modelFor(capability);
  }

  probe(): Promise<void> {
    return this.client.probe();
  }

  private async run<T extends z.ZodTypeAny>(
    system: string,
    parts: ModelPart[],
    schema: T,
    temperature?: number,
  ): Promise<{ data: z.infer<T>; warnings: string[] }> {
    const { data } = await this.client.generateJson({ system, parts, schema, temperature });
    return { data, warnings: [] };
  }

  // ───────── document intake ─────────

  async analyzeImages(req: AnalyzeImagesRequest) {
    const parts: ModelPart[] = [];
    for (const img of [...req.images].sort((a, b) => a.page - b.page)) {
      parts.push({ text: `=== PAGE ${img.page} ===` });
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    }
    parts.push({ text: 'Analyse and transcribe these pages.' });
    const r = await this.run(P.imageAnalysisPrompt(req.sourceType, req.images.length, req.language, req.department), parts, imageAnalysisSchema, EXTRACTION_TEMPERATURE);
    return { data: guardImageAnalysis(r.data, r.warnings), warnings: r.warnings };
  }

  private extractionParts(req: ExtractRequest): ModelPart[] {
    const parts: ModelPart[] = [];
    for (const img of req.images ?? []) {
      parts.push({ text: `=== PAGE ${img.page} (image) ===` });
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    }
    if (req.text) parts.push({ text: `SOURCE TEXT:\n${req.text}` });
    parts.push({ text: 'Extract the requested data.' });
    return parts;
  }

  async extractPatientData(req: ExtractRequest) {
    const r = await this.run(P.patientExtractionPrompt(req.sourceType, req.language, req.department), this.extractionParts(req), patientExtractionSchema, EXTRACTION_TEMPERATURE);
    return { data: guardPatientExtraction(r.data, req.images?.length ? undefined : req.text, r.warnings), warnings: r.warnings };
  }

  async extractMedications(req: ExtractRequest) {
    const r = await this.run(P.medicationExtractionPrompt(req.sourceType, req.language, req.department), this.extractionParts(req), medicationExtractionSchema, EXTRACTION_TEMPERATURE);
    return { data: guardMedicationExtraction(r.data, req.images?.length ? undefined : req.text, r.warnings), warnings: r.warnings };
  }

  async extractLabs(req: ExtractRequest) {
    const r = await this.run(P.labExtractionPrompt(req.sourceType, req.language, req.department), this.extractionParts(req), labExtractionSchema, EXTRACTION_TEMPERATURE);
    return { data: guardLabExtraction(r.data, req.images?.length ? undefined : req.text, r.warnings), warnings: r.warnings };
  }

  async transcribeAudio(req: TranscribeRequest) {
    const mimeType = req.audio.mimeType === 'audio/x-wav' ? 'audio/wav' : req.audio.mimeType;
    const r = await this.run(
      P.transcriptionPrompt(req.languageHint),
      [{ inlineData: { mimeType, data: req.audio.data } }, { text: 'Transcribe this voice note.' }],
      transcriptionSchema,
      EXTRACTION_TEMPERATURE,
    );
    return { data: guardTranscription(r.data, r.warnings), warnings: r.warnings };
  }

  // ───────── clinical reasoning ─────────

  private async caseTask<T extends z.ZodTypeAny>(system: string, req: CaseRequest, schema: T, extra?: string): Promise<AIResult<z.infer<T>>> {
    const parts: ModelPart[] = [{ text: P.caseBlock(req.context) }];
    if (extra) parts.push({ text: extra });
    const r = await this.run(system, parts, schema);
    return { data: stripLinks(r.data, r.warnings), warnings: r.warnings };
  }

  buildTimeline(req: TimelineRequest) {
    const sources = req.sourceTexts.map((s) => `--- ${s.label}${s.date ? ` (${s.date})` : ''} ---\n${s.text}`).join('\n\n');
    return this.caseTask(P.timelinePrompt(req.language, req.context.department), req, timelineSchema, sources ? `SOURCE TEXTS:\n${sources}` : undefined);
  }

  analyzeCase(req: CaseRequest) {
    return this.caseTask(P.caseAnalysisPrompt(req.language, req.context.department), req, caseAnalysisSchema);
  }

  async identifyPotentialDRPs(req: CaseRequest) {
    const r = await this.run(P.drpPrompt(req.language, req.context.department), [{ text: P.caseBlock(req.context) }], drpAnalysisSchema);
    return { data: guardDrpAnalysis(r.data, req.context, r.warnings), warnings: r.warnings };
  }

  generateClinicalDiscussion(req: DiscussionRequest) {
    return this.caseTask(
      P.discussionPrompt(req.language, req.context.department),
      { context: req.context, language: req.language },
      discussionSchema,
      `POTENTIAL DRP TO DISCUSS:\n${JSON.stringify(req.drp)}`,
    );
  }

  generateMonitoringPlan(req: CaseRequest) {
    return this.caseTask(P.monitoringPrompt(req.language, req.context.department), req, monitoringPlanSchema);
  }

  generateFollowUp(req: CaseRequest) {
    return this.caseTask(P.followUpPrompt(req.language, req.context.department), req, followUpPlanSchema);
  }

  async structureRoundNote(req: RoundNoteRequest) {
    const parts: ModelPart[] = [];
    if (req.context) parts.push({ text: P.caseBlock(req.context) });
    parts.push({ text: `ROUND NOTE:\n${req.text}` });
    const r = await this.run(P.roundNotePrompt(req.language, req.context?.department), parts, roundNoteSchema);
    return { data: stripLinks(r.data, r.warnings), warnings: r.warnings };
  }

  generatePresentation(req: PresentationRequest) {
    return this.caseTask(P.presentationPrompt(req.minutes, req.language, req.context.department), req, presentationSchema);
  }

  // ───────── teaching ─────────

  private teachingParts(req: TeachingRequest): ModelPart[] {
    const parts: ModelPart[] = [];
    if (req.context) parts.push({ text: P.caseBlock(req.context) });
    if (req.scenario) parts.push({ text: `TRAINING SCENARIO (synthetic):\n${req.scenario}` });
    if (req.question) parts.push({ text: `QUESTION:\n${req.question}` });
    if (req.referencePoints.length) parts.push({ text: `REFERENCE POINTS:\n- ${req.referencePoints.join('\n- ')}` });
    if (req.history.length) parts.push({ text: `DIALOGUE SO FAR:\n${req.history.map((h) => `${h.role.toUpperCase()}: ${h.text}`).join('\n')}` });
    if (req.answer) parts.push({ text: `TRAINEE ANSWER:\n${req.answer}` });
    if (parts.length === 0) parts.push({ text: 'Begin.' });
    return parts;
  }

  private async teach<T extends z.ZodTypeAny>(system: string, req: TeachingRequest, schema: T) {
    const r = await this.run(system, this.teachingParts(req), schema);
    return { data: stripLinks(r.data, r.warnings), warnings: r.warnings };
  }

  generateTeachingQuestions(req: TeachingRequest) {
    return this.teach(P.teachingQuestionsPrompt(req.stage, req.language, req.department ?? req.context?.department), req, teachingQuestionsSchema);
  }

  evaluateStudentReasoning(req: TeachingRequest) {
    return this.teach(P.evaluationPrompt(req.language, req.department ?? req.context?.department), req, reasoningEvaluationSchema);
  }

  continueDialogue(req: TeachingRequest) {
    const dept = req.department ?? req.context?.department;
    const system = req.mode === 'defense' ? P.defensePrompt(req.language, dept) : P.arguePrompt(req.language, dept);
    return this.teach(system, req, argueTurnSchema);
  }

  generateTrainingCase(req: TeachingRequest) {
    return this.teach(P.generateCasePrompt(req.level, req.focus, req.language, req.department), req, generatedCaseSchema);
  }

  generateLesson(req: TeachingRequest) {
    return this.teach(P.lessonPrompt(req.focus, req.language, req.department), req, lessonSchema);
  }
}
