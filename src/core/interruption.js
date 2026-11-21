"use strict";

const { AsyncLocalStorage } = require('node:async_hooks');
const { execFile: nativeExecFile } = require('node:child_process');
const { promisify } = require('node:util');

const scope = new AsyncLocalStorage();

function signal() {
  return scope.getStore();
}

function checkpoint() {
  signal()?.throwIfAborted();
}

function abortError() {
  const error = new Error('Request interrupted.');
  error.name = 'AbortError';
  error.code = 'EDEN_INTERRUPTED';
  return error;
}

function cancellable(work, current = signal()) {
  if (!current) return Promise.resolve().then(work);
  if (current.aborted) return Promise.reject(current.reason);

  return new Promise((resolve, reject) => {
    const abort = () => reject(current.reason);
    current.addEventListener('abort', abort, { once: true });

    Promise.resolve()
      .then(() => {
        current.throwIfAborted();
        return work();
      })
      .then(resolve, reject)
      .finally(() => current.removeEventListener('abort', abort));
  });
}

function options(value) {
  checkpoint();
  const current = signal();

  return current
    ? {
        ...value,
        signal: value?.signal
          ? AbortSignal.any([current, value.signal])
          : current
      }
    : value;
}

function execFile(file, args, config, callback) {
  if (typeof config === 'function') {
    callback = config;
    config = {};
  }

  return nativeExecFile(
    file,
    args,
    options(config || {}),
    callback
  );
}

execFile[promisify.custom] = (file, args, config = {}) =>
  promisify(nativeExecFile)(file, args, options(config));

function guardAsyncMethods(Class) {
  for (const name of Object.getOwnPropertyNames(Class.prototype)) {
    const method = Class.prototype[name];

    if (
      typeof method !== 'function' ||
      method.constructor.name !== 'AsyncFunction'
    ) continue;

    Class.prototype[name] = async function (...args) {
      checkpoint();
      const result = await method.apply(this, args);
      checkpoint();
      return result;
    };
  }
}

function isStopCommand(value) {
  const text = String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[.,!?;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return /^(?:(?:(?:hey|hi|hello) )?(?:eden|aiden|hayden) )?(?:please )?(?:stop|cancel|stop speaking|stop talking|stop searching|stop working|stop everything|cancel that|cancel the request|stop the task)(?: please)?$/.test(text);
}

module.exports = {
  scope,
  signal,
  checkpoint,
  abortError,
  cancellable,
  execFile,
  guardAsyncMethods,
  isStopCommand
};
