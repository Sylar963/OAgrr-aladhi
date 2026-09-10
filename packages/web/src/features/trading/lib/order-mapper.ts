import { type PlaceOrderRequest, VenueIdSchema } from '@oggregator/protocol';
import type { Leg } from '@features/architect/payoff';
import type { StrategyRouting } from '@features/builder/round-trip';

type PreferredVenuesEntry = NonNullable<PlaceOrderRequest['legs'][number]['preferredVenues']>;

export function legsToOrderRequest(
  legs: Leg[],
  underlying: string,
  venueFilter: string[],
  routing?: StrategyRouting,
): PlaceOrderRequest {
  return {
    legs: legs.map((leg) => {
      const pinned = VenueIdSchema.safeParse(routing?.legs[leg.id]?.venue);
      return {
        side: leg.direction,
        optionRight: leg.type,
        underlying,
        expiry: leg.expiry,
        strike: leg.strike,
        quantity: leg.quantity,
        quantityUnit: 'base',
        preferredVenues: pinned.success ? ([pinned.data] satisfies PreferredVenuesEntry) : null,
      };
    }),
    venueFilter: venueFilter as PlaceOrderRequest['venueFilter'],
  };
}
