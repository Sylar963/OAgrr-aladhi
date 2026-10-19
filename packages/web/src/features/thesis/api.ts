import { getClerkToken } from '@lib/clerk-token';
import {
  type ThesisCreateRequest,
  type ThesisFlipRequest,
  type ThesisGateCheckRequest,
  type ThesisGateCheckResponse,
  ThesisGateCheckResponseSchema,
  type ThesisListResponse,
  ThesisListResponseSchema,
  type ThesisView,
  ThesisViewSchema,
} from '@oggregator/protocol';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

export class ThesisApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ThesisApiError';
  }
}

interface ResponseSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { message: string } };
}

async function request<T>(path: string, schema: ResponseSchema<T>, body?: unknown): Promise<T> {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  const token = await getClerkToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (payload ?? {}) as { error?: string; message?: string };
    throw new ThesisApiError(res.status, error.error ?? 'http_error', error.message ?? `HTTP ${res.status}`);
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new Error(`invalid response from ${path}: ${parsed.error.message}`);
  return parsed.data;
}

export const fetchTheses = (): Promise<ThesisListResponse> => request('/thesis', ThesisListResponseSchema);

export const createThesis = (body: ThesisCreateRequest): Promise<ThesisView> =>
  request('/thesis', ThesisViewSchema, body);

export const checkThesisGate = (body: ThesisGateCheckRequest): Promise<ThesisGateCheckResponse> =>
  request('/thesis/gate/check', ThesisGateCheckResponseSchema, body);

const action =
  (name: string) =>
  (id: string, body: unknown = {}): Promise<ThesisView> =>
    request(`/thesis/${encodeURIComponent(id)}/${name}`, ThesisViewSchema, body);

export const keepThesis = action('keep');
export const waitThesis = action('wait');
export const backToThesis = action('back-to-thesis');
export const endThesis = (id: string, note?: string) => action('end')(id, note ? { note } : {});
export const tightenThesis = (id: string, level: number) => action('tighten')(id, { level });
export const flipThesis = (id: string, body: ThesisFlipRequest) => action('flip')(id, body);
