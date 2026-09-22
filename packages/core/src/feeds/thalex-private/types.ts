import { z } from 'zod';

export const ThalexPortfolioEntrySchema = z
  .object({
    instrument_name: z.string(),
    position: z.number(),
    average_price: z.number().nullable().optional(),
    mark_price: z.number().nullable().optional(),
    delta: z.number().nullable().optional(),
    gamma: z.number().nullable().optional(),
    vega: z.number().nullable().optional(),
    theta: z.number().nullable().optional(),
    unrealized_pnl: z.number().nullable().optional(),
  })
  .passthrough();
export type ThalexPortfolioEntry = z.infer<typeof ThalexPortfolioEntrySchema>;

export const ThalexPortfolioNotificationSchema = z.object({
  channel_name: z.string(),
  notification: z.array(ThalexPortfolioEntrySchema),
  snapshot: z.boolean().optional(),
});
export type ThalexPortfolioNotification = z.infer<typeof ThalexPortfolioNotificationSchema>;

export const ThalexTradeSchema = z
  .object({
    trade_id: z.string(),
    order_id: z.string().nullable().optional(),
    instrument_name: z.string(),
    direction: z.enum(['buy', 'sell']),
    price: z.number(),
    amount: z.number(),
    time: z.number(),
    fee: z.number().nullable().optional(),
    position_pnl: z.number().nullable().optional(),
    maker_taker: z.enum(['maker', 'taker']).nullable().optional(),
    trade_type: z.string().optional(),
    leg_index: z.number().int().optional(),
  })
  .passthrough();
export type ThalexTrade = z.infer<typeof ThalexTradeSchema>;

export const ThalexTradeHistoryResultSchema = z.object({
  trades: z.array(ThalexTradeSchema),
  bookmark: z.string().nullable().optional(),
});
export type ThalexTradeHistoryResult = z.infer<typeof ThalexTradeHistoryResultSchema>;

export const ThalexTradeHistoryNotificationSchema = z.object({
  channel_name: z.literal('account.trade_history'),
  notification: z.array(ThalexTradeSchema),
});
export type ThalexTradeHistoryNotification = z.infer<
  typeof ThalexTradeHistoryNotificationSchema
>;

export const ThalexJsonRpcResultSchema = z.object({
  id: z.union([z.number(), z.string(), z.null()]).optional(),
  result: z.unknown().optional(),
});
export const ThalexJsonRpcErrorSchema = z.object({
  id: z.union([z.number(), z.string(), z.null()]).optional(),
  error: z.object({ code: z.number(), message: z.string() }),
});

export const ThalexLoginResultSchema = z.object({
  account_number: z.string(),
});
export type ThalexLoginResult = z.infer<typeof ThalexLoginResultSchema>;

export const ThalexSubscribedChannelsSchema = z.array(z.string());
export type ThalexSubscribedChannels = z.infer<typeof ThalexSubscribedChannelsSchema>;
