import { defineMessages } from '@lib/i18n';

export const legMessages = defineMessages(
  {
    belowIntrinsic: '< intrinsic',
    aboveUpper: '> upper',
    cappedTitle: 'position needs unrealistic vol to recover entry — time decay dominated',
    belowIntrinsicTitle:
      'entry below current no-arb floor (intrinsic); recovery requires spot move, not vol',
    aboveUpperTitle: 'entry above option upper bound; cannot be priced at any positive vol',
    remove: 'remove {id}',
    fairValue: 'fair value from smile fit',
    debit: 'Dr',
    credit: 'Cr',
  },
  {
    belowIntrinsic: '< intrínseco',
    aboveUpper: '> superior',
    cappedTitle:
      'la posición necesita una vol irreal para recuperar la entrada — domina el decaimiento temporal',
    belowIntrinsicTitle:
      'entrada por debajo del piso no-arb actual (intrínseco); recuperar requiere movimiento del spot, no de vol',
    aboveUpperTitle:
      'entrada por encima de la cota superior de la opción; no se puede valorar con ninguna vol positiva',
    remove: 'eliminar {id}',
    fairValue: 'valor justo del ajuste del smile',
    debit: 'Db',
    credit: 'Cr',
  },
);
