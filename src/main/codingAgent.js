'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { fileURLToPath } = require('node:url');
const run = promisify(execFile);

const hash = data => createHash('sha256').update(data).digest('hex');
const fingerprint = files => hash(JSON.stringify([...files].sort(([a], [b]) => a.localeCompare(b))));
const excluded = name => /^(?:node_modules|\.git|\.codex|\.ssh|\.aws|\.azure|\.config|\.venv|venv|__pycache__|dist|build|coverage|test-results|playwright-report|target|exports|\.godot|\.next|\.DS_Store|\.npmrc|\.pypirc|\.netrc|\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx|class)|auth\.json|credentials(?:\.json)?)$/i.test(name);
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
};

async function inventory(root) {
  const files = new Map();
  let bytes = 0;
  async function walk(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (excluded(entry.name)) continue;
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      const absolute = path.join(directory, entry.name);
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error('Remove or exclude this symlink first: ' + relative);
      if (stat.isDirectory()) { await walk(absolute, relative); continue; }
      if (!stat.isFile()) throw new Error('Unsupported project entry: ' + relative);
      bytes += stat.size;
      if (files.size >= 12000 || bytes > 250 * 1024 * 1024) {
        throw new Error('Project exceeds 12,000 files or 250 MB after exclusions. Select a smaller project.');
      }
      const data = await fs.readFile(absolute);
      files.set(relative, { hash: hash(data), mode: stat.mode & 0o777, size: data.length });
    }
  }
  await walk(root);
  return files;
}

async function safePath(root, relative) {
  if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('Project root became a symlink.');
  if (!relative || relative.split('/').some(part => !part || part === '.' || part === '..' || excluded(part))) {
    throw new Error('Invalid or protected path: ' + relative);
  }
  const target = path.resolve(root, relative);
  if (!inside(root, target)) throw new Error('Path escapes project.');
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new Error('Symlink refused: ' + relative);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return target;
}

async function atomicWrite(file, data, mode = 0o644) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.eden-' + randomUUID();
  try {
    await fs.writeFile(temporary, data, { mode, flag: 'wx' });
    await fs.rename(temporary, file);
    await fs.chmod(file, mode);
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}

function createCodingAgent({ storage, isLocal = async () => false, executable, notify = () => {}, prepareWorkspace, verifyWorkspace }) {
  let project = null;
  let job = null;
  let busy = false;
  let child = null;
  const settingsFile = path.join(storage, 'project.json');
  const cleanEnv = () => {
    const env = {};
    for (const key of ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'SYSTEMROOT', 'SystemRoot']) {
      if (process.env[key]) env[key] = process.env[key];
    }
    env.PATH = process.env.PATH || '/usr/local/bin:/usr/bin:/bin';
    return env;
  };
  const status = () => ({ project, busy, job: job ? {
    id: job.id, state: job.state, task: job.task, workspace: job.work,
    summary: job.summary, error: job.error, usage: job.usage, validation: job.validation, reviewed: job.reviewed === true,
    changes: job.changes || [], log: job.log.slice(-70)
  } : null });
  const emit = text => {
    if (job && text) job.log.push(String(text).slice(0, 3000));
    if (job?.log.length > 150) job.log.shift();
    notify(status());
  };
  const persist = async () => {
    if (!job) return;
    await atomicWrite(path.join(job.dir, 'result.json'), Buffer.from(JSON.stringify({
      ...status(), baseline: [...job.baseline], source: job.source
    }, null, 2)), 0o600);
    await atomicWrite(path.join(storage, 'latest.json'), Buffer.from(JSON.stringify({ id: job.id })), 0o600);
  };
  async function initialize() {
    await fs.mkdir(storage, { recursive: true, mode: 0o700 });
    try { project = JSON.parse(await fs.readFile(settingsFile, 'utf8')).project; }
    catch (error) { if (error.code !== 'ENOENT') emit('Select a project to reset the saved path.'); }
    try {
      const latest = JSON.parse(await fs.readFile(path.join(storage, 'latest.json'), 'utf8'));
      if (!/^[\w-]+$/.test(latest.id)) throw new Error('Invalid saved task ID.');
      const dir = path.join(storage, latest.id);
      const saved = JSON.parse(await fs.readFile(path.join(dir, 'result.json'), 'utf8'));
      job = { ...saved.job, dir, source: saved.source, baseline: new Map(saved.baseline),
        base: path.join(dir, 'baseline'), work: path.join(dir, 'workspace') };
      job.reviewed = false;
      if (['running', 'stopping', 'preparing', 'verifying', 'repairing'].includes(job.state)) {
        job.state = 'cancelled'; job.error = 'EDEN closed before this task finished.';
      }
    } catch (error) { if (error.code !== 'ENOENT') { job = null; emit('The previous task could not be restored.'); } }
  }
  async function select(folder) {
    if (busy) throw new Error('Stop the current coding task first.');
    const selected = await fs.realpath(folder);
    if (!(await fs.stat(selected)).isDirectory()) throw new Error('Select a folder.');
    if ([path.parse(selected).root, os.homedir()].includes(selected) || inside(selected, storage)) {
      throw new Error('Select a specific project folder, outside the coding-agent storage.');
    }
    project = selected;
    await atomicWrite(settingsFile, Buffer.from(JSON.stringify({ project })), 0o600);
    notify(status());
    return status();
  }
  async function locate() {
    const candidates = executable ? [executable] : [
      process.env.EDEN_CODEX_BIN,
      ...String(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(p => path.join(p, 'codex')),
      '/opt/homebrew/bin/codex', '/usr/local/bin/codex', path.join(os.homedir(), '.local/bin/codex')
    ].filter(Boolean);
    for (const candidate of candidates) {
      try { await fs.access(candidate, 1); return candidate; } catch {}
    }
    throw new Error('Codex is missing. Install it and run codex login in Terminal first.');
  }
  function kill(signal = 'SIGTERM') {
    if (!child) return;
    try { process.kill(-child.pid, signal); } catch { child.kill(signal); }
  }
  function stop() {
    if (job && busy && ['running', 'preparing', 'verifying', 'repairing'].includes(job.state)) { job.cancelled = true; job.controller?.abort(); job.state = 'stopping'; kill(); emit('Stopping coding task…'); }
    return status();
  }
  async function changes(allowBusy = false) {
    if (!job || (busy && !allowBusy)) throw new Error('Wait for the coding task to finish.');
    const current = await inventory(job.work);
    job.currentFingerprint = fingerprint(current);
    const paths = new Set([...job.baseline.keys(), ...current.keys()]);
    job.changes = [...paths].sort().flatMap(file => {
      const before = job.baseline.get(file), after = current.get(file);
      if (before?.hash === after?.hash && before?.mode === after?.mode) return [];
      return [{ path: file, type: !before ? 'added' : !after ? 'deleted' : 'modified' }];
    });
    return job.changes;
  }
  async function preview() {
    const list = await changes();
    const sections = [];
    for (const item of list) {
      const read = async root => {
        try { return await fs.readFile(await safePath(root, item.path)); }
        catch (error) { if (error.code === 'ENOENT') return Buffer.alloc(0); throw error; }
      };
      const before = await read(job.base), after = await read(job.work);
      const content = before.includes(0) || after.includes(0)
        ? '[Binary file — inspect the workspace before applying.]'
        : 'BEFORE\n' + before.toString('utf8').slice(0, 12000) + '\nAFTER\n' + after.toString('utf8').slice(0, 12000);
      sections.push(item.type.toUpperCase() + ' ' + item.path + '\n' + content);
      if (sections.join('\n').length > 150000) { sections.push('[Preview shortened. Inspect remaining files in the workspace.]'); break; }
    }
    job.reviewed = true;
    job.reviewFingerprint = job.currentFingerprint;
    return { ...status(), preview: sections.join('\n\n') || 'No file changes.' };
  }
  async function start(task) {
    if (busy) throw new Error('A coding task is already running.');
    if (await isLocal()) throw new Error('Coding with Codex requires cloud mode.');
    if (!project) throw new Error('Select a coding project first.');
    if (typeof task !== 'string' || !task.trim() || task.length > 16000) throw new Error('Enter a task under 16,000 characters.');
    if (job && !['applied', 'discarded'].includes(job.state)) throw new Error('Apply or discard the previous task first.');
    busy = true;
    try {
      const binary = await locate();
      const env = cleanEnv();
      env.PATH = path.dirname(binary) + path.delimiter + env.PATH;
      const help = await run(binary, ['exec', '--help'], { env, timeout: 10000 });
      if (!help.stdout.includes('--ignore-user-config')) throw new Error('Update Codex: npm install -g @openai/codex@latest');
      const source = await fs.realpath(project);
      const baseline = await inventory(source);
      const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
      const dir = path.join(storage, id), base = path.join(dir, 'baseline'), work = path.join(dir, 'workspace');
      await fs.mkdir(base, { recursive: true });
      await fs.mkdir(work);
      for (const [relative, entry] of baseline) {
        const sourcePath = await safePath(source, relative);
        const data = await fs.readFile(sourcePath);
        if (hash(data) !== entry.hash) throw new Error('Project changed while copying. Try again.');
        await atomicWrite(path.join(base, relative), data, entry.mode);
        await atomicWrite(path.join(work, relative), data, entry.mode);
      }
      job = { id, dir, base, work, source, baseline, task: task.trim(), state: 'running', log: [], summary: '', error: null, changes: [] };
      await persist();
      job.controller = new AbortController();
      const signal = job.controller.signal;
      const context = () => ({ workspace: work, source, id, task: job.task, signal });
      const worker = (instruction, images = []) => new Promise((resolve, reject) => {
        const args = ['exec', '--json', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
          '--sandbox', 'workspace-write', '-c', 'approval_policy="never"',
          '-c', 'sandbox_workspace_write.network_access=false'];
        if (process.env.EDEN_CODER_MODEL) args.push('--model', process.env.EDEN_CODER_MODEL);
        for (const image of images.slice(0, 4)) args.push('--image', image);
        args.push('-');
        const prompt = [
          'You are EDEN’s software engineering agent. Complete the user task in this project copy.',
          'Inspect project instructions and existing code. Implement, test, diagnose errors and review your diff.',
          'Do not install packages, deploy, publish, access credentials, or restart EDEN. The tool broker handles approved installs, browser checks and releases.',
          'Commands have no network access. Use installed dependencies. Report checks honestly.',
          'For web projects, include .eden-e2e.json with {"flows":[{"name":"critical flow","steps":[...]}]}.',
          'For a Python web server, include .eden-project.json with {"preview":{"type":"fastapi","app":"main:app"}} or type flask and an appropriate module. Include requirements.txt and runnable unittest tests.',
          'Supported flow steps: fill(label or selector,value), click(role/name or selector), select(selector,value), check(selector), press(selector,key), hover(selector), reload, dialog(value accept/dismiss, placed before the triggering click), expectVisible(selector), expectHidden(selector), expectText(selector,text). Every flow needs an assertion. Use sample data and stable labels/test IDs. Cover critical requested behaviours, not just page loading.',
          'Use responsive layouts with clear typography, spacing and contrast. Avoid horizontal overflow. Do not use external CDNs that would block offline browser tests. Bundle needed assets or use system fonts.',
          'For Godot projects, include project.godot, tests/run_tests.gd where practical, export_presets.cfg, and ASSET-LICENSES.md. Use original primitive/procedural assets or supplied assets; do not invent asset licenses.',
          'For Electron or Expo projects, supply appropriate project/build configuration and tests. Do not invent certificates, developer accounts, API credentials or successful releases.',
          'Final answer: changes, checks actually run and results, unresolved blockers.',
          'USER TASK:', job.task, 'CURRENT PASS:', instruction
        ].join('\n');
        signal.throwIfAborted();
        child = spawn(binary, args, { cwd: work, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
        let pending = '', stderr = '', failed = false, completed = false, processError;
        child.stdin.on('error', () => {}); child.stdin.end(prompt);
        const processLine = line => {
          let event; try { event = JSON.parse(line); } catch { return; }
          if (event.type === 'turn.completed') { completed = true; job.usage = event.usage; }
          if (event.type === 'turn.failed' || event.type === 'error') { failed = true; job.error = event.error?.message || event.message || 'Codex reported a failure.'; }
          const item = event.item;
          if (item?.type === 'agent_message' && event.type === 'item.completed') { job.summary = item.text || ''; emit(job.summary); }
          if (item?.type === 'command_execution') emit((event.type === 'item.completed' ? 'Finished' : 'Running') + ': ' + item.command + (item.exit_code == null ? '' : ' [exit ' + item.exit_code + ']'));
          if (item?.type === 'file_change' && event.type === 'item.completed') emit('Updated project files.');
        };
        child.stdout.on('data', data => {
          pending += data.toString();
          if (pending.length > 4 * 1024 * 1024) { job.error = 'Coding output exceeded the limit.'; job.cancelled = true; job.controller.abort(); kill(); return; }
          let newline;
          while ((newline = pending.indexOf('\n')) >= 0) { processLine(pending.slice(0, newline)); pending = pending.slice(newline + 1); }
        });
        child.stderr.on('data', data => { stderr = (stderr + data).slice(-6000); });
        child.on('error', error => { processError = error; });
        child.once('close', code => {
          child = null;
          if (pending.trim()) processLine(pending);
          if (code === 0 && completed && !failed && !signal.aborted) resolve();
          else reject(processError || new Error(job.error || stderr.trim() || 'Codex did not complete the task.'));
        });
      });
      const timer = setTimeout(() => { job.error = 'Task exceeded the 30-minute limit.'; stop(); }, 30 * 60 * 1000);
      const forceTimer = setInterval(() => { if (job.cancelled) kill('SIGKILL'); }, 4000); forceTimer.unref();
      const localTimer = setInterval(() => { void Promise.resolve(isLocal()).then(local => { if (local) stop(); }).catch(() => stop()); }, 2000); localTimer.unref();
      void (async () => {
        try {
          job.state = 'preparing'; emit('Preparing approved project tools.');
          const prepare = async () => {
            if (!prepareWorkspace) return;
            const result = await prepareWorkspace(context());
            if (result?.executionEnvironment) Object.assign(env, result.executionEnvironment);
            env.PATH = path.dirname(binary) + path.delimiter + env.PATH;
          };
          await prepare();
          let instruction = 'Implement the requested task.', images = [], visualReviewed = false;
          for (let pass = 0; pass < 3; pass++) {
            if (pass) await prepare();
            signal.throwIfAborted(); job.error = null;
            job.state = pass ? 'repairing' : 'running'; emit(pass ? 'Checking and improving the previous pass.' : 'Coding started.');
            await worker(instruction, images);
            if (!verifyWorkspace) { job.state = 'ready'; break; }
            job.state = 'verifying'; emit('Running independent build and browser checks.');
            const report = await verifyWorkspace(context());
            job.validation = report;
            if (report.passed && (!report.web || visualReviewed || !report.images?.length)) { job.state = 'ready'; break; }
            if (pass === 2) {
              if (report.passed) { report.visualReview = 'Not completed within the retry budget.'; job.state = 'ready'; }
              else { job.state = 'blocked'; job.error = 'Independent checks still fail. The original project was not changed.'; }
              break;
            }
            images = report.images || [];
            if (report.passed && report.web) visualReviewed = true;
            instruction = report.passed
              ? 'Review the attached desktop/mobile screenshots for layout, typography, contrast and usability. Fix visual problems while preserving tested behaviour. If the design is already sound, leave it unchanged.'
              : 'Fix these independent verification failures. Preserve working behaviour. Do not bypass tests or weaken assertions merely to pass.\n' + JSON.stringify(report.checks).slice(0, 18000);
          }
        } catch (error) {
          job.state = signal.aborted || job.cancelled ? 'cancelled' : 'failed'; job.error = error.message;
        } finally {
          clearTimeout(timer); clearInterval(forceTimer); clearInterval(localTimer);
          try { await changes(true); await persist(); } catch (error) { job.state = 'failed'; job.error = error.message; }
          busy = false;
          emit(job.state === 'ready' ? 'Task and configured checks finished. Changes are ready.' : job.error || 'Task stopped.');
        }
      })();
      emit('Working in a project copy. You can keep talking with EDEN.');
      return status();
    } catch (error) { busy = false; throw error; }
  }
  async function apply() {
    if (busy || !job || job.state !== 'ready' || !job.reviewed) throw new Error('Only a completed, reviewed task can be applied. Open Review changes first.');
    busy = true;
    try {
      const list = await changes(true);
      if (job.currentFingerprint !== job.reviewFingerprint) throw new Error('The working copy changed after review. Open Review changes again.');
      // Validate every source and candidate before writing any original file.
      const edits = [];
      for (const item of list) {
        const original = await safePath(job.source, item.path);
        let old = null;
        try { old = await fs.readFile(original); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        const expected = job.baseline.get(item.path);
        if ((old === null ? undefined : hash(old)) !== expected?.hash) throw new Error('Original file changed; nothing applied: ' + item.path);
        const candidate = await safePath(job.work, item.path);
        const data = item.type === 'deleted' ? null : await fs.readFile(candidate);
        const mode = data === null ? 0o644 : (await fs.stat(candidate)).mode & 0o777;
        edits.push({ original, old, data, mode, oldMode: expected?.mode });
      }
      const written = [];
      try {
        for (const edit of edits) {
          written.push(edit);
          if (edit.data === null) await fs.unlink(edit.original);
          else await atomicWrite(edit.original, edit.data, edit.mode);
        }
      } catch (error) {
        for (const edit of written.reverse()) {
          try {
            if (edit.old === null) await fs.rm(edit.original, { force: true });
            else await atomicWrite(edit.original, edit.old, edit.oldMode);
          } catch (rollbackError) { error.message += '\nRestore manually from ' + job.base + ': ' + rollbackError.message; }
        }
        throw error;
      }
      job.state = 'applied'; await persist(); emit('Applied ' + edits.length + ' file changes. Original backup: ' + job.base);
      return status();
    } finally { busy = false; }
  }
  async function discard() {
    if (busy) throw new Error('Stop the coding task and wait for it to exit first.');
    if (job) { job.state = 'discarded'; await persist(); emit('Discarded changes. The project copy remains available for inspection.'); }
    return status();
  }
  const shutdown = () => { stop(); kill('SIGKILL'); };
  return { initialize, select, start, status, stop, shutdown, changes, preview, apply, discard };
}

function registerCodingAgent({ ipcMain, dialog, shell, app, isLocal, notify, prepareWorkspace, verifyWorkspace }) {
  const agent = createCodingAgent({ storage: path.join(app.getPath('userData'), 'coding-agent'), isLocal, notify, prepareWorkspace, verifyWorkspace });
  const ready = agent.initialize();
  agent.ready = ready;
  ipcMain.handle('eden:coder', async (event, action, input = {}) => {
    await ready;
    const senderURL = event.senderFrame?.url || '';
    const expectedPage = path.resolve(__dirname, '../renderer/index.html');
    if (!senderURL.startsWith('file:') || fileURLToPath(senderURL) !== expectedPage || event.senderFrame !== event.sender.mainFrame) throw new Error('Coding requests must come from EDEN’s main window.');
    if (action === 'status') return agent.status();
    if (action === 'select') {
      const result = await dialog.showOpenDialog({ title: 'Select a coding project', properties: ['openDirectory'] });
      return result.canceled ? agent.status() : agent.select(result.filePaths[0]);
    }
    if (action === 'start') {
      const project = agent.status().project;
      if (!project) throw new Error('Select a project first.');
      const result = await dialog.showMessageBox({ type: 'question', title: 'EDEN coding agent',
        message: 'Run this coding task with Codex?',
        detail: 'Project: ' + project + '\n\n' + String(input.task || '').slice(0, 3000) +
          '\n\nSelected project content will be processed by Codex. Work happens in a copy. Dependencies and credential files are excluded. Commands use workspace-write sandboxing with network disabled; this is not a read-isolated container.',
        buttons: ['Run task', 'Cancel'], defaultId: 1, cancelId: 1 });
      return result.response === 0 ? agent.start(input.task) : agent.status();
    }
    if (action === 'stop') return agent.stop();
    if (action === 'preview') return agent.preview();
    if (action === 'discard') return agent.discard();
    if (action === 'folder') {
      const folder = agent.status().job?.workspace;
      if (!folder) throw new Error('No task workspace yet.');
      const error = await shell.openPath(folder); if (error) throw new Error(error);
      return agent.status();
    }
    if (action === 'apply') {
      const list = await agent.changes();
      if (agent.status().job?.state !== 'ready' || !agent.status().job?.reviewed) throw new Error('Open Review changes after the task finishes, before applying.');
      const result = await dialog.showMessageBox({ type: 'warning', title: 'Apply coding changes',
        message: 'Apply ' + list.length + ' file changes to the original project?',
        detail: list.map(item => item.type + ': ' + item.path).join('\n').slice(0, 20000) +
          '\n\nReview the preview first. This can include file deletions. Restart EDEN yourself if its source was changed.',
        buttons: ['Apply changes', 'Cancel'], defaultId: 1, cancelId: 1 });
      return result.response === 0 ? agent.apply() : agent.status();
    }
    throw new Error('Unknown coding action.');
  });
  app.on('before-quit', () => agent.shutdown());
  return agent;
}

module.exports = { createCodingAgent, registerCodingAgent };
