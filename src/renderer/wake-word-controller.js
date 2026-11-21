'use strict';

/**
 * Renderer controller. Call after window.eden has been exposed by preload.
 * onWake() should start the separate command-capture/STT phase. This module
 * intentionally does not send microphone audio to Gemini.
 */
function createWakeWordController(edenApi, { onWake, onState } = {}) {
  let unsubscribeWake = null;
  let unsubscribeState = null;

  async function start() {
    if (!edenApi?.startWakeWord) {
      onState?.({ state: 'unavailable', message: 'Wake-word bridge not connected.' });
      return;
    }
    unsubscribeWake = edenApi.onWakeDetected?.((event) => onWake?.(event));
    unsubscribeState = edenApi.onWakeState?.((state) => onState?.(state));
    const result = await edenApi.startWakeWord();
    onState?.(result);
  }

  async function stop() {
    unsubscribeWake?.();
    unsubscribeState?.();
    unsubscribeWake = null;
    unsubscribeState = null;
    return edenApi?.stopWakeWord?.();
  }

  return { start, stop };
}

if (typeof module !== 'undefined') module.exports = { createWakeWordController };
