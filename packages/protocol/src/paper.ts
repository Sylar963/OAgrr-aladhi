import { z } from 'zod';

export const PaperOrderLegSchema = z.object({
  index: z.number().int().nonnegative(),
  side: z.enum(['buy', 'sell']),
  optionRight: z.enum(['call', 'put']),
  underlying: z.string().min(1),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  strike: z.number().positive(),
  quantity: z.number().positive(),
  preferredVenues: z
    .array(z.enum(['deribit', 'okx', 'bybit', 'binance', 'derive']))
    .nullable(),
});

export type PaperOrderLeg = z.infer<typeof PaperOrderLegSchema>;

export const PlaceOrderRequestSchema = z.object({
  clientOrderId: z.string().optional(),
  legs: z.array(
    PaperOrderLegSchema.omit({ index: true }).extend({
      preferredVenues: PaperOrderLegSchema.shape.preferredVenues.optional(),
    }),
  ).min(1),
  venueFilter: z
    .array(z.enum(['deribit', 'okx', 'bybit', 'binance', 'derive']))
    .default([]),
});

export type PlaceOrderRequest = z.infer<typeof PlaceOrderRequestSchema>;

export interface PaperOrderDto {
  id: string;
  clientOrderId: string;
  accountId: string;
  status: 'accepted' | 'filled' | 'rejected' | 'cancelled';
  legs: PaperOrderLeg[];
  submittedAt: string;
  filledAt: string | null;
  rejectionReason: string | null;
  totalDebitUsd: number | null;
}

export interface PaperFillDto {
  id: string;
  orderId: string;
  legIndex: number;
  venue: string;
  side: 'buy' | 'sell';
  optionRight: 'call' | 'put';
  underlying: string;
  expiry: string;
  strike: number;
  quantity: number;
  priceUsd: number;
  feesUsd: number;
  filledAt: string;
}

export interface PaperPositionDto {
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: 'call' | 'put';
  netQuantity: number;
  avgEntryPriceUsd: number;
  realizedPnlUsd: number;
  markPriceUsd: number | null;
  unrealizedPnlUsd: number | null;
  openedAt: string;
  lastFillAt: string;
}

export interface PaperPnlDto {
  cashUsd: number;
  realizedUsd: number;
  unrealizedUsd: number;
  equityUsd: number;
  generatedAt: string;
}

export type PaperWsServerMessage =
  | { type: 'hello'; accountId: string; serverTime: number }
  | { type: 'positions'; positions: PaperPositionDto[] }
  | { type: 'pnl'; pnl: PaperPnlDto }
  | { type: 'order'; order: PaperOrderDto; fills: PaperFillDto[] }
  | { type: 'error'; code: string; message: string };
