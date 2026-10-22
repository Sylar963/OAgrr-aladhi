import { defineMessages, translate, type Locale } from '@lib/i18n';

const errorMessages = defineMessages(
  {
    assistant_not_enabled: 'Portfolio Assistant is temporarily unavailable.',
    daily_limit_reached: 'Daily Portfolio Assistant question limit reached.',
    concurrent_request: 'Another Portfolio Assistant response is already in progress.',
    thread_not_found: 'Conversation not found.',
    portfolio_unavailable: 'Portfolio context is unavailable.',
    portfolio_stale: 'Portfolio snapshot is stale.',
    provider_unavailable: 'Hermes is temporarily unavailable.',
    provider_allowance_exhausted: 'The shared model allowance is currently exhausted.',
    provider_timeout: 'Hermes did not respond in time.',
    invalid_provider_response: 'Hermes returned an invalid response.',
    request_cancelled: 'Request cancelled.',
    internal_error: 'Portfolio Assistant could not complete the response.',
    persistence_unavailable: 'Portfolio Assistant storage is unavailable.',
    memory_item_not_found: 'That memory no longer exists.',
    unauthorized: 'Sign in to use Portfolio Assistant.',
    invalid_response: 'Portfolio Assistant returned an invalid response.',
    request_failed: 'Portfolio Assistant request failed.',
    delete_failed: 'Could not delete.',
    ask_failed: 'Could not ask Hermes.',
    invite_failed: 'Could not redeem invite.',
    invite_assistant_not_enabled: 'This beta invite is expired or fully redeemed.',
    invite_invalid_body: 'Invite code is invalid.',
  },
  {
    assistant_not_enabled: 'Portfolio Assistant no está disponible temporalmente.',
    daily_limit_reached: 'Alcanzaste el límite diario de preguntas a Portfolio Assistant.',
    concurrent_request: 'Ya hay otra respuesta de Portfolio Assistant en curso.',
    thread_not_found: 'Conversación no encontrada.',
    portfolio_unavailable: 'El contexto del portafolio no está disponible.',
    portfolio_stale: 'El snapshot del portafolio está desactualizado.',
    provider_unavailable: 'Hermes no está disponible temporalmente.',
    provider_allowance_exhausted: 'La cuota compartida del modelo está agotada por ahora.',
    provider_timeout: 'Hermes no respondió a tiempo.',
    invalid_provider_response: 'Hermes devolvió una respuesta inválida.',
    request_cancelled: 'Solicitud cancelada.',
    internal_error: 'Portfolio Assistant no pudo completar la respuesta.',
    persistence_unavailable: 'El almacenamiento de Portfolio Assistant no está disponible.',
    memory_item_not_found: 'Ese recuerdo ya no existe.',
    unauthorized: 'Inicia sesión para usar Portfolio Assistant.',
    invalid_response: 'Portfolio Assistant devolvió una respuesta inválida.',
    request_failed: 'Falló la solicitud a Portfolio Assistant.',
    delete_failed: 'No se pudo eliminar.',
    ask_failed: 'No se pudo consultar a Hermes.',
    invite_failed: 'No se pudo canjear la invitación.',
    invite_assistant_not_enabled: 'Esta invitación beta expiró o ya se usó por completo.',
    invite_invalid_body: 'El código de invitación no es válido.',
  },
);

type ErrorKey = keyof typeof errorMessages.en;

function isErrorKey(key: string): key is ErrorKey {
  return Object.hasOwn(errorMessages.en, key);
}

/**
 * English keeps the server's own wording; other locales swap in a translation keyed by the
 * error code, falling back to the server text for codes we have no translation for.
 */
export function assistantErrorText(
  code: string | null,
  message: string,
  locale: Locale,
  scope?: 'invite',
): string {
  if (locale === 'en' || code == null) return message;
  const scoped = scope != null ? `${scope}_${code}` : null;
  if (scoped != null && isErrorKey(scoped)) return translate(errorMessages, scoped, undefined, locale);
  return isErrorKey(code) ? translate(errorMessages, code, undefined, locale) : message;
}

export function assistantErrorFrom(
  error: unknown,
  fallbackCode: ErrorKey,
  locale: Locale,
  scope?: 'invite',
): string {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : null;
    return assistantErrorText(code, error.message, locale, scope);
  }
  return translate(errorMessages, fallbackCode, undefined, locale);
}
