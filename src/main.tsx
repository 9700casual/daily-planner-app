import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import DailyPlanner from './DailyPlanner';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DailyPlanner />
  </StrictMode>
);
