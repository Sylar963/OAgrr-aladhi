import { lazy } from 'react';

export { default as WidgetFrame } from './WidgetFrame';
export { default as WorkspaceView } from './WorkspaceView';

export const WorkspaceBar = lazy(() => import('./WorkspaceBar'));
