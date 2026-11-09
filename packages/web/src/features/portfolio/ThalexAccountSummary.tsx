import type { ReactNode } from 'react';
import { useThalexAccount } from './hooks/queries';
import VenueAccountSummary from './VenueAccountSummary';

export default function ThalexAccountSummary({
  onUseEquity,
  accountSelector,
}: {
  onUseEquity?: (equity: number) => void;
  accountSelector?: ReactNode;
}) {
  const query = useThalexAccount();
  return (
    <VenueAccountSummary
      venue="Thalex"
      data={
        query.data && {
          ...query.data,
          freeCollateralUsd: query.data.freeMarginUsd,
          maintenanceMarginUsd: null,
          fetchedAt: query.data.updatedAt,
        }
      }
      isError={query.isError}
      isPending={query.isPending}
      onUseEquity={onUseEquity}
      accountSelector={accountSelector}
    />
  );
}
