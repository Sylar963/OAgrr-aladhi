import { defineMessages } from '@lib/i18n';

export const walletMessages = defineMessages(
  {
    paradexStarknet:
      'This wallet’s Paradex account was created before wallet sign-in, so it cannot connect this way. Create a read-only key in Paradex (Settings → Key Management → Read-only) and paste it below.',
    noParadexAccount: 'This wallet has no Paradex account.',
    notConfigured: 'Wallet connect is not configured on this deployment.',
    cancelled: 'Wallet connection was cancelled.',
    deriveLoginFailed: 'Derive login failed',
    retryHint: '{reason}. If the sign-in took long to approve, try again.',
    noDeriveSubaccounts: 'This wallet has no Derive subaccounts.',
    deriveClosed: 'Derive connection closed',
    deriveUnreachable: 'Could not reach Derive',
  },
  {
    paradexStarknet:
      'La cuenta de Paradex de esta wallet se creó antes del inicio de sesión con wallet, así que no puede conectarse de esta forma. Crea una clave de solo lectura en Paradex (Settings → Key Management → Read-only) y pégala abajo.',
    noParadexAccount: 'Esta wallet no tiene cuenta de Paradex.',
    notConfigured: 'La conexión de wallet no está configurada en este despliegue.',
    cancelled: 'Se canceló la conexión de la wallet.',
    deriveLoginFailed: 'Falló el inicio de sesión en Derive',
    retryHint: '{reason}. Si tardaste en aprobar el inicio de sesión, inténtalo de nuevo.',
    noDeriveSubaccounts: 'Esta wallet no tiene subcuentas de Derive.',
    deriveClosed: 'Se cerró la conexión con Derive',
    deriveUnreachable: 'No se pudo contactar a Derive',
  },
);
