import { defineMessages, useT } from '@lib/i18n';
import { Component, type ErrorInfo, type ReactNode } from 'react';

import styles from './ErrorBoundary.module.css';

const messages = defineMessages(
  {
    failedToLoad: '{label} failed to load',
    somethingWrong: 'Something went wrong',
    unexpected: 'An unexpected error occurred.',
    retry: 'Retry',
  },
  {
    failedToLoad: 'No se pudo cargar {label}',
    somethingWrong: 'Algo salió mal',
    unexpected: 'Ocurrió un error inesperado.',
    retry: 'Reintentar',
  },
);

function ErrorFallback({
  error,
  label,
  onRetry,
}: {
  error: Error;
  label: string | undefined;
  onRetry: () => void;
}) {
  const t = useT(messages);
  return (
    <div className={styles.wrap} role="alert">
      <span className={styles.icon} aria-hidden>
        ⚠
      </span>
      <span className={styles.title}>
        {label ? t('failedToLoad', { label }) : t('somethingWrong')}
      </span>
      <span className={styles.detail}>{error.message || t('unexpected')}</span>
      <button className={styles.retry} onClick={onRetry} type="button">
        {t('retry')}
      </button>
    </div>
  );
}

interface Props {
  children: ReactNode;
  label?: string;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary]', this.props.label ?? 'unknown', error, info.componentStack);
    }
  }

  handleRetry = (): void => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return <ErrorFallback error={error} label={this.props.label} onRetry={this.handleRetry} />;
  }
}
