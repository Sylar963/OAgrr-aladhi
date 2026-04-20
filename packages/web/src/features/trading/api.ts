import type {
  CreatePaperTradeNoteRequest,
  CreatePaperTradeRequest,
  PaperFillDto,
  PaperOverviewDto,
  PaperOrderDto,
  PaperPnlDto,
  PaperPositionDto,
  PaperTradeDetailDto,
  PaperTradeSummaryDto,
  PlaceOrderRequest,
} from '@oggregator/protocol';
import { fetchJson } from '@lib/http';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

export interface PlaceOrderResponse {
  order: PaperOrderDto;
  fills: PaperFillDto[];
}

export interface CreateTradeResponse extends PlaceOrderResponse {
  trade: PaperTradeDetailDto;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(payload.message ?? payload.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResponse> {
  return postJson<PlaceOrderResponse>('/paper/orders', req);
}

export function createTrade(req: CreatePaperTradeRequest): Promise<CreateTradeResponse> {
  return postJson<CreateTradeResponse>('/paper/trades', req);
}

export function addTradeNote(
  tradeId: string,
  req: CreatePaperTradeNoteRequest,
): Promise<PaperTradeDetailDto> {
  return postJson<PaperTradeDetailDto>(`/paper/trades/${tradeId}/notes`, req);
}

export function closeTrade(tradeId: string): Promise<PaperTradeDetailDto> {
  return postJson<PaperTradeDetailDto>(`/paper/trades/${tradeId}/actions/close`, {});
}

export function reduceTrade(tradeId: string, fraction: number): Promise<PaperTradeDetailDto> {
  return postJson<PaperTradeDetailDto>(`/paper/trades/${tradeId}/actions/reduce`, { fraction });
}

export function getPositions(): Promise<{ positions: PaperPositionDto[] }> {
  return fetchJson('/paper/positions');
}

export function getPnl(): Promise<PaperPnlDto> {
  return fetchJson('/paper/pnl');
}

export function getOrders(limit = 50): Promise<{ orders: PaperOrderDto[] }> {
  return fetchJson(`/paper/orders?limit=${limit}`);
}

export function getOverview(): Promise<PaperOverviewDto> {
  return fetchJson('/paper/overview');
}

export function getTrades(
  status: 'open' | 'closed' | 'all' = 'all',
  limit = 100,
): Promise<{ trades: PaperTradeSummaryDto[] }> {
  return fetchJson(`/paper/trades?status=${status}&limit=${limit}`);
}

export function getTrade(tradeId: string): Promise<PaperTradeDetailDto> {
  return fetchJson(`/paper/trades/${tradeId}`);
}

export function getActivity(limit = 100, tradeId?: string): Promise<{ activity: PaperTradeDetailDto['activity'] }> {
  const suffix = tradeId ? `&tradeId=${encodeURIComponent(tradeId)}` : '';
  return fetchJson(`/paper/activity?limit=${limit}${suffix}`);
}

export function getFills(limit = 100, tradeId?: string): Promise<{ fills: PaperFillDto[] }> {
  const suffix = tradeId ? `&tradeId=${encodeURIComponent(tradeId)}` : '';
  return fetchJson(`/paper/fills?limit=${limit}${suffix}`);
}
