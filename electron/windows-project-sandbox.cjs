// Scope the first-run choice to this project thread. Shared Codex settings stay intact.
async function windowsProjectSandbox(client, cwd, platform = process.platform) {
  if (platform !== 'win32') return;
  try {
    const [settings, managed] = await Promise.all([
      client.request('config/read', { cwd, includeLayers: false }, 2500),
      client.request('configRequirements/read', {}, 2500),
    ]);
    const config = settings?.config;
    if (!config || !settings.origins || managed?.requirements !== null) return;
    if (config.windows?.sandbox || config.features?.prefer_mxc !== undefined) return;
    const customPolicy = Object.keys(settings.origins).some(key =>
      /^(?:windows|permissions|default_permissions)(?:\.|$)/.test(key)
    );
    if (customPolicy) return;
    return { 'features.prefer_mxc': true, 'windows.sandbox': 'unelevated' };
  } catch {
    // Unknown or older policy services retain their own sandbox selection.
  }
}
module.exports = { windowsProjectSandbox };
