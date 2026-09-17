// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~80% (Vite template base)
// AI-Assisted Areas: mount point
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
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
