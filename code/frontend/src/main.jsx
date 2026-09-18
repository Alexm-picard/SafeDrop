// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~80% (Vite template base)
// AI-Assisted Areas: mount point
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Browser entry point: mount the React application into the page.
 *
 * The only module that touches the DOM directly. A missing `#root` throws immediately rather than
 * failing silently, since a blank page with no error is far harder to diagnose than a thrown one.
 *
 * `StrictMode` is deliberate in development: it double-invokes effects and renders to surface missing
 * cleanup, which is what keeps the abort handling in useApiResource and AuthContext honest.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
