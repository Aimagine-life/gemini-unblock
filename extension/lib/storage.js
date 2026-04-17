// Wraps chrome.storage.local. Tested in node by mocking globalThis.chrome.

const STORAGE_KEY = 'state';

export function getDefaultState() {
  return {
    schemaVersion: 1,
    enabled: false,
    proxy: null,
    presets: {
      gemini:     { enabled: true,  domains: ['gemini.google.com'] },
      aiStudio:   { enabled: true,  domains: ['aistudio.google.com', 'alkalimakersuite-pa.clients6.google.com'] },
      googleAuth: { enabled: true,  domains: ['accounts.google.com', 'ogs.google.com'] },
      notebookLM: { enabled: false, domains: ['notebooklm.google.com'] },
      googleLabs: { enabled: false, domains: ['labs.google', 'labs.google.com'] },
      chatgpt:    { enabled: false, domains: ['chatgpt.com', 'chat.openai.com'] },
      claude:     { enabled: false, domains: ['claude.ai'] },
      perplexity: { enabled: false, domains: ['perplexity.ai', 'www.perplexity.ai'] },
      grok:       { enabled: false, domains: ['grok.com', 'www.grok.com', 'x.ai'] },
      elevenlabs: { enabled: false, domains: ['elevenlabs.io', 'www.elevenlabs.io', 'api.elevenlabs.io'] },
      youtube:    {
        enabled: false,
        domains: [
          'youtube.com',
          'www.youtube.com',
          'youtu.be',
          'googlevideo.com',
          'ytimg.com',
          'ggpht.com',
        ],
      },
    },
    customDomains: [],
  };
}

export async function loadState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const saved = result[STORAGE_KEY];
  if (!saved) return getDefaultState();

  // Merge: add any new presets that didn't exist when the user first installed.
  const defaults = getDefaultState();
  saved.presets = saved.presets || {};
  for (const [key, def] of Object.entries(defaults.presets)) {
    if (!saved.presets[key]) {
      saved.presets[key] = def;
      continue;
    }

    // Merge domain additions for existing presets so upgrades pull in
    // newly required service domains (e.g. YouTube thumbnails CDN hosts).
    const existing = saved.presets[key];
    const existingDomains = Array.isArray(existing.domains) ? existing.domains : [];
    const mergedDomains = [...existingDomains];
    for (const domain of def.domains || []) {
      if (!mergedDomains.includes(domain)) mergedDomains.push(domain);
    }
    saved.presets[key] = { ...existing, domains: mergedDomains };
  }
  return saved;
}

export async function saveState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}
