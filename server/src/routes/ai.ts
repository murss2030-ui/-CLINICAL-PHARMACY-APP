import { Router, type Request, type Response } from 'express';
import type { z } from 'zod';
import {
  LIMITS,
  analyzeImagesRequestSchema,
  argueTurnSchema,
  caseAnalysisSchema,
  caseRequestSchema,
  discussionRequestSchema,
  discussionSchema,
  drpAnalysisSchema,
  extractRequestSchema,
  followUpPlanSchema,
  generatedCaseSchema,
  imageAnalysisSchema,
  labExtractionSchema,
  lessonSchema,
  medicationExtractionSchema,
  monitoringPlanSchema,
  patientExtractionSchema,
  presentationRequestSchema,
  presentationSchema,
  reasoningEvaluationSchema,
  roundNoteRequestSchema,
  roundNoteSchema,
  teachingQuestionsSchema,
  teachingRequestSchema,
  timelineRequestSchema,
  timelineSchema,
  transcribeRequestSchema,
  transcriptionSchema,
  isModelProvider,
  type AIStatus,
  type TeachingRequest,
} from '../../../shared/ai';
import type { AIProvider, AIResult } from '../ai/AIProvider';
import { ResponseCache } from '../ai/cache';
import { DemoProvider } from '../ai/DemoProvider';
import { AIError, redact, toAIError } from '../ai/errors';
import { PROMPT_VERSION } from '../ai/prompts';
import type { AIRouter } from '../ai/router';
import type { AuditRepository } from '../db/repository';
import { sendError } from '../middleware/security';

export interface AiRouterDeps {
  router: AIRouter;
  audit: AuditRepository;
  cache: ResponseCache<AIResult<unknown>>;
  rateLimitPerMinute: number;
  accessCodeRequired: boolean;
  log: (msg: string) => void;
}

type Exec<B> = (provider: AIProvider, body: B) => Promise<AIResult<unknown>>;

/**
 * Demo requests are identified by headers and served only by the scripted
 * DemoProvider. Everything else goes to the router, starting with the
 * provider the user prefers (x-preceptor-provider), if any.
 */
function pickProvider(req: Request, deps: AiRouterDeps): { provider: AIProvider; scope: string } {
  const demoCase = req.get('x-preceptor-demo-case');
  if (demoCase && DemoProvider.isDemoCase(demoCase)) return { provider: new DemoProvider(demoCase, req.get('x-preceptor-demo-doc') ?? undefined), scope: 'demo' };
  const preferred = req.get('x-preceptor-provider');
  return isModelProvider(preferred) ? { provider: deps.router.prefer(preferred), scope: preferred } : { provider: deps.router, scope: 'auto' };
}

function caseCodeOf(body: unknown): string | undefined {
  const b = body as { caseCode?: unknown; context?: { caseCode?: unknown } };
  const code = typeof b?.caseCode === 'string' ? b.caseCode : typeof b?.context?.caseCode === 'string' ? b.context.caseCode : undefined;
  return code?.slice(0, 40);
}

export function aiRouter(deps: AiRouterDeps): Router {
  const router = Router();

  function handle<S extends z.ZodTypeAny>(
    action: string,
    requestSchema: S,
    responseSchema: (body: z.infer<S>) => z.ZodTypeAny,
    exec: Exec<z.infer<S>>,
  ) {
    return async (req: Request, res: Response) => {
      const started = Date.now();
      const parsed = requestSchema.safeParse(req.body);
      if (!parsed.success) {
        const details = parsed.error.issues.slice(0, 6).map((i) => `${i.path.join('.') || 'body'}: ${i.message}`);
        return sendError(res, 400, 'REQUEST_INVALID', details);
      }
      const body = parsed.data as z.infer<S>;
      const { provider, scope } = pickProvider(req, deps);
      const imageCount = Array.isArray((body as { images?: unknown[] }).images) ? (body as { images: unknown[] }).images.length : undefined;
      const cacheKey = scope !== 'demo' ? ResponseCache.key([action, scope, PROMPT_VERSION, body]) : undefined;

      try {
        let cached = false;
        let result = cacheKey ? deps.cache.get(cacheKey) : undefined;
        if (result) cached = true;
        else {
          result = await exec(provider, body);
          // Final gate: nothing reaches the client unless it matches the contract.
          const check = responseSchema(body).safeParse(result.data);
          if (!check.success) throw new AIError('AI_RESPONSE_INVALID', { internal: 'post-guard validation failed', provider: isModelProvider(result.provider) ? result.provider : undefined });
          result = { ...result, data: check.data };
          if (cacheKey) deps.cache.set(cacheKey, result);
        }
        const latencyMs = Date.now() - started;
        const answeredBy = result.provider ?? provider.name;
        const model = result.model ?? provider.model;
        deps.audit.record({ ts: new Date().toISOString(), action, provider: answeredBy, model, caseCode: caseCodeOf(body), status: 'ok', latencyMs, cached, imageCount, warnings: result.warnings.length });
        res.json({
          ok: true,
          data: result.data,
          meta: {
            provider: answeredBy,
            model,
            cached,
            latencyMs,
            warnings: result.warnings,
            ...(result.fallbackFrom?.length ? { fallbackFrom: result.fallbackFrom } : {}),
            generatedAt: new Date().toISOString(),
          },
        });
      } catch (err) {
        const error = toAIError(err);
        deps.log(`[ai] ${action} failed: ${error.code}${error.provider ? ` (${error.provider})` : ''} — ${redact(error.message)}`);
        deps.audit.record({ ts: new Date().toISOString(), action, provider: error.provider ?? provider.name, model: provider.model, caseCode: caseCodeOf(body), status: 'error', errorCode: error.code, latencyMs: Date.now() - started, cached: false, imageCount });
        if (error.retryAfterMs) res.setHeader('retry-after', String(Math.ceil(error.retryAfterMs / 1000)));
        sendError(res, error.status, error.code, error.details, error.provider);
      }
    };
  }

  router.get('/status', async (req, res) => {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const usage = deps.audit.summarySince(since);
    const status: AIStatus = {
      configured: deps.router.configured,
      order: deps.router.order,
      providers: await deps.router.statuses(req.query.probe === '1'),
      demoAvailable: true,
      accessCodeRequired: deps.accessCodeRequired,
      limits: { maxImages: LIMITS.maxImages, rateLimitPerMinute: deps.rateLimitPerMinute },
      usage: { requests24h: usage.requests, errors24h: usage.errors, cacheHits24h: usage.cacheHits },
    };
    res.json(status);
  });

  router.post('/analyze-images', handle('analyze-images', analyzeImagesRequestSchema, () => imageAnalysisSchema, (p, b) => p.analyzeImages(b)));
  router.post('/extract-patient', handle('extract-patient', extractRequestSchema, () => patientExtractionSchema, (p, b) => p.extractPatientData(b)));
  router.post('/extract-medications', handle('extract-medications', extractRequestSchema, () => medicationExtractionSchema, (p, b) => p.extractMedications(b)));
  router.post('/extract-labs', handle('extract-labs', extractRequestSchema, () => labExtractionSchema, (p, b) => p.extractLabs(b)));
  router.post('/transcribe', handle('transcribe', transcribeRequestSchema, () => transcriptionSchema, (p, b) => p.transcribeAudio(b)));
  router.post('/timeline', handle('timeline', timelineRequestSchema, () => timelineSchema, (p, b) => p.buildTimeline(b)));
  router.post('/analyze-case', handle('analyze-case', caseRequestSchema, () => caseAnalysisSchema, (p, b) => p.analyzeCase(b)));
  router.post('/drp-analysis', handle('drp-analysis', caseRequestSchema, () => drpAnalysisSchema, (p, b) => p.identifyPotentialDRPs(b)));
  router.post('/clinical-discussion', handle('clinical-discussion', discussionRequestSchema, () => discussionSchema, (p, b) => p.generateClinicalDiscussion(b)));
  router.post('/monitoring-plan', handle('monitoring-plan', caseRequestSchema, () => monitoringPlanSchema, (p, b) => p.generateMonitoringPlan(b)));
  router.post('/follow-up', handle('follow-up', caseRequestSchema, () => followUpPlanSchema, (p, b) => p.generateFollowUp(b)));
  router.post('/round-note', handle('round-note', roundNoteRequestSchema, () => roundNoteSchema, (p, b) => p.structureRoundNote(b)));
  router.post('/presentation', handle('presentation', presentationRequestSchema, () => presentationSchema, (p, b) => p.generatePresentation(b)));

  const teachingSchemas: Record<TeachingRequest['mode'], z.ZodTypeAny> = {
    questions: teachingQuestionsSchema,
    evaluate: reasoningEvaluationSchema,
    argue: argueTurnSchema,
    defense: argueTurnSchema,
    generate_case: generatedCaseSchema,
    lesson: lessonSchema,
  };
  router.post(
    '/teaching',
    handle('teaching', teachingRequestSchema, (b) => teachingSchemas[b.mode], (p, b) => {
      switch (b.mode) {
        case 'questions':
          return p.generateTeachingQuestions(b);
        case 'evaluate':
          return p.evaluateStudentReasoning(b);
        case 'argue':
        case 'defense':
          return p.continueDialogue(b);
        case 'generate_case':
          return p.generateTrainingCase(b);
        case 'lesson':
          return p.generateLesson(b);
      }
    }),
  );

  router.use((_req, res) => sendError(res, 404, 'REQUEST_INVALID', ['Unknown AI endpoint.']));
  return router;
}
