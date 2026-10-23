import type { StrategyGroup } from '@oggregator/protocol';

import { defineMessages, type Translate } from '@lib/i18n';

export const strategyLabelMessages = defineMessages(
  {
    bullCallSpread: 'Bull call spread',
    bearCallSpread: 'Bear call spread',
    bearPutSpread: 'Bear put spread',
    bullPutSpread: 'Bull put spread',
    longStraddle: 'Long straddle',
    shortStraddle: 'Short straddle',
    longStrangle: 'Long strangle',
    shortStrangle: 'Short strangle',
    shortIronCondor: 'Short iron condor',
    longIronCondor: 'Long iron condor',
    shortIronButterfly: 'Short iron butterfly',
    longIronButterfly: 'Long iron butterfly',
    longNaked: 'Long {right}',
    shortNaked: 'Short {right}',
    option: 'option',
  },
  {
    bullCallSpread: 'Call spread alcista',
    bearCallSpread: 'Call spread bajista',
    bearPutSpread: 'Put spread bajista',
    bullPutSpread: 'Put spread alcista',
    longStraddle: 'Long straddle',
    shortStraddle: 'Short straddle',
    longStrangle: 'Long strangle',
    shortStrangle: 'Short strangle',
    shortIronCondor: 'Short iron condor',
    longIronCondor: 'Long iron condor',
    shortIronButterfly: 'Short iron butterfly',
    longIronButterfly: 'Long iron butterfly',
    longNaked: 'Long {right}',
    shortNaked: 'Short {right}',
    option: 'opción',
  },
);

type LabelT = Translate<typeof strategyLabelMessages.en>;

export type StrategyBias = 'bull' | 'bear' | 'long_vol' | 'short_vol';

export function strategyBias(group: StrategyGroup): StrategyBias {
  const long = group.legs.find((l) => l.size > 0);
  const short = group.legs.find((l) => l.size < 0);
  const first = group.legs[0];
  switch (group.kind) {
    case 'call_spread':
      return long != null && short != null && long.strike < short.strike ? 'bull' : 'bear';
    case 'put_spread':
      return long != null && short != null && long.strike > short.strike ? 'bear' : 'bull';
    case 'straddle':
    case 'strangle':
      return (first?.size ?? 0) > 0 ? 'long_vol' : 'short_vol';
    case 'iron_condor':
    case 'iron_butterfly': {
      // Long wings make it the short (credit) structure.
      const outer = [...group.legs].sort((a, b) => a.strike - b.strike)[0];
      return (outer?.size ?? 0) > 0 ? 'short_vol' : 'long_vol';
    }
    case 'naked': {
      const isLong = (first?.size ?? 0) > 0;
      const isCall = first?.optionRight === 'call';
      return isLong === isCall ? 'bull' : 'bear';
    }
  }
}

export function strategyLabel(group: StrategyGroup, t: LabelT): string {
  const bias = strategyBias(group);
  const first = group.legs[0];
  switch (group.kind) {
    case 'call_spread':
      return bias === 'bull' ? t('bullCallSpread') : t('bearCallSpread');
    case 'put_spread':
      return bias === 'bear' ? t('bearPutSpread') : t('bullPutSpread');
    case 'straddle':
      return bias === 'long_vol' ? t('longStraddle') : t('shortStraddle');
    case 'strangle':
      return bias === 'long_vol' ? t('longStrangle') : t('shortStrangle');
    case 'iron_condor':
      return bias === 'short_vol' ? t('shortIronCondor') : t('longIronCondor');
    case 'iron_butterfly':
      return bias === 'short_vol' ? t('shortIronButterfly') : t('longIronButterfly');
    case 'naked':
      return t((first?.size ?? 0) > 0 ? 'longNaked' : 'shortNaked', {
        right: first?.optionRight ?? t('option'),
      });
  }
}

function fmtQty(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function legSummary(group: StrategyGroup): string {
  const strikes = [...group.legs]
    .sort((a, b) => a.strike - b.strike)
    .map((l) => `${l.strike.toLocaleString(undefined, { maximumFractionDigits: 2 })}${l.optionRight === 'call' ? 'C' : 'P'}`)
    .join(' / ');
  const qty = Math.abs(group.legs[0]?.size ?? 0);
  return `${strikes} × ${fmtQty(qty)}`;
}
