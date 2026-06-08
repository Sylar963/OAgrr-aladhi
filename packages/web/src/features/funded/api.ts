import { getClerkToken } from '@lib/clerk-token';
import { fetchJson } from '@lib/http';
import type {
  FundedRunDetailDto,
  FundedRunSummaryDto,
  FundedTemplateDto,
  StartFundedRunRequest,
} from '@oggregator/protocol';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

async function getHeaders(): Promise<HeadersInit> {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  const token = await getClerkToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: await getHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(payload.message ?? payload.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function getFundedTemplates(): Promise<{ templates: FundedTemplateDto[] }> {
  return fetchJson<{ templates: FundedTemplateDto[] }>('/funded/templates');
}

export async function getFundedRuns(): Promise<{ runs: FundedRunSummaryDto[] }> {
  return fetchJson<{ runs: FundedRunSummaryDto[] }>('/funded/runs');
}

export async function getFundedRun(id: string): Promise<FundedRunDetailDto> {
  return fetchJson<FundedRunDetailDto>(`/funded/runs/${id}`);
}

export async function startFundedRun(
  req: StartFundedRunRequest,
): Promise<{ run: FundedRunSummaryDto }> {
  return postJson<{ run: FundedRunSummaryDto }>('/funded/runs', req);
}

export async function withdrawFundedRun(id: string): Promise<{ run: FundedRunSummaryDto }> {
  return postJson<{ run: FundedRunSummaryDto }>(`/funded/runs/${id}/withdraw`, {});
}
