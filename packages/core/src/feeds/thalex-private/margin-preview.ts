import { z } from 'zod';

const instrument = z.string().min(1).max(100);
const combinationLeg = z.object({
  instrument_name: instrument,
  quantity: z.number().finite().refine((value) => value !== 0),
});
const order = {
  price: z.number().finite(),
  amount: z.number().finite().positive(),
};

export const ThalexMarginPreviewRequestSchema = z.union([
  z.object({ ...order, instrument_name: instrument }).strict(),
  z.object({ ...order, legs: z.array(combinationLeg).min(2).max(4) }).strict(),
]);

const breakdown = z.object({ required_margin: z.number().finite().nonnegative() });

export const ThalexMarginPreviewSchema = z.object({
  current: breakdown,
  with_buy: breakdown,
  with_sell: breakdown,
});

export type ThalexMarginPreviewRequest = z.infer<typeof ThalexMarginPreviewRequestSchema>;
export type ThalexMarginPreview = z.infer<typeof ThalexMarginPreviewSchema>;
