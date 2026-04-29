import type { PaperPaperVenueId } from '@oggregator/protocol';
import type { Fill } from '../book/fill.js';
import type { Order, OrderLeg } from '../book/order.js';

export interface LegFillPlan {
  leg: OrderLeg;
  venue: PaperVenueId;
  priceUsd: number;
  feesUsd: number;
}

export interface FillEngine {
  /**
   * Attempt to fill every leg of the order. All-or-nothing: if any leg cannot
   * be priced, this throws NoLiquidityError and no fills are produced.
   */
  executeOrder(order: Order, venueFilter: PaperVenueId[]): Promise<Fill[]>;
}
