import type { ReactNode } from 'react';
import { useParadexAccount } from './hooks/queries';
import VenueAccountSummary from './VenueAccountSummary';

export default function ParadexAccountSummary({
  onUseEquity,
  accountSelector,
}: {
  onUseEquity?: (equity: number) => void;
  accountSelector?: ReactNode;
}) {
  const query = useParadexAccount();
  return (
    <VenueAccountSummary
      venue="Paradex"
      data={query.data}
      isError={query.isError}
      isPending={query.isPending}
      onUseEquity={onUseEquity}
      accountSelector={accountSelector}
    />
  );
}
