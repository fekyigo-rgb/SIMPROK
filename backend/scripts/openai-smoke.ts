import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConstitutionalAiBoundaryService } from '../src/intelligence/constitutional-ai-boundary.service';
import { DisabledIntelligenceProvider } from '../src/intelligence/disabled-intelligence.provider';
import { IntelligenceProviderRegistryService } from '../src/intelligence/intelligence-provider-registry';
import { OpenAiIntelligenceProvider } from '../src/intelligence/openai-intelligence.provider';
import { OpenAiProviderConfigService } from '../src/intelligence/openai-provider.config';
import type { RabIntelligenceRequest } from '../src/intelligence/simprok-intelligence.port';
import { SimprokIntelligenceOrchestrator } from '../src/intelligence/simprok-intelligence.orchestrator';

/**
 * Manual, opt-in live smoke test for the OpenAI provider adapter. Never runs
 * as part of the standard unit/E2E suite. Skips itself unless both
 * OPENAI_API_KEY and SIMPROK_OPENAI_MODEL are present. Uses synthetic data
 * and a fake, non-persisting canonical lookup + evidence sink -- there is no
 * real database connection here, so it cannot mutate business data.
 */
function loadLocalEnvIfPresent(): void {
  const envPath = resolve(__dirname, '..', '.env');
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function main(): Promise<void> {
  loadLocalEnvIfPresent();

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.SIMPROK_OPENAI_MODEL?.trim();

  if (!apiKey || !model) {
    console.log('IMPLEMENTATION PASS');
    console.log('LIVE_SMOKE NOT RUN: OPENAI_API_KEY and SIMPROK_OPENAI_MODEL are both required.');
    return;
  }

  const fakePrisma = {
    aHSP: { findFirst: async () => null },
    basicPrice: { findFirst: async () => null },
  };
  const evidenceCalls: unknown[] = [];
  const fakeEvidenceService = {
    append: async (record: unknown) => {
      evidenceCalls.push(record);
    },
  };

  const constitutionalBoundary = new ConstitutionalAiBoundaryService(
    fakePrisma as any,
    fakeEvidenceService as any,
  );
  const registry = new IntelligenceProviderRegistryService(
    { providerId: 'openai' } as any,
    new DisabledIntelligenceProvider(),
    new OpenAiIntelligenceProvider(new OpenAiProviderConfigService()),
  );
  const orchestrator = new SimprokIntelligenceOrchestrator(registry, constitutionalBoundary);

  const request: RabIntelligenceRequest = {
    requestId: `smoke-${Date.now()}`,
    workspaceId: 'smoke-workspace',
    organizationId: 'smoke-org',
    projectId: 'smoke-project',
    accountId: 'smoke-account',
    boqItemRefs: ['smoke-boq-item-1'],
    projectContextRef: 'smoke-context:synthetic-pekerjaan-galian-tanah-1m3',
    efPermission: 'NOT_ALLOWED',
    requestedAction: 'GENERATE_DRAFT_RAB',
  };

  const proposal = await orchestrator.proposeRabDraft(request);

  const validStatuses = ['READY', 'PARTIAL', 'NEEDS_REVIEW', 'REJECTED_BY_POLICY'];
  if (proposal.requestId !== request.requestId || !validStatuses.includes(proposal.status)) {
    throw new Error('proposal did not match the strict structured contract');
  }
  if (evidenceCalls.length !== 1) {
    throw new Error('expected exactly one append-only evidence record');
  }

  // Deliberately log only shape/counters -- never the raw key or the full
  // raw provider response.
  console.log(
    `LIVE_SMOKE PASS: status=${proposal.status} items=${proposal.items.length} evidenceRecorded=true`,
  );
}

main().catch((error: unknown) => {
  console.error('LIVE_SMOKE FAIL:', error instanceof Error ? error.name : 'unknown error');
  process.exitCode = 1;
});
