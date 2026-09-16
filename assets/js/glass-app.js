import { startRouter } from './router.js';
import { RENDERERS } from './glass-pages.js';
import { initGlassUI } from './glass-ui.js';

// 诗文页在导航里归到「诗集」，分段导航与底部标签栏始终有一项选中。
startRouter(RENDERERS, { navOf: { poem: 'list' } });
initGlassUI();
