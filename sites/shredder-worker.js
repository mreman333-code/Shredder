// Shredder web build: the app is a single-page static bundle, so the Worker
// only has to hand every request to the static asset binding.
export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request)
    // The app keeps its projects in localStorage, so nothing here may be cached
    // as HTML for long: a stale index.html would point at deleted asset hashes.
    if ((response.headers.get('content-type') || '').includes('text/html')) {
      const copy = new Response(response.body, response)
      copy.headers.set('cache-control', 'no-cache')
      return copy
    }
    return response
  },
}
