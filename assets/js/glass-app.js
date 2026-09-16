import { startRouter } from './router.js';
import { RENDERERS } from './glass-pages.js';
import { initGlassUI } from './glass-ui.js';

startRouter(RENDERERS);
initGlassUI();
