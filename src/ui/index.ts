/**
 * Public API surface of ui/ (ARCHITECTURE.md §2 rule 7). ui/ may import public APIs
 * (index.ts) of everything (§2 rule 4).
 *
 * Importing this module pulls in the stylesheet, so `main.ts` needs no separate CSS import
 * and the panels cannot be used without their styles.
 */
import './styles.css';

export * from './i18n/i18n';
export * from './App';
export * from './templateNotice';
export * from './editor/EditorPanel';
export * from './editor/awlLanguage';
export * from './editor/completion';
export * from './editor/lint';
export * from './panels/ControlPanel';
export * from './panels/DiagnosticsPanel';
export * from './panels/WatchPanel';
export * from './panels/ExercisePanel';
export * from './panels/HintPanel';
export * from './panels/ExamplesPanel';
export * from './layout/layoutModel';
export * from './layout/LayoutController';
