import { lazy } from 'react';

export { default as CustomTabView } from './CustomTabView';
export { default as WidgetFrame } from './WidgetFrame';

export const WorkspaceBar = lazy(() => import('./WorkspaceBar'));
