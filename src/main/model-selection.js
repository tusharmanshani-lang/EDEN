'use strict';

function chatCandidates(rows) {
  const names = rows.filter(row => {
    const id = String(row?.name || '').replace(/^models\//, '');
    return /^gemini-[a-z0-9._-]+$/i.test(id) &&
      Array.isArray(row.supportedActions) && row.supportedActions.includes('generateContent') &&
      !/(?:image|audio|tts|live|embedding|robotics|computer-use|deep-research)/i.test(id);
  }).map(row => String(row.name).replace(/^models\//, ''));
  function priority(id) {
    // Prefer everyday Flash models; this is a capability heuristic, not a price guarantee.
    return (id.includes('flash') ? 0 : 20) +
      (/(?:preview|experimental|exp(?:-|$))/.test(id) ? 10 : 0) +
      (id.includes('lite') ? 1 : 0);
  }
  function version(id) {
    const match = id.match(/^gemini-(\d+)(?:\.(\d+))?/);
    return match ? Number(match[1]) * 1000 + Number(match[2] || 0) : 0;
  }
  return [...new Set(names)].sort((a, b) => priority(a) - priority(b) || version(b) - version(a) || a.localeCompare(b));
}

async function selectModel(ai, { manual = '', isCancelled = () => false } = {}) {
  const check = () => { if (isCancelled()) throw new Error('Setup closed.'); };
  check();
  let candidates;
  if (manual) candidates = [manual];
  else {
    const rows = [];
    const pager = await ai.models.list({ config: { pageSize: 100 } });
    for await (const row of pager) {
      check();
      rows.push(row);
      if (rows.length >= 500) break;
    }
    candidates = chatCandidates(rows).slice(0, 3);
  }
  check();
  if (!candidates.length) throw new Error('No compatible Gemini chat model was found for this key. Check API access in Google AI Studio.');
  let last;
  for (const model of candidates) {
    check();
    try {
      const response = await ai.models.generateContent({ model, contents: 'Reply with one short greeting.', config: { maxOutputTokens: 256 } });
      check();
      if (!String(response?.text || '').trim()) throw new Error('Empty model response.');
      return model;
    } catch (error) {
      check();
      last = error;
      if ([401, 403].includes(Number(error?.status || error?.code || 0))) throw error;
    }
  }
  throw last || new Error('No Gemini chat model responded.');
}
module.exports = { chatCandidates, selectModel };
