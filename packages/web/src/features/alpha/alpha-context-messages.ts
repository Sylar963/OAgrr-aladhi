import { defineMessages } from '@lib/i18n';

export const contextMessages = defineMessages(
  {
    supported: 'CONDITIONS SUPPORT',
    conditional: 'CONDITIONAL',
    'poor-fit': 'POOR FIT',
    unavailable: 'INSUFFICIENT DATA',
    'call-credit': 'Call credit · bearish / carry',
    'put-credit': 'Put credit · bullish / carry',
    'call-debit': 'Call debit · bullish',
    'put-debit': 'Put debit · bearish',
    'long-call': 'Long call · bullish / long vol',
    'long-put': 'Long put · bearish / long vol',
    'protective-put': 'Protective put · insurance',
    'price-up': 'Upward price pressure supports this bullish structure.',
    'price-down': 'Downward price pressure supports this bearish structure.',
    'direction-conflict': 'Observed price pressure opposes this strategy’s direction.',
    'direction-unconfirmed': 'Price windows do not establish a directional trend.',
    'reversal-risk': 'Short and longer price windows disagree: reversal risk.',
    'vol-below-range':
      'Implied volatility is below the historical delivery range: relatively cheap volatility.',
    'vol-above-range':
      'Implied volatility is above the historical delivery range: relatively expensive volatility.',
    'vol-within-range':
      'Implied volatility lies within the historical delivery range; no clear volatility-price advantage.',
    'pricing-unknown': 'No reliable matched-horizon volatility-price comparison is available.',
    'vol-accelerating':
      'RV acceleration is in the top historical decile; short-option risk is elevated.',
    'front-vol-stress': '7D IV exceeds 30D IV by more than 2 points: near-term stress.',
    'credit-premium-thin':
      'Selling relatively cheap volatility offers less compensation for short-option risk.',
    'upside-short-risk': 'Rising prices threaten the short call side.',
    'downside-short-risk': 'Falling prices threaten the short put side.',
    'vertical-price-check':
      'A vertical offsets part of its vega. Exact strikes, net premium and fees can overturn this class-level fit.',
    'insurance-purpose':
      'This put protects owned spot. Judge the floor and insurance cost separately from a speculative bearish bet.',
    'insurance-expensive':
      'Downside insurance is relatively expensive; protection can still be useful.',
    'history-unavailable': 'Completed, recent and continuous price history is insufficient.',
    'horizon-unsupported': 'This expiry is past or beyond the supported 90-day horizon.',
    'near-expiry':
      'Less than one day remains; daily volatility history cannot resolve intraday expiry risk.',
    'wing-pricing':
      'Long-option pricing uses the 25Δ wing-IV proxy, including risk reversal and butterfly.',
    'wing-pricing-unavailable':
      'Wing pricing is missing; cheap ATM volatility alone does not establish a cheap call or put.',
    why: 'Why this verdict · automatic evidence & strategy comparison',
    noData: 'Automatic assessment is waiting for market data. No scenario inputs are required.',
    selected: 'Selected expiry · {days}D remaining',
    reference: '{days}D scanning reference · individual candidate expiries can differ',
    pressure: 'Price pressure',
    up: 'UP',
    down: 'DOWN',
    range: 'NO CLEAR TREND',
    transition: 'REVERSAL / MIXED',
    hourly: 'completed hourly closes',
    daily: 'completed daily closes',
    price: 'Matched IV / historical delivery range',
    wing: '25Δ call / put IV proxy',
    forecast: 'Model forecast',
    acceleration: 'RV 7D / 30D acceleration',
    history: '{n} non-overlapping {days}D outcomes · historical 20th–80th percentiles',
    method:
      'Price pressure needs agreement across two windows of at least 1 volatility unit, with no opposing window. This describes recent moves; it is not a return forecast. Delivery ranges scale a mean-reverting volatility forecast by historical forecast errors. Thresholds are engineering rules, not validated trading edges.',
    limit:
      'Market fit is automatic and class-level. It does not establish profitability or make a specific trade rational at any price. Event-calendar coverage and portfolio suitability are not assessed.',
    strategy: 'Strategy / purpose',
    verdict: 'Current market fit',
  },
  {
    supported: 'CONDICIONES A FAVOR',
    conditional: 'CONDICIONAL',
    'poor-fit': 'MAL ENCAJE',
    unavailable: 'DATOS INSUFICIENTES',
    'call-credit': 'Call credit · bajista / carry',
    'put-credit': 'Put credit · alcista / carry',
    'call-debit': 'Call debit · alcista',
    'put-debit': 'Put debit · bajista',
    'long-call': 'Long call · alcista / long vol',
    'long-put': 'Long put · bajista / long vol',
    'protective-put': 'Put protector · seguro',
    'price-up': 'La presión alcista del precio apoya esta estructura alcista.',
    'price-down': 'La presión bajista del precio apoya esta estructura bajista.',
    'direction-conflict': 'La presión observada del precio va en contra de esta estrategia.',
    'direction-unconfirmed': 'Las ventanas de precio no confirman una tendencia direccional.',
    'reversal-risk': 'Las ventanas cortas y largas discrepan: riesgo de reversión.',
    'vol-below-range':
      'La IV está por debajo del rango histórico de volatilidad entregada: volatilidad relativamente barata.',
    'vol-above-range':
      'La IV está por encima del rango histórico entregado: volatilidad relativamente cara.',
    'vol-within-range':
      'La IV está dentro del rango histórico; no hay una ventaja clara de precio de volatilidad.',
    'pricing-unknown': 'No hay comparación fiable de precio de volatilidad al mismo horizonte.',
    'vol-accelerating':
      'La aceleración de RV está en el decil histórico superior; aumenta el riesgo de vender opciones.',
    'front-vol-stress': 'IV 7D supera IV 30D por más de 2 puntos: estrés de corto plazo.',
    'credit-premium-thin':
      'Vender volatilidad relativamente barata compensa menos el riesgo de la opción vendida.',
    'upside-short-risk': 'La subida amenaza la call vendida.',
    'downside-short-risk': 'La caída amenaza la put vendida.',
    'vertical-price-check':
      'Un vertical compensa parte de su vega. Strikes, prima neta y comisiones pueden cambiar este encaje general.',
    'insurance-purpose':
      'Esta put protege spot propio. Separa el piso y el costo del seguro de una apuesta bajista.',
    'insurance-expensive': 'La protección bajista es relativamente cara; aun así puede ser útil.',
    'history-unavailable': 'Falta historial de precios completo, reciente y continuo.',
    'horizon-unsupported': 'El vencimiento pasó o supera el horizonte admitido de 90 días.',
    'near-expiry':
      'Queda menos de un día; el historial diario no resuelve el riesgo intradía al vencimiento.',
    'wing-pricing':
      'El precio usa la IV aproximada del ala 25Δ, incluido risk reversal y butterfly.',
    'wing-pricing-unavailable':
      'Falta el precio del ala; una IV ATM barata no demuestra una call o put barata.',
    why: 'Por qué · evidencia automática y comparación de estrategias',
    noData: 'La evaluación automática espera datos de mercado. No requiere ingresar escenarios.',
    selected: 'Vencimiento elegido · quedan {days}D',
    reference: 'Referencia de escaneo {days}D · cada candidato puede tener otro vencimiento',
    pressure: 'Presión del precio',
    up: 'ALCISTA',
    down: 'BAJISTA',
    range: 'SIN TENDENCIA CLARA',
    transition: 'REVERSIÓN / MIXTA',
    hourly: 'cierres horarios completos',
    daily: 'cierres diarios completos',
    price: 'IV al horizonte / rango histórico entregado',
    wing: 'IV aproximada call / put 25Δ',
    forecast: 'Pronóstico del modelo',
    acceleration: 'Aceleración RV 7D / 30D',
    history: '{n} resultados de {days}D sin solapamiento · percentiles históricos 20–80',
    method:
      'La presión requiere dos ventanas de al menos 1 unidad de volatilidad sin ninguna ventana opuesta. Describe movimientos recientes; no pronostica retornos. Los rangos escalan un pronóstico de reversión a la media por sus errores históricos. Los umbrales son reglas de ingeniería, no ventajas validadas.',
    limit:
      'El encaje de mercado es automático y general. No demuestra rentabilidad ni justifica un trade a cualquier precio. No evalúa calendario de eventos ni idoneidad de cartera.',
    strategy: 'Estrategia / propósito',
    verdict: 'Encaje actual',
  },
);
