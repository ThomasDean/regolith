import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './shell/Root';
import './ui/styles.css';
import './shell/shell.css';
import { registerServiceWorker } from './pwa';
import { redirectLegacy } from './shell/route';

registerServiceWorker();
redirectLegacy();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
