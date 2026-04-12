// Pure data module. Single source of truth for the preset list.
// When adding a preset: also add it to popup.js render order and to
// docs/screenshots if applicable.

export const PRESET_DEFINITIONS = {
  gemini: {
    label: 'Gemini',
    icon: '✦',
    domains: ['gemini.google.com'],
    isAi: true,
  },
  aiStudio: {
    label: 'AI Studio',
    icon: '⚡',
    domains: [
      'aistudio.google.com',
      'alkalimakersuite-pa.clients6.google.com',
    ],
    isAi: true,
  },
  notebookLM: {
    label: 'NotebookLM',
    icon: '📓',
    domains: ['notebooklm.google.com'],
    isAi: true,
  },
  googleLabs: {
    label: 'Google Labs',
    icon: '🧪',
    domains: ['labs.google', 'labs.google.com'],
    isAi: true,
  },
  chatgpt: {
    label: 'ChatGPT',
    icon: '◎',
    domains: ['chatgpt.com', 'chat.openai.com'],
    isAi: false,
  },
  claude: {
    label: 'Claude',
    icon: '✱',
    domains: ['claude.ai'],
    isAi: false,
  },
  perplexity: {
    label: 'Perplexity',
    icon: '⬢',
    domains: ['perplexity.ai', 'www.perplexity.ai'],
    isAi: false,
  },
  youtube: {
    label: 'YouTube',
    icon: '▶',
    domains: ['youtube.com', 'www.youtube.com', 'youtu.be', 'googlevideo.com'],
    isAi: false,
  },
  // Hidden preset — auto-routes Google login domains when ANY isAi preset is enabled.
  // Not exposed in UI; managed by pac.js.
  googleAuth: {
    label: 'Google login (auto)',
    icon: '🔐',
    domains: ['accounts.google.com', 'ogs.google.com'],
    isAi: false,
    hidden: true,
  },
};

export const PRESET_ORDER = [
  'gemini',
  'aiStudio',
  'notebookLM',
  'googleLabs',
  'chatgpt',
  'claude',
  'perplexity',
  'youtube',
];

export const AI_PRESET_KEYS = Object.entries(PRESET_DEFINITIONS)
  .filter(([_, p]) => p.isAi)
  .map(([k, _]) => k);
