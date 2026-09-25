const target = process.env.BACKEND_URL;

if (!target) {
  throw new Error('Set BACKEND_URL to the backend origin, e.g. http://<backend-host>:8000');
}
const url = new URL(target);
if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) {
  throw new Error('BACKEND_URL must be an http(s) origin without a path, query, or fragment');
}

module.exports = {
  '/api/**': {
    target,
    changeOrigin: true,
    // SSE is a long-lived response; do not time out an idle stream.
    timeout: 0,
    proxyTimeout: 0,
  },
};
