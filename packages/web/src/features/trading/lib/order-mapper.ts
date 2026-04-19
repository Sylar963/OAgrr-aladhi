import type { PlaceOrderRequest } from '@oggregator/protocol';
import type { Leg } from '@features/architect/payoff';

export function legsToOrderRequest(
  legs: Leg[],
  underlying: string,
  venueFilter: string[],
): PlaceOrderRequest {
  return {
    legs: legs.map((leg) => ({
      side: leg.direction,
      optionRight: leg.type,
      underlying,
      expiry: leg.expiry,
      strike: leg.strike,
      quantity: leg.quantity,
      preferredVenues: null,
    })),
    venueFilter: venueFilter as PlaceOrderRequest['venueFilter'],
  };
}
