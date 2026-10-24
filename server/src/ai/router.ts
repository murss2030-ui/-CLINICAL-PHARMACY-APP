// Routes every AI task to the first configured provider that can handle its
// input (text, page images or a voice note), in the configured failover
// order, optionally starting with the provider the user prefers. A provider
// failure (bad key, quota, outage, unreachable host, output that fails
// validation) falls through to the next provider. Every answer reports which
// provider and model produced it.
import {
  CAPABILITY_LABELS,
  describeAIError,
  isModelProvider,
  providerLabel,
  type AICapability,
  type AIProviderName,
  type AIProviderStatus,
  type AnalyzeImagesRequest,
  type CaseRequest,
  type DiscussionRequest,
  type ExtractRequest,
  type ModelProviderName,
  type PresentationRequest,
  type RoundNoteRequest,
  type TeachingRequest,
  type TimelineRequest,
  type TranscribeRequest,
} from '../../../shared/ai';
import type { AIProvider, AIResult } from './AIProvider';
import { AIError, redact, toAIError } from './errors';

export interface RouterOptions {
  /** Failover order; providers not listed come last. */
  order?: ModelProviderName[];
  /** Tried first for this request (from the client's settings). */
  preferred?: ModelProviderName;
  /**
   * No further provider is tried once this much time has passed, so a chain of
   * slow failures cannot outlast the browser's own request timeout.
   */
  failoverBudgetMs?: number;
  log?: (msg: string) => void;
  now?: () => number;
}

const DEFAULT_FAILOVER_BUDGET_MS = 75_000;

export class AIRouter implements AIProvider {
  readonly capabilities: readonly AICapability[] = ['text', 'vision', 'audio'];
  private readonly providers: AIProvider[];

  constructor(
    providers: AIProvider[],
    private readonly opts: RouterOptions = {},
  ) {
    const order = opts.order ?? [];
    const rank = (p: AIProvider) => {
      const i = order.indexOf(p.name as ModelProviderName);
      return i === -1 ? order.length : i;
    };
    const sorted = [...providers].sort((a, b) => rank(a) - rank(b));
    this.providers = opts.preferred ? [...sorted.filter((p) => p.name === opts.preferred), ...sorted.filter((p) => p.name !== opts.preferred)] : sorted;
  }

  /** Effective order for this router (preferred provider first). */
  get order(): ModelProviderName[] {
    return this.providers.map((p) => p.name).filter(isModelProvider);
  }

  private get primary(): AIProvider | undefined {
    return this.providers.find((p) => p.configured) ?? this.providers[0];
  }

  get name(): AIProviderName {
    return this.primary?.name ?? 'gemini';
  }

  get model(): string {
    return this.primary?.model ?? '';
  }

  get configured(): boolean {
    return this.providers.some((p) => p.configured);
  }

  probe(): Promise<void> {
    return this.primary ? this.primary.probe() : Promise.reject(new AIError('AI_KEY_NOT_CONFIGURED'));
  }

  /** Same providers, with `name` tried first. */
  prefer(name: ModelProviderName | undefined): AIRouter {
    if (!name || !this.providers.some((p) => p.name === name)) return this;
    return new AIRouter(this.providers, { ...this.opts, order: this.order, preferred: name });
  }

  async statuses(probe: boolean): Promise<AIProviderStatus[]> {
    return Promise.all(
      this.providers.filter((p) => isModelProvider(p.name)).map(async (p) => {
        const status: AIProviderStatus = {
          name: p.name as ModelProviderName,
          label: providerLabel(p.name),
          configured: p.configured,
          model: p.model,
          capabilities: [...p.capabilities],
          ...(p.note ? { note: p.note } : {}),
        };
        if (probe && p.configured) {
          try {
            await p.probe();
            status.reachable = true;
          } catch (err) {
            const error = toAIError(err);
            status.reachable = false;
            status.probeError = error.code;
            if (error.details?.length) status.probeDetails = error.details;
          }
        }
        return status;
      }),
    );
  }

  private async route<T>(capability: AICapability, task: string, call: (p: AIProvider) => Promise<AIResult<T>>): Promise<AIResult<T>> {
    const configured = this.providers.filter((p) => p.configured);
    if (!configured.length) {
      // Named after the first provider in the order (Gemini by default): "GEMINI API KEY NOT CONFIGURED".
      const first = this.order[0];
      throw new AIError('AI_KEY_NOT_CONFIGURED', {
        provider: first,
        internal: 'no AI provider key is configured',
        details: ['No AI provider key is set on the server. Set GEMINI_API_KEY, DEEPSEEK_API_KEY and/or KIMI_API_KEY in the server environment.'],
      });
    }
    const capable = configured.filter((p) => p.capabilities.includes(capability));
    if (!capable.length) {
      const able = this.providers.filter((p) => p.capabilities.includes(capability)).map((p) => providerLabel(p.name));
      throw new AIError('AI_CAPABILITY_UNAVAILABLE', {
        internal: `no configured provider accepts ${capability} input`,
        details: [`${CAPABILITY_LABELS[capability]} input needs a server key for ${able.join(' or ') || 'a provider that supports it'}.`],
      });
    }

    const now = this.opts.now ?? Date.now;
    const started = now();
    const failures: AIError[] = [];
    for (const [i, p] of capable.entries()) {
      if (i > 0 && now() - started > (this.opts.failoverBudgetMs ?? DEFAULT_FAILOVER_BUDGET_MS)) break;
      try {
        const result = await call(p);
        if (!failures.length) return { ...result, provider: p.name, model: p.modelFor?.(capability) ?? p.model };
        return {
          ...result,
          warnings: [fallbackNote(failures, p), ...result.warnings],
          provider: p.name,
          model: p.modelFor?.(capability) ?? p.model,
          fallbackFrom: failures.map((f) => f.provider).filter(isModelProvider),
        };
      } catch (err) {
        const error = toAIError(err);
        if (!error.provider && isModelProvider(p.name)) error.provider = p.name;
        failures.push(error);
        this.opts.log?.(`[ai] ${task}: ${providerLabel(p.name)} failed with ${error.code} — ${redact(error.message)}`);
      }
    }
    throw combine(failures);
  }

  // ───────── document intake ─────────

  analyzeImages(req: AnalyzeImagesRequest) {
    return this.route('vision', 'analyze-images', (p) => p.analyzeImages(req));
  }

  extractPatientData(req: ExtractRequest) {
    return this.route(req.images?.length ? 'vision' : 'text', 'extract-patient', (p) => p.extractPatientData(req));
  }

  extractMedications(req: ExtractRequest) {
    return this.route(req.images?.length ? 'vision' : 'text', 'extract-medications', (p) => p.extractMedications(req));
  }

  extractLabs(req: ExtractRequest) {
    return this.route(req.images?.length ? 'vision' : 'text', 'extract-labs', (p) => p.extractLabs(req));
  }

  transcribeAudio(req: TranscribeRequest) {
    return this.route('audio', 'transcribe', (p) => p.transcribeAudio(req));
  }

  // ───────── clinical reasoning ─────────

  buildTimeline(req: TimelineRequest) {
    return this.route('text', 'timeline', (p) => p.buildTimeline(req));
  }

  analyzeCase(req: CaseRequest) {
    return this.route('text', 'analyze-case', (p) => p.analyzeCase(req));
  }

  identifyPotentialDRPs(req: CaseRequest) {
    return this.route('text', 'drp-analysis', (p) => p.identifyPotentialDRPs(req));
  }

  generateClinicalDiscussion(req: DiscussionRequest) {
    return this.route('text', 'clinical-discussion', (p) => p.generateClinicalDiscussion(req));
  }

  generateMonitoringPlan(req: CaseRequest) {
    return this.route('text', 'monitoring-plan', (p) => p.generateMonitoringPlan(req));
  }

  generateFollowUp(req: CaseRequest) {
    return this.route('text', 'follow-up', (p) => p.generateFollowUp(req));
  }

  structureRoundNote(req: RoundNoteRequest) {
    return this.route('text', 'round-note', (p) => p.structureRoundNote(req));
  }

  generatePresentation(req: PresentationRequest) {
    return this.route('text', 'presentation', (p) => p.generatePresentation(req));
  }

  // ───────── teaching ─────────

  generateTeachingQuestions(req: TeachingRequest) {
    return this.route('text', 'teaching', (p) => p.generateTeachingQuestions(req));
  }

  evaluateStudentReasoning(req: TeachingRequest) {
    return this.route('text', 'teaching', (p) => p.evaluateStudentReasoning(req));
  }

  continueDialogue(req: TeachingRequest) {
    return this.route('text', 'teaching', (p) => p.continueDialogue(req));
  }

  generateTrainingCase(req: TeachingRequest) {
    return this.route('text', 'teaching', (p) => p.generateTrainingCase(req));
  }

  generateLesson(req: TeachingRequest) {
    return this.route('text', 'teaching', (p) => p.generateLesson(req));
  }
}

function fallbackNote(failures: AIError[], answeredBy: AIProvider): string {
  const why = failures.map((f) => `${providerLabel(f.provider)} failed (${describeAIError(f.code, f.provider).title})`).join('; ');
  return `Answered by ${providerLabel(answeredBy.name)} because ${why}.`;
}

/** One failure is returned as is; several become the first one plus a line per provider. */
function combine(failures: AIError[]): AIError {
  const first = failures[0]!;
  if (failures.length === 1) return first;
  return new AIError(first.code, {
    provider: first.provider,
    status: first.status,
    retryAfterMs: first.retryAfterMs,
    internal: failures.map((f) => `${f.provider ?? '?'}:${f.code}`).join(', '),
    details: failures.map((f) => `${providerLabel(f.provider)}: ${describeAIError(f.code, f.provider).title}${f.details?.length ? ` — ${f.details[0]}` : ''}`),
  });
}
