import { defineMessages } from '@lib/i18n';

export const easyMessages = defineMessages(
  {
    noLiveQuoteAdd: 'No live {side} for that option right now.',
    noLiveQuoteFlip: 'No live {side} to {direction} that option.',
    switchToBuyVerb: 'buy',
    switchToSellVerb: 'sell',

    showSide: 'Show {side} options',
    upOptions: '▲ UP options',
    downOptions: '▼ DOWN options',
    up: 'UP',
    down: 'DOWN',
    betUp: '▲ Bet {underlying} goes UP',
    betDown: '▼ Bet {underlying} goes DOWN',
    callsSub: 'Calls: pays you if the price ends above the target',
    putsSub: 'Puts: pays you if the price ends below the target',
    collapseList: 'Collapse list',
    collapse: 'Collapse',
    target: 'Target',
    oddsTip: 'Market-implied chance this option ends in the money (from delta)',
    odds: 'Odds',
    cost: 'Cost',
    spotNow: '{underlying} now {price}',
    dragAbove: 'Drag onto the chart to buy. Pays if {underlying} ends above {strike}.',
    dragBelow: 'Drag onto the chart to buy. Pays if {underlying} ends below {strike}.',
    buyTip: 'Buy: pay this premium, risk is limited to it',
    sellTip: 'Sell: collect {price} now, but you take the risk',
    sell: 'sell',
    showFewer: 'Show fewer targets ▴',
    showAll: 'Show all targets ▾',

    step1Title: 'Pick a direction.',
    step1Use: 'Use the',
    step1UpList: 'list if you think {underlying} will rise and the',
    step1DownList: 'list if you think it will fall.',
    step2Title: 'Pick a target price.',
    step2Body: 'Targets further away are cheaper, but less likely to pay.',
    step2Odds: "is the market's estimate of the chance it pays out.",
    step3Title: 'Drag it onto the chart.',
    step3Body:
      'Green shows where you win at expiry and red where you lose. Combine several options to shape the trade.',
    youPay: 'You pay now',
    youReceive: 'You receive now',
    maxWin: 'Most you can win',
    maxLose: 'Most you can lose',
    unlimited: 'Unlimited',
    unlimitedWarn: 'Unlimited ⚠',
    breakeven: 'Breakeven',
    chanceTip: 'Rough market-implied estimate; it assumes one flat volatility',
    chance: 'Chance of profit',
    mixedExpiries:
      'This trade mixes expiry dates, and the chart treats every option as if it expires at the same time. Open it in Builder for an accurate view.',
    nakedWarning:
      'Selling options without a protective option can lose more than you collect. Consider buying a further-out option on the same side to cap the risk.',
    each: '{price} each · {venue}',
    decrease: 'Decrease quantity',
    increase: 'Increase quantity',
    switchToSell: 'Switch to sell',
    switchToBuy: 'Switch to buy',
    flipToSell: '→ sell',
    flipToBuy: '→ buy',
    removeOption: 'Remove option',
    clear: 'Clear',
    openBuilder: 'Open in Builder to trade →',

    legBuy: 'Buy',
    legSell: 'Sell',
    legUp: '▲ UP',
    legDown: '▼ DOWN',
    describeBuyAbove:
      "You pay {premium} now. It pays out if {underlying} ends above {strike}, and you're in profit past {be}. The most you can lose is the {premium} you paid.",
    describeBuyBelow:
      "You pay {premium} now. It pays out if {underlying} ends below {strike}, and you're in profit past {be}. The most you can lose is the {premium} you paid.",
    describeSellCall:
      'You collect {premium} now. You keep it if {underlying} stays below {strike}, and you start losing money if it ends above {be}.',
    describeSellPut:
      'You collect {premium} now. You keep it if {underlying} stays above {strike}, and you start losing money if it ends below {be}.',

    blurbLongCall: 'A bet that the price goes up. Your risk is limited to what you paid.',
    blurbLongPut: 'A bet that the price goes down. Your risk is limited to what you paid.',
    blurbShortCall:
      'You get paid to bet the price will NOT rise much. Losses can be unlimited if it rallies.',
    blurbShortPut: 'You get paid to bet the price will NOT fall much. A big drop can mean a big loss.',
    blurbBullCallSpread:
      'A cheaper bet on the price going up. Both your profit and your loss are capped.',
    blurbBearCallSpread:
      'You get paid upfront if the price stays below a level. Both profit and loss are capped.',
    blurbBearPutSpread:
      'A cheaper bet on the price going down. Both your profit and your loss are capped.',
    blurbBullPutSpread:
      'You get paid upfront if the price stays above a level. Both profit and loss are capped.',
    blurbLongStraddle: 'A bet on a BIG move in either direction. You lose if the price stays still.',
    blurbLongStrangle:
      'A cheaper bet on a BIG move in either direction. The move needs to be bigger.',
    blurbShortStraddle:
      'You get paid if the price stays calm. A big move either way can mean a big loss.',
    blurbShortStrangle:
      'You get paid if the price stays inside a range. A big move can mean a big loss.',
    blurbIronCondor:
      'You get paid if the price stays inside a range. Losses are capped on both sides.',
    blurbIronButterfly:
      'You get paid if the price pins near one level. Losses are capped on both sides.',
    blurbButterfly: 'A cheap bet that the price ends near the middle strike.',
    blurbCustom:
      'A custom combination. Read the green and red zones on the chart: green is where you make money at expiry.',

    chartType: 'Chart type',
    candles: 'Candles',
    line: 'Line',
    timeframe: 'Timeframe',
    auto: 'Auto',
    autoWith: 'Auto · {label}',
    noHistory:
      'Price history isn’t available for {underlying} right now. Your trade summary below still works.',
    dragHere: 'Drag an option here',
    pickFrom: 'Pick from',
    ifRise: 'if you think {underlying} will rise, or',
    ifFall:
      'if you think it will fall. Drop it on the chart to see where you would win or lose by the deadline.',
    hoverIf: 'If {underlying} is at',
    hoverDeadline: 'at the deadline',
    dropToAdd: 'Drop to add to your trade',
    deadline: 'Deadline  {date}',
    profitZone: 'PROFIT ZONE',
    lossZone: 'LOSS ZONE',
    lineBuy: 'BUY',
    lineSell: 'SELL',
  },
  {
    noLiveQuoteAdd: 'No hay {side} en vivo para esa opción ahora mismo.',
    noLiveQuoteFlip: 'No hay {side} en vivo para {direction} esa opción.',
    switchToBuyVerb: 'comprar',
    switchToSellVerb: 'vender',

    showSide: 'Mostrar opciones {side}',
    upOptions: '▲ Opciones SUBE',
    downOptions: '▼ Opciones BAJA',
    up: 'SUBE',
    down: 'BAJA',
    betUp: '▲ Apuesta a que {underlying} SUBE',
    betDown: '▼ Apuesta a que {underlying} BAJA',
    callsSub: 'Calls: te paga si el precio termina por encima del objetivo',
    putsSub: 'Puts: te paga si el precio termina por debajo del objetivo',
    collapseList: 'Contraer lista',
    collapse: 'Contraer',
    target: 'Objetivo',
    oddsTip: 'Probabilidad implícita del mercado de que esta opción termine in the money (según delta)',
    odds: 'Prob.',
    cost: 'Costo',
    spotNow: '{underlying} ahora {price}',
    dragAbove: 'Arrástrala al gráfico para comprar. Paga si {underlying} termina por encima de {strike}.',
    dragBelow: 'Arrástrala al gráfico para comprar. Paga si {underlying} termina por debajo de {strike}.',
    buyTip: 'Comprar: pagas esta prima y tu riesgo se limita a ella',
    sellTip: 'Vender: cobras {price} ahora, pero asumes el riesgo',
    sell: 'vender',
    showFewer: 'Mostrar menos objetivos ▴',
    showAll: 'Mostrar todos los objetivos ▾',

    step1Title: 'Elige una dirección.',
    step1Use: 'Usa la lista',
    step1UpList: 'si crees que {underlying} subirá y la lista',
    step1DownList: 'si crees que bajará.',
    step2Title: 'Elige un precio objetivo.',
    step2Body: 'Los objetivos más lejanos son más baratos, pero es menos probable que paguen.',
    step2Odds: 'es la estimación del mercado de la probabilidad de que pague.',
    step3Title: 'Arrástrala al gráfico.',
    step3Body:
      'El verde muestra dónde ganas al vencimiento y el rojo dónde pierdes. Combina varias opciones para darle forma al trade.',
    youPay: 'Pagas ahora',
    youReceive: 'Recibes ahora',
    maxWin: 'Lo máximo que puedes ganar',
    maxLose: 'Lo máximo que puedes perder',
    unlimited: 'Ilimitado',
    unlimitedWarn: 'Ilimitado ⚠',
    breakeven: 'Breakeven',
    chanceTip: 'Estimación aproximada implícita del mercado; asume una volatilidad única',
    chance: 'Probabilidad de ganancia',
    mixedExpiries:
      'Este trade mezcla fechas de vencimiento y el gráfico trata cada opción como si venciera al mismo tiempo. Ábrelo en el Constructor para una vista precisa.',
    nakedWarning:
      'Vender opciones sin una opción de protección puede hacerte perder más de lo que cobras. Considera comprar una opción más alejada del mismo lado para limitar el riesgo.',
    each: '{price} c/u · {venue}',
    decrease: 'Disminuir cantidad',
    increase: 'Aumentar cantidad',
    switchToSell: 'Cambiar a vender',
    switchToBuy: 'Cambiar a comprar',
    flipToSell: '→ vender',
    flipToBuy: '→ comprar',
    removeOption: 'Quitar opción',
    clear: 'Limpiar',
    openBuilder: 'Abrir en el Constructor para operar →',

    legBuy: 'Comprar',
    legSell: 'Vender',
    legUp: '▲ SUBE',
    legDown: '▼ BAJA',
    describeBuyAbove:
      'Pagas {premium} ahora. Paga si {underlying} termina por encima de {strike}, y estás en ganancia más allá de {be}. Lo máximo que puedes perder son los {premium} que pagaste.',
    describeBuyBelow:
      'Pagas {premium} ahora. Paga si {underlying} termina por debajo de {strike}, y estás en ganancia más allá de {be}. Lo máximo que puedes perder son los {premium} que pagaste.',
    describeSellCall:
      'Cobras {premium} ahora. Te lo quedas si {underlying} se mantiene por debajo de {strike}, y empiezas a perder dinero si termina por encima de {be}.',
    describeSellPut:
      'Cobras {premium} ahora. Te lo quedas si {underlying} se mantiene por encima de {strike}, y empiezas a perder dinero si termina por debajo de {be}.',

    blurbLongCall: 'Una apuesta a que el precio sube. Tu riesgo se limita a lo que pagaste.',
    blurbLongPut: 'Una apuesta a que el precio baja. Tu riesgo se limita a lo que pagaste.',
    blurbShortCall:
      'Te pagan por apostar a que el precio NO subirá mucho. Las pérdidas pueden ser ilimitadas si hay un rally.',
    blurbShortPut:
      'Te pagan por apostar a que el precio NO bajará mucho. Una gran caída puede significar una gran pérdida.',
    blurbBullCallSpread:
      'Una apuesta más barata a que el precio sube. Tanto tu ganancia como tu pérdida están limitadas.',
    blurbBearCallSpread:
      'Te pagan por adelantado si el precio se mantiene por debajo de un nivel. Ganancia y pérdida están limitadas.',
    blurbBearPutSpread:
      'Una apuesta más barata a que el precio baja. Tanto tu ganancia como tu pérdida están limitadas.',
    blurbBullPutSpread:
      'Te pagan por adelantado si el precio se mantiene por encima de un nivel. Ganancia y pérdida están limitadas.',
    blurbLongStraddle:
      'Una apuesta a un movimiento GRANDE en cualquier dirección. Pierdes si el precio no se mueve.',
    blurbLongStrangle:
      'Una apuesta más barata a un movimiento GRANDE en cualquier dirección. El movimiento debe ser mayor.',
    blurbShortStraddle:
      'Te pagan si el precio se mantiene tranquilo. Un gran movimiento en cualquier dirección puede significar una gran pérdida.',
    blurbShortStrangle:
      'Te pagan si el precio se mantiene dentro de un rango. Un gran movimiento puede significar una gran pérdida.',
    blurbIronCondor:
      'Te pagan si el precio se mantiene dentro de un rango. Las pérdidas están limitadas en ambos lados.',
    blurbIronButterfly:
      'Te pagan si el precio se queda cerca de un nivel. Las pérdidas están limitadas en ambos lados.',
    blurbButterfly: 'Una apuesta barata a que el precio termina cerca del strike central.',
    blurbCustom:
      'Una combinación personalizada. Lee las zonas verdes y rojas del gráfico: el verde es donde ganas dinero al vencimiento.',

    chartType: 'Tipo de gráfico',
    candles: 'Velas',
    line: 'Línea',
    timeframe: 'Temporalidad',
    auto: 'Auto',
    autoWith: 'Auto · {label}',
    noHistory:
      'El historial de precios de {underlying} no está disponible ahora. El resumen de tu trade abajo sigue funcionando.',
    dragHere: 'Arrastra una opción aquí',
    pickFrom: 'Elige de',
    ifRise: 'si crees que {underlying} subirá, o de',
    ifFall:
      'si crees que bajará. Suéltala en el gráfico para ver dónde ganarías o perderías al vencimiento.',
    hoverIf: 'Si {underlying} está en',
    hoverDeadline: 'al vencimiento',
    dropToAdd: 'Suelta para agregarla a tu trade',
    deadline: 'Vencimiento  {date}',
    profitZone: 'ZONA DE GANANCIA',
    lossZone: 'ZONA DE PÉRDIDA',
    lineBuy: 'COMPRA',
    lineSell: 'VENTA',
  },
);

export type EasyMessageKey = keyof typeof easyMessages.en;
