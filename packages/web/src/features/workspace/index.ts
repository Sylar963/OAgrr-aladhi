import { lazy } from 'react';

export { useWorkspaceTemplates, WorkspaceTemplatesProvider } from './template-picker-context';
export { default as WidgetFrame } from './WidgetFrame';
export { default as WorkspaceView } from './WorkspaceView';

export const WorkspaceBar = lazy(() => import('./WorkspaceBar'));
