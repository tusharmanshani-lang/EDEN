'use strict';

(() => {
  const unsubscribe = window.eden?.onCodingResult?.(result => {
    if (typeof result?.reply !== 'string') return;
    const messages = document.getElementById('messages');
    if (!messages) return;
    const message = document.createElement('div');
    message.className = 'message assistant-message';
    const name = document.createElement('strong');
    name.textContent = 'EDEN';
    const text = document.createElement('p');
    text.textContent = result.reply;
    message.append(name, text);
    const links = [...new Set([result.previewUrl, ...(result.links || [])].filter(Boolean))];
    for (const raw of links) {
      let url;
      try { url = new URL(raw); } catch { continue; }
      if (!(url.protocol === 'http:' && url.hostname === '127.0.0.1' || url.protocol === 'https:' && url.hostname.endsWith('.vercel.app'))) continue;
      const link = document.createElement('a');
      link.href = url.href;
      link.textContent = url.hostname === '127.0.0.1' ? 'Open local preview' : 'Open deployed website';
      link.addEventListener('click', event => {
        event.preventDefault();
        void window.eden.openProjectLink(url.href).catch(error => { text.textContent += '\n' + error.message; });
      });
      const paragraph = document.createElement('p'); paragraph.append(link); message.append(paragraph);
    }
    if (result.reportDirectory) {
      const report = document.createElement('button');
      report.type = 'button'; report.textContent = 'Open test reports and screenshots';
      report.addEventListener('click', () => { void window.eden.openCodingReport(result.reportDirectory).catch(error => { text.textContent += '\n' + error.message; }); });
      message.append(report);
    }
    if (result.folder) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Open project in VS Code';
      button.addEventListener('click', async () => {
        try { await window.eden.sendMessage('open the project in VS Code'); }
        catch (error) { text.textContent += '\n' + error.message; }
      });
      message.append(button);
    }
    messages.append(message);
    messages.scrollTop = messages.scrollHeight;
    window.edenStage?.setConversation?.(true);
  });
  window.addEventListener('beforeunload', () => unsubscribe?.());
})();
