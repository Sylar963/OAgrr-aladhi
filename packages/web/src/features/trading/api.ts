import type {
  PaperFillDto,
  PaperOrderDto,
  PaperPnlDto,
  PaperPositionDto,
  PlaceOrderRequest,
} from '@oggregator/protocol';
import { fetchJson } from '@lib/http';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

export interface PlaceOrderResponse {
  order: PaperOrderDto;
  fills: PaperFillDto[];
}

export async function placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResponse> {
  const res = await fetch(`${API_BASE}/paper/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<PlaceOrderResponse>;
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
