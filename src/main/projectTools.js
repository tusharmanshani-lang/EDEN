'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { staticPreview, availablePort } = require('./previewServer');
const digest = value => createHash('sha256').update(value).digest('hex');
const exists = file => fs.access(file).then(() => true, () => false);
const readJSON = file => fs.readFile(file, 'utf8').then(JSON.parse);

async function findExecutable(name, extras = []) {
  for (const file of [...extras, ...String(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(folder => path.join(folder, name))]) {
    try { await fs.access(file, 1); return file; } catch {}
  }
  throw new Error(name + ' is missing. Install its official development tools first.');
}

function execute(command, args, { cwd, env = process.env, signal, timeout = 180000, input, background = false } = {}) {
  signal?.throwIfAborted();
  const child = spawn(command, args, { cwd, env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = '', failure = null;
  const stop = (hard = false) => {
    try { process.kill(-child.pid, hard ? 'SIGKILL' : 'SIGTERM'); }
    catch { child.kill(hard ? 'SIGKILL' : 'SIGTERM'); }
  };
  let force;
  const abort = () => { stop(); force = setTimeout(() => stop(true), 2000); force.unref(); };
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { failure = new Error('Command timed out: ' + path.basename(command)); abort(); }, timeout);
  timer.unref();
  child.stdin.on('error', () => {});
  child.stdin.end(input);
  child.stdout.on('data', data => { output = (output + data).slice(-200000); });
  child.stderr.on('data', data => { errors = (errors + data).slice(-50000); });
  child.on('error', error => { failure = error; });
  const done = new Promise((resolve, reject) => child.once('close', (code, termination) => {
    clearTimeout(timer); clearTimeout(force); signal?.removeEventListener('abort', abort);
    const result = { code, output, errors, termination };
    if (failure || signal?.aborted || code !== 0) {
      const error = failure || new Error(signal?.aborted ? 'Operation cancelled.' : errors.trim() || output.trim() || 'Command failed with exit ' + code);
      error.result = result; reject(error);
    } else resolve(result);
  }));
  if (background) { void done.catch(() => {}); return { child, done, stop }; }
  return done;
}

function createProjectTools({ storage, approve = async () => false, openURL = async () => {}, openTerminal,
  chooseArtifact, chooseOption, deliver = async () => {}, isLocal = async () => false, runner = execute, resolveExecutable = findExecutable, fetcher = fetch, browserModule, browserExecutable, platform = process.platform }) {
  const toolRoot = path.join(storage, 'tools');
  const reportRoot = path.join(storage, 'reports');
  const grants = new Set();
  const servers = new Map();
  let sourceForTask = null;
  let taskID = null;
  let operations = false;
  let operationController = null;
  const games = new Set();

  async function environment() {
    const env = {};
    for (const key of ['HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'SYSTEMROOT']) if (process.env[key]) env[key] = process.env[key];
    env.PATH = process.env.PATH || '/usr/local/bin:/usr/bin:/bin';
    for (const home of ['/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home', '/usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home']) {
      if (await exists(path.join(home, 'bin/java'))) { env.JAVA_HOME = home; env.PATH = path.join(home, 'bin') + path.delimiter + env.PATH; break; }
    }
    env.CI = '1';
    env.NPM_CONFIG_CACHE = path.join(storage, 'npm-cache');
    env.NPM_CONFIG_USERCONFIG = path.join(storage, 'empty-npmrc');
    env.PIP_CONFIG_FILE = os.devNull;
    await fs.mkdir(storage, { recursive: true });
    await fs.writeFile(env.NPM_CONFIG_USERCONFIG, '');
    return env;
  }
  async function allow(category, detail, { network = false, key } = {}) {
    if (network && await isLocal()) throw new Error('Switch off local mode before using network tools.');
    if (key && grants.has(key)) return;
    if (!await approve({ category, detail })) throw new Error('Approval declined: ' + category);
    if (network && await isLocal()) throw new Error('Local mode was enabled before the operation started.');
    if (key) grants.add(key);
  }
  async function command(name, args, cwd, options = {}) {
    const base = await environment();
    const binary = await resolveExecutable(name, name === 'godot' ? ['/Applications/Godot.app/Contents/MacOS/Godot'] :
      ['java', 'javac'].includes(name) && base.JAVA_HOME ? [path.join(base.JAVA_HOME, 'bin', name)] : []);
    const { env: extra, ...rest } = options;
    return runner(binary, args, { cwd, env: { ...base, ...extra }, ...rest });
  }
  async function tool(packageName, binName, signal) {
    const folder = path.join(toolRoot, 'node_modules', packageName);
    if (!await exists(path.join(folder, 'package.json'))) {
      await allow('Install development tool', 'Install ' + packageName + ' in EDEN’s private tool folder. This downloads packages; installation scripts are disabled.', { network: true });
      await fs.mkdir(toolRoot, { recursive: true });
      await command('npm', ['install', '--prefix', toolRoot, '--ignore-scripts', '--no-audit', '--no-fund', packageName], toolRoot, { signal, timeout: 600000 });
    }
    const pkg = await readJSON(path.join(folder, 'package.json'));
    const relative = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[binName];
    if (!relative) throw new Error('No CLI found for ' + packageName);
    const entry = path.resolve(folder, relative);
    if (!entry.startsWith(folder + path.sep)) throw new Error('Unexpected tool entry point.');
    return { folder, entry };
  }
  async function toolCommand(packageName, binName, args, cwd, options = {}) {
    const executable = await tool(packageName, binName, options.signal);
    return command('node', [executable.entry, ...args], cwd, options);
  }
  async function detect(folder) {
    const root = await fs.realpath(folder);
    const pkg = await exists(path.join(root, 'package.json')) ? await readJSON(path.join(root, 'package.json')) : null;
    const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
    const entries = await fs.readdir(root);
    const configuration = await exists(path.join(root, '.eden-project.json')) ? await readJSON(path.join(root, '.eden-project.json')) : {};
    const pythonWeb = ['fastapi', 'flask'].includes(configuration.preview?.type);
    return { root, pkg, deps, entries,
      kind: await exists(path.join(root, 'project.godot')) ? 'godot' : deps.expo ? 'expo' : deps.electron ? 'electron' :
        pkg ? 'node' : entries.some(name => name.endsWith('.py')) ? 'python' :
        await exists(path.join(root, 'pom.xml')) ? 'maven' :
        entries.some(name => name.endsWith('.java')) ? 'java' : 'static',
      configuration,
      web: !deps.electron && !deps.expo && (pythonWeb || Boolean(deps.vite || deps.next || deps['react-scripts'] || deps.express || deps.fastify || deps.koa) || await exists(path.join(root, 'index.html')) || /vite|next|nuxt|webpack|react-scripts|http-server|server\.[cm]?[jt]s/.test(String(pkg?.scripts?.dev || pkg?.scripts?.start || ''))),
      locked: await exists(path.join(root, 'package-lock.json')) };
  }
  async function projectPermission(info, commands, signal) {
    signal?.throwIfAborted();
    const manifest = info.pkg ? JSON.stringify(info.pkg) : await fs.readFile(path.join(info.root, 'requirements.txt')).catch(() => Buffer.alloc(0));
    const key = (taskID || info.root) + ':' + digest(manifest) + ':' + commands.join('|');
    await allow('Run project tools', 'Project: ' + (sourceForTask || info.root) + '\nWorking folder: ' + info.root +
      '\nCommands: ' + commands.join('\n') + '\n\nThese commands execute project/package code on your Mac. Dependency downloads and installation scripts may run. The same dependency setup may run in the applied project folder.', { network: true, key });
  }
  async function prepare(folder, { signal } = {}) {
    const info = await detect(folder);
    if (await exists(path.join(info.root, '.npmrc'))) throw new Error('Project .npmrc requires manual review before automatic installation.');
    if (info.pkg) {
      if (await exists(path.join(info.root, 'yarn.lock')) || await exists(path.join(info.root, 'pnpm-lock.yaml'))) {
        if (!info.locked) throw new Error('This project uses Yarn or pnpm. Install its dependencies manually or supply a package-lock.json; EDEN will not replace its lockfile.');
      }
      const scripts = Object.entries(info.pkg.scripts || {}).map(([key, value]) => key + ': ' + value);
      await projectPermission(info, ['npm ci/install when dependencies are missing', ...scripts], signal);
      const dependencyHash = async () => digest(JSON.stringify(await readJSON(path.join(info.root, 'package.json'))) + (await fs.readFile(path.join(info.root, 'package-lock.json'), 'utf8').catch(() => '')));
      const marker = path.join(info.root, 'node_modules/.eden-dependencies');
      if ((await fs.readFile(marker, 'utf8').catch(() => '')) !== await dependencyHash()) {
        await command('npm', [info.locked ? 'ci' : 'install', '--no-audit', '--no-fund'], info.root, { signal, timeout: 600000 });
        await fs.mkdir(path.dirname(marker), { recursive: true });
        await fs.writeFile(marker, await dependencyHash());
      }
    }
    if (info.kind === 'python' && await exists(path.join(info.root, 'requirements.txt'))) {
      await projectPermission(info, ['python3 -m venv .venv', '.venv/bin/python -m pip install -r requirements.txt'], signal);
      if (!await exists(path.join(info.root, '.venv/bin/python'))) await command('python3', ['-m', 'venv', '.venv'], info.root, { signal });
      const signature = digest(await fs.readFile(path.join(info.root, 'requirements.txt')));
      const marker = path.join(info.root, '.venv/.eden-dependencies');
      if (await fs.readFile(marker, 'utf8').catch(() => '') !== signature) {
        await runner(path.join(info.root, '.venv/bin/python'), ['-m', 'pip', 'install', '-r', 'requirements.txt'], { cwd: info.root, env: await environment(), signal, timeout: 600000 });
        await fs.writeFile(marker, signature);
      }
    }
    return info;
  }
  async function stopPreview(folder) {
    const previous = servers.get(folder);
    servers.delete(folder);
    if (previous) await previous.close();
  }
  async function preview(folder, { signal, open = false } = {}) {
    const info = await prepare(folder, { signal });
    await stopPreview(info.root);
    let server;
    if (['fastapi', 'flask'].includes(info.configuration.preview?.type)) {
      const app = String(info.configuration.preview.app || 'main:app');
      if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*(?::[A-Za-z_]\w*)?$/.test(app)) throw new Error('Invalid Python preview module.');
      const python = await exists(path.join(info.root, '.venv/bin/python')) ? path.join(info.root, '.venv/bin/python') : await findExecutable('python3');
      const port = await availablePort();
      const args = info.configuration.preview.type === 'fastapi'
        ? ['-m', 'uvicorn', app, '--host', '127.0.0.1', '--port', String(port)]
        : ['-m', 'flask', '--app', app, 'run', '--host', '127.0.0.1', '--port', String(port)];
      await projectPermission(info, [path.basename(python) + ' ' + args.join(' ')], signal);
      const running = runner(python, args, { cwd: info.root, env: await environment(), signal, background: true, timeout: 4 * 60 * 60 * 1000 });
      const url = 'http://127.0.0.1:' + port;
      const deadline = Date.now() + 30000; let ready = false;
      while (Date.now() < deadline) {
        signal?.throwIfAborted();
        if (running.child?.exitCode != null) break;
        try { if ((await fetcher(url, { signal: AbortSignal.timeout(1000) })).status < 500) { ready = true; break; } } catch {}
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (!ready) { running.stop(); throw new Error('Python web preview did not become ready.'); }
      server = { url, close: async () => { running.stop(); await Promise.race([running.done.catch(() => {}), new Promise(resolve => setTimeout(resolve, 2500))]); if (running.child?.exitCode == null) running.stop(true); } };
    } else if (info.pkg && info.web && (info.pkg.scripts?.dev || info.pkg.scripts?.start)) {
      const port = await availablePort();
      const script = info.pkg.scripts.dev ? 'dev' : 'start';
      const args = ['run', script];
      if (info.deps.vite) args.push('--', '--host', '127.0.0.1', '--port', String(port), '--strictPort');
      else if (info.deps.next) args.push('--', '--hostname', '127.0.0.1', '--port', String(port));
      const running = await command('npm', args, info.root, { signal, background: true, timeout: 4 * 60 * 60 * 1000,
        env: { HOST: '127.0.0.1', PORT: String(port), BROWSER: 'none' } });
      let exited = false;
      void running.done.finally(() => { exited = true; }).catch(() => {});
      const url = 'http://127.0.0.1:' + port;
      const deadline = Date.now() + 60000;
      let ready = false;
      while (Date.now() < deadline && !exited) {
        signal?.throwIfAborted();
        try { const response = await fetcher(url, { signal: AbortSignal.timeout(1500), redirect: 'manual' }); if (response.status < 500) { ready = true; break; } } catch {}
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (!ready) { running.stop(); throw new Error('The development server did not become ready. Check the dev/start script and PORT support.'); }
      server = { url, close: async () => { running.stop(); await Promise.race([running.done.catch(() => {}), new Promise(r => setTimeout(r, 2500))]); if (running.child?.exitCode == null) running.stop(true); } };
    } else {
      if (!await exists(path.join(info.root, 'index.html'))) throw new Error('No supported web preview entry. Provide index.html or a dev/start script supporting HOST and PORT.');
      server = await staticPreview(info.root);
    }
    if (servers.size >= 3) await stopPreview(servers.keys().next().value);
    servers.set(info.root, server);
    if (open) await openURL(server.url);
    return server;
  }
  async function browserCheck(folder, reportDirectory, signal) {
    const server = await preview(folder, { signal });
    let modulePath = browserModule;
    if (!modulePath) modulePath = (await tool('playwright', 'playwright', signal)).folder;
    let flows = [];
    const flowFile = path.join(folder, '.eden-e2e.json');
    if (await exists(flowFile)) flows = (await readJSON(flowFile)).flows;
    const payload = { url: server.url, modulePath, reportDirectory, flows, executablePath: browserExecutable };
    let result;
    try {
      result = await command('node', [path.join(__dirname, 'browserAudit.js')], folder, { signal, input: JSON.stringify(payload), timeout: 240000 });
    } catch (error) {
      if (!browserModule && /Executable doesn't exist|playwright install/i.test(error.message)) {
        await allow('Install test browser', 'Download Playwright Chromium for local website testing.', { network: true });
        await toolCommand('playwright', 'playwright', ['install', 'chromium'], folder, { signal, timeout: 600000 });
        result = await command('node', [path.join(__dirname, 'browserAudit.js')], folder, { signal, input: JSON.stringify(payload), timeout: 240000 });
      } else throw error;
    }
    const report = JSON.parse(result.output);
    return { ...report, previewUrl: server.url };
  }
  async function verify({ workspace, source, id, signal }) {
    taskID = id; sourceForTask = source;
    const info = await prepare(workspace, { signal });
    const checks = [], images = [];
    const reportDirectory = path.join(reportRoot, id || randomUUID());
    await fs.mkdir(reportDirectory, { recursive: true });
    const check = async (name, perform) => {
      try { const result = await perform(); checks.push({ name, passed: true, output: result.output?.slice(-12000) }); }
      catch (error) { if (signal?.aborted) throw error; checks.push({ name, passed: false, error: error.message.slice(-12000) }); }
    };
    if (info.pkg) {
      for (const name of ['typecheck', 'lint', 'test', 'build']) {
        if (info.pkg.scripts?.[name] && !/^echo\s+["']?Error: no test specified/i.test(info.pkg.scripts[name])) {
          if (/\b(?:electron-builder|electron-forge|vercel|netlify|wrangler|eas\s+(?:build|submit|update)|npm\s+publish|git\s+push)\b|--publish(?:=|\s+)(?!never)/i.test(info.pkg.scripts[name])) {
            checks.push({ name: 'Held release script: ' + name, warning: 'Use an explicit release command and approval.' });
            continue;
          }
          await check('npm run ' + name, () => command('npm', ['run', name], info.root, { signal, timeout: 300000 }));
        }
      }
      if (info.pkg.scripts?.['test:e2e']) await check('Project end-to-end tests', () => command('npm', ['run', 'test:e2e'], info.root, { signal, timeout: 300000 }));
    }
    if (info.kind === 'python') {
      const python = await exists(path.join(info.root, '.venv/bin/python')) ? path.join(info.root, '.venv/bin/python') : await findExecutable('python3');
      await projectPermission(info, ['python -B -m unittest discover -v'], signal);
      const env = await environment();
      await check('Python unit tests', async () => {
        const result = await runner(python, ['-B', '-m', 'unittest', 'discover', '-v'], { cwd: info.root, env, signal, timeout: 180000 });
        if (/Ran 0 tests\b/.test(result.output + result.errors)) throw new Error('No Python tests were discovered. Add runnable tests.');
        return result;
      });
    }
    if (info.kind === 'maven') {
      await projectPermission(info, ['mvn -B test'], signal);
      await check('Maven tests', () => command('mvn', ['-B', 'test'], info.root, { signal, timeout: 600000 }));
    }
    if (info.kind === 'java') {
      const files = info.entries.filter(name => name.endsWith('.java'));
      await projectPermission(info, ['javac ' + files.join(' ')], signal);
      await check('Java compilation (not runtime tests)', () => command('javac', files, info.root, { signal }));
    }
    if (info.kind === 'godot') {
      checks.push({ name: 'Game asset-origin inventory', passed: await exists(path.join(info.root, 'ASSET-LICENSES.md')),
        error: 'Add ASSET-LICENSES.md describing the origin and usage terms of supplied or generated assets.' });
      await projectPermission(info, ['godot --headless --editor --import --quit'], signal);
      await check('Godot resource/script import (not gameplay coverage)', async () => {
        const result = await command('godot', ['--headless', '--path', info.root, '--editor', '--import', '--quit'], info.root, { signal });
        if (/SCRIPT ERROR:|Parse Error:/i.test(result.output + result.errors)) throw new Error(result.output + result.errors);
        return result;
      });
      if (await exists(path.join(info.root, 'tests/run_tests.gd'))) await check('Godot project tests', () => command('godot', ['--headless', '--path', info.root, '--script', 'res://tests/run_tests.gd'], info.root, { signal }));
    }
    let previewUrl;
    if (info.web) {
      try {
        const browser = await browserCheck(info.root, reportDirectory, signal);
        checks.push(...browser.results); images.push(...browser.screenshots); previewUrl = browser.previewUrl;
        if (!browser.flowCount && !info.pkg?.scripts?.['test:e2e']) {
          checks.push({ name: 'Feature-specific browser flows', passed: false, error: 'Add .eden-e2e.json with flows covering the requested interactions. Browser smoke checks alone do not verify features.' });
        }
      } catch (error) { if (signal?.aborted) throw error; checks.push({ name: 'Browser checks', passed: false, error: error.message.slice(-12000) }); }
    }
    if (!checks.some(check => check.passed === true)) checks.push({ name: 'Project-specific checks', passed: false, error: 'No supported successful test/build entry point found. Add a suitable test or supported project configuration.' });
    const report = { passed: checks.every(item => item.passed !== false), checks, images, previewUrl, reportDirectory, web: info.web };
    await fs.writeFile(path.join(reportDirectory, 'verification.json'), JSON.stringify(report, null, 2));
    return report;
  }

  async function requirements(folder) {
    const info = await detect(folder);
    const names = ['node', 'npm', 'python3', 'java', 'javac', 'mvn', 'godot', 'xcodebuild', 'codesign', 'xcrun'];
    const tools = [];
    for (const name of names) {
      try { tools.push(name + ': ' + await findExecutable(name, name === 'godot' ? ['/Applications/Godot.app/Contents/MacOS/Godot'] : [])); }
      catch { tools.push(name + ': not installed'); }
    }
    return 'Project type: ' + info.kind + '\n' + tools.join('\n') +
      '\n\nWeb publishing: Vercel login and a linked .vercel/project.json are required.' +
      '\nDesktop signing: a valid Developer ID certificate in Keychain; notarization uses the EDEN-NOTARY keychain profile.' +
      '\nMobile: Expo project, eas.json, provider login, developer accounts and configured credentials. Store review is separate from upload.' +
      '\nGodot export: installed export templates and export_presets.cfg are required.';
  }
  async function terminalTool(packageName, binName, args, folder, signal) {
    if (!openTerminal) throw new Error('Terminal account setup is unavailable.');
    const executable = await tool(packageName, binName, signal);
    const node = await findExecutable('node');
    signal?.throwIfAborted();
    await openTerminal(node, [executable.entry, ...args], folder);
  }
  async function connectPublishing(folder, signal) {
    await allow('Connect Vercel', 'Open Terminal to sign into Vercel and link this project. This does not deploy it. Project: ' + folder, { network: true });
    await terminalTool('vercel', 'vercel', ['login'], folder, signal);
    return 'Complete Vercel sign-in in Terminal. Then tell me “link this project to Vercel”.';
  }
  async function linkPublishing(folder, signal) {
    await allow('Link Vercel project', 'Open Vercel’s project/account selection in Terminal for: ' + folder, { network: true });
    await terminalTool('vercel', 'vercel', ['link'], folder, signal);
    return 'Choose the correct Vercel account and project in Terminal. Then ask me to publish the website.';
  }
  async function publish(folder, { production = false, signal } = {}) {
    const info = await detect(folder);
    if (!info.web) throw new Error('Vercel publishing supports a web project here. Mobile, desktop and Godot projects use their release commands.');
    const link = path.join(folder, '.vercel/project.json');
    if (!await exists(link)) throw new Error('Connect and link this project to Vercel first.');
    const account = await readJSON(link);
    if (!account.projectId || !account.orgId) throw new Error('Vercel project link is incomplete.');
    const report = await verify({ workspace: folder, source: folder, id: 'publish-' + Date.now(), signal });
    if (!report.passed) throw new Error('Publishing blocked by failed checks. ' + report.checks.filter(c => c.passed === false).map(c => c.name + ': ' + (c.error || '')).join('\n'));
    await allow(production ? 'Publish production website' : 'Create hosted preview',
      'Upload this project’s source to Vercel.\nProject: ' + folder + '\nVercel project: ' + account.projectId + '\nAccount/team: ' + account.orgId +
      '\nEnvironment: ' + (production ? 'PRODUCTION (public live site)' : 'hosted preview') + '\nHosting usage may incur provider charges. Review the local preview first. No domain purchase is included.', { network: true });
    const upload = path.join(storage, 'publish', randomUUID());
    await fs.mkdir(upload, { recursive: true });
    const ignored = name => name.startsWith('.') || /^(?:node_modules|dist|build|coverage|tests|__pycache__|venv|exports|target)$/.test(name) || /\.(?:pem|key|p12|pfx)$/i.test(name) || /(?:secret|credential|service.?account|private.?key)/i.test(name) || /^auth\.json$/i.test(name);
    async function copy(source, target) {
      for (const entry of await fs.readdir(source, { withFileTypes: true })) {
        if (ignored(entry.name)) continue;
        const from = path.join(source, entry.name), to = path.join(target, entry.name);
        if ((await fs.lstat(from)).isSymbolicLink()) throw new Error('Publishing refuses symlinks: ' + from);
        if (entry.isDirectory()) { await fs.mkdir(to, { recursive: true }); await copy(from, to); }
        else if (entry.isFile()) {
          if ((await fs.stat(from)).size < 2 * 1024 * 1024) {
            const text = await fs.readFile(from, 'utf8');
            if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{24,}/.test(text)) throw new Error('Possible embedded credential; review before publishing: ' + from);
          }
          await fs.copyFile(from, to);
        }
      }
    }
    await copy(folder, upload);
    await fs.mkdir(path.join(upload, '.vercel'));
    await fs.copyFile(link, path.join(upload, '.vercel/project.json'));
    const result = await toolCommand('vercel', 'vercel', ['deploy', '--yes', ...(production ? ['--prod'] : [])], upload, { signal, timeout: 1200000 });
    const urls = result.output.match(/https:\/\/[a-z0-9][a-z0-9.-]*\.vercel\.app\b/gi);
    const url = urls?.at(-1);
    if (!url) throw new Error('Vercel completed without returning a verifiable deployment URL. Inspect its provider dashboard.');
    let status = 'not checked';
    try { status = String((await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) })).status); } catch {}
    await fs.writeFile(path.join(storage, 'latest-deployment.json'), JSON.stringify({ url, production, folder, status, at: new Date().toISOString() }, null, 2));
    await openURL(url);
    return 'Vercel returned this deployment URL: ' + url + '\nHTTP status: ' + status +
      (status === '401' || status === '403' ? '\nDeployment protection requires the appropriate Vercel access.' : '') + '\nThis does not verify every production feature or database connection.';
  }

  async function installer(folder, { signed = false, signal } = {}) {
    if (platform !== 'darwin') throw new Error('This adapter builds macOS installers on a Mac.');
    const info = await prepare(folder, { signal });
    if (info.kind !== 'electron' || !info.deps['electron-builder']) throw new Error('Add electron-builder and a build configuration to this Electron project first.');
    const report = await verify({ workspace: folder, source: folder, id: 'installer-' + Date.now(), signal });
    if (!report.passed) throw new Error('Installer build blocked by failed project checks. Inspect ' + report.reportDirectory);
    const certificates = signed ? await command('security', ['find-identity', '-v', '-p', 'codesigning'], folder, { signal }) : null;
    const identities = certificates ? [...certificates.output.matchAll(/"(Developer ID Application:[^"]+)"/g)].map(match => match[1]) : [];
    if (signed && !identities.length) throw new Error('No Developer ID Application certificate was found in Keychain. Configure your Apple developer certificate first.');
    const identity = signed ? await chooseOption('Choose signing certificate', identities) : null;
    if (signed && !identity) throw new Error('Signing cancelled.');
    await allow(signed ? 'Build signed macOS installer' : 'Build unsigned macOS installer',
      'Project: ' + folder + '\nRun electron-builder to create a DMG.\n' + (signed ? 'Signing identity: ' + identity : 'Unsigned output is for local testing; macOS may block distribution.') +
      '\nProject build hooks execute on your Mac; downloads may occur. Publishing is disabled.', { network: true });
    const builder = await readJSON(path.join(folder, 'node_modules/electron-builder/package.json'));
    const signingKey = Number(builder.version.split('.')[0]) >= 27 ? 'mac.sign.identity' : 'mac.identity';
    await command('npm', ['exec', '--offline', '--', 'electron-builder', '--mac', 'dmg', '--publish', 'never',
      '-c.mac.notarize=false', '-c.' + signingKey + '=' + (signed ? identity : 'null'),
      '-c.forceCodeSigning=' + (signed ? 'true' : 'false')], folder, { signal, timeout: 1200000, env: signed ? { CSC_NAME: identity } : { CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
    const output = path.resolve(folder, info.pkg.build?.directories?.output || 'dist');
    if (!output.startsWith(path.resolve(folder) + path.sep)) throw new Error('Installer output is outside the project; inspect it manually.');
    const artifacts = (await fs.readdir(output)).filter(name => name.endsWith('.dmg'));
    if (!artifacts.length) throw new Error('No DMG artifact was found after the build.');
    return 'Installer artifacts:\n' + artifacts.map(name => path.join(output, name)).join('\n') + '\n' + (signed ? 'Code signing was required by the build. Notarize separately before distribution.' : 'These builds are unsigned.');
  }
  async function notarize(folder, signal) {
    const file = await chooseArtifact('Choose the signed DMG or ZIP to notarize', ['dmg', 'zip', 'pkg']);
    if (!file) return 'Notarization cancelled.';
    await allow('Submit for Apple notarization', 'Upload this signed artifact to Apple: ' + file + '\nUse the preconfigured EDEN-NOTARY Keychain profile. This submits software to Apple.', { network: true });
    const result = await command('xcrun', ['notarytool', 'submit', file, '--keychain-profile', 'EDEN-NOTARY', '--wait', '--output-format', 'json'], folder, { signal, timeout: 1200000 });
    const receipt = JSON.parse(result.output);
    if (receipt.status !== 'Accepted') throw new Error('Apple did not accept notarization: ' + JSON.stringify(receipt));
    if (/\.(?:dmg|pkg)$/i.test(file)) await command('xcrun', ['stapler', 'staple', file], folder, { signal });
    return 'Apple accepted notarization. The ticket was stapled when supported. Validate the signed artifact before distributing it.';
  }
  async function mobile(folder, platformName, submit = false, signal) {
    const info = await detect(folder);
    if (info.kind !== 'expo' || !await exists(path.join(folder, 'eas.json'))) throw new Error('Mobile release requires an Expo project with eas.json and configured build/submit profiles.');
    const profiles = await readJSON(path.join(folder, 'eas.json'));
    if (!profiles[submit ? 'submit' : 'build']?.production) throw new Error('Configure the production ' + (submit ? 'submit' : 'build') + ' profile in eas.json first.');
    if (!submit) {
      const report = await verify({ workspace: folder, source: folder, id: 'mobile-' + Date.now(), signal });
      if (!report.passed) throw new Error('Mobile build blocked by failed project checks. Inspect ' + report.reportDirectory);
      await allow('Build mobile release', 'Project: ' + folder + '\nPlatform: ' + platformName + '\nRun an EAS production cloud build. An Expo login and configured signing credentials are required; provider charges may apply.', { network: true });
      const result = await toolCommand('eas-cli', 'eas', ['build', '--platform', platformName, '--profile', 'production', '--non-interactive', '--wait', '--json'], folder, { signal, timeout: 3600000,
        env: { EAS_NO_VCS: '1', EAS_PROJECT_ROOT: folder } });
      let data;
      try { data = JSON.parse(result.output); } catch { throw new Error('EAS finished without a machine-readable build result. Inspect the Expo dashboard.'); }
      const builds = Array.isArray(data) ? data : [data];
      if (!builds.length || builds.some(build => build.status !== 'FINISHED')) throw new Error('EAS did not report a finished build: ' + JSON.stringify(data).slice(0, 4000));
      await fs.writeFile(path.join(storage, 'latest-mobile-build.json'), JSON.stringify(data, null, 2));
      return 'EAS build command completed. Provider result:\n' + JSON.stringify(data, null, 2).slice(0, 10000);
    }
    const file = await chooseArtifact('Choose the exact signed artifact to submit', platformName === 'ios' ? ['ipa'] : ['aab']);
    if (!file) return 'Store submission cancelled.';
    await allow('Submit app to store', 'Submit this artifact: ' + file + '\nPlatform: ' + platformName + '\nUse the configured production submit profile. Developer accounts, listing metadata and signing must already be configured. Upload is not approval or public release.', { network: true });
    const result = await toolCommand('eas-cli', 'eas', ['submit', '--platform', platformName, '--profile', 'production', '--path', file, '--non-interactive', '--wait'], folder, { signal, timeout: 1200000,
      env: { EAS_NO_VCS: '1', EAS_PROJECT_ROOT: folder } });
    return 'Store submission command completed:\n' + result.output.slice(-8000) + '\nStore processing/review and release remain separate.';
  }
  async function exportGame(folder, signal) {
    const info = await detect(folder);
    if (info.kind !== 'godot' || !await exists(path.join(folder, 'export_presets.cfg'))) throw new Error('Select a Godot project with export_presets.cfg and installed export templates.');
    const report = await verify({ workspace: folder, source: folder, id: 'game-export-' + Date.now(), signal });
    if (!report.passed) throw new Error('Game export blocked by failed project checks. Inspect ' + report.reportDirectory);
    const text = await fs.readFile(path.join(folder, 'export_presets.cfg'), 'utf8');
    const presets = [...text.matchAll(/^name="([^"]+)"/gm)].map(match => match[1]);
    const preset = await chooseOption('Choose Godot export preset', presets);
    if (!preset) return 'Game export cancelled.';
    const block = text.split(/\[preset\.\d+\]/).find(section => section.includes('name="' + preset + '"')) || '';
    const enginePlatform = block.match(/^platform="([^"]+)"/m)?.[1] || preset;
    const output = path.join(folder, 'exports', 'game' + (/web/i.test(enginePlatform) ? '.html' : /windows/i.test(enginePlatform) ? '.exe' : /android/i.test(enginePlatform) ? '.apk' : /mac|ios/i.test(enginePlatform) ? '.zip' : '.x86_64'));
    await allow('Export game', 'Project: ' + folder + '\nPreset: ' + preset + '\nOutput: ' + output + '\nExport hooks execute project code. Assets must have appropriate usage rights.');
    await fs.mkdir(path.dirname(output), { recursive: true });
    await command('godot', ['--headless', '--path', folder, '--export-release', preset, output], folder, { signal, timeout: 600000 });
    if (!(await fs.stat(output)).size) throw new Error('Godot did not produce the expected export artifact.');
    return 'Godot export completed: ' + output;
  }
  async function handle(text, project, { codingBusy = false } = {}) {
    const input = String(text).trim().replace(/^(?:please|can you|could you)\s+/i, '').replace(/[.!?]+$/, '');
    const patterns = [
      ['preview', /^(?:preview|run|show|open)(?: me)? (?:the |my |this )?(?:website|web app|webapp)(?: locally)?$/i],
      ['verify', /^(?:test|verify|run tests for|run end.to.end tests for) (?:the |my |this )?(?:website|web app|project)$/i],
      ['prepare', /^(?:install|set up|setup) (?:the |my |this )?(?:project )?dependencies$/i],
      ['requirements', /^(?:check|show) (?:the |my )?(?:development tools|release requirements|build requirements)$/i],
      ['connect', /^(?:connect|set up|setup) (?:website publishing|publishing|hosting|vercel)$/i],
      ['link', /^link (?:the |my |this )?project to vercel$/i],
      ['publish', /^(?:publish|deploy) (?:the |my |this )?(?:website|web app|project|it)(?: live| to production)?$|^make (?:the |my |this )?(?:website|web app|it) live$/i],
      ['hosted-preview', /^(?:create|deploy) (?:a )?hosted preview$/i],
      ['installer', /^(?:build|create|package) (?:an? |the |my )?(?:macos |mac )?installer$/i],
      ['signed-installer', /^(?:build|create) (?:a |the |my )?signed (?:macos |mac )?installer$/i],
      ['notarize', /^notarize (?:the |my )?(?:app|installer)$/i],
      ['mobile', /^build (?:the |my |this )?(ios|android) (?:app|release|build)$/i],
      ['submit', /^submit (?:the |my |this )?(ios|android) app(?: to (?:the )?(?:app store|play store))?$/i],
      ['mobile-login', /^(?:connect|sign in to) expo$/i],
      ['production-env', /^(?:configure|set up|setup) (?:production|hosting) environment(?: variables)?$/i],
      ['notary-setup', /^(?:set up|setup|configure) notarization$/i],
      ['mobile-credentials', /^(?:set up|setup|configure) (ios|android) (?:signing|credentials)$/i],
      ['install-godot', /^(?:install|set up|setup) godot$/i],
      ['game-export', /^export (?:the |my |this )?game$/i],
      ['game-run', /^(?:run|play) (?:the |my |this )?game$/i]
    ];
    const found = patterns.map(([action, regex]) => ({ action, match: input.match(regex) })).find(item => item.match);
    if (!found) return null;
    if (!project && !['install-godot'].includes(found.action)) return 'Select a project first by saying “choose coding project”.';
    if (operations || codingBusy) return 'A coding or project-tool operation is already running. Wait for it to finish, or say “stop coding”.';
    if (found.action === 'requirements') return requirements(project);
    operations = true; sourceForTask = null; taskID = null;
    operationController = new AbortController();
    const signal = operationController.signal;
    const perform = async () => {
      const { action, match } = found;
      if (action === 'connect') return connectPublishing(project, signal);
      if (action === 'link') return linkPublishing(project, signal);
      if (action === 'preview') return 'Local preview: ' + (await preview(project, { open: true, signal })).url;
      if (action === 'prepare') { await prepare(project, { signal }); return 'Supported project dependencies are prepared.'; }
      if (action === 'verify') { const report = await verify({ workspace: project, source: project, id: 'manual-' + Date.now(), signal }); return (report.passed ? 'Configured checks passed.' : 'Some checks failed.') + '\n' + JSON.stringify(report, null, 2).slice(0, 16000); }
      if (action === 'publish' || action === 'hosted-preview') return publish(project, { production: action === 'publish', signal });
      if (action === 'installer' || action === 'signed-installer') return installer(project, { signed: action === 'signed-installer', signal });
      if (action === 'notarize') return notarize(project, signal);
      if (action === 'mobile' || action === 'submit') return mobile(project, match[1].toLowerCase(), action === 'submit', signal);
      if (action === 'mobile-login') { await allow('Connect Expo', 'Open Terminal for Expo account sign-in.', { network: true }); await terminalTool('eas-cli', 'eas', ['login'], project, signal); return 'Finish Expo sign-in in Terminal, then configure this project’s EAS build and submit profiles.'; }
      if (action === 'production-env') { await allow('Configure hosting environment', 'Open Vercel’s environment-variable setup in Terminal for this project. Enter secret values only in that provider flow.', { network: true }); await terminalTool('vercel', 'vercel', ['env', 'add'], project, signal); return 'Complete the environment-variable setup in Terminal. Repeat for additional variables, then publish again.'; }
      if (action === 'mobile-credentials') { await allow('Configure mobile signing', 'Open the EAS credential manager for ' + match[1] + '. Complete developer-account authentication directly in Terminal.', { network: true }); await terminalTool('eas-cli', 'eas', ['credentials', '--platform', match[1].toLowerCase()], project, signal); return 'Complete the signing setup in Terminal. Credentials are not requested through EDEN’s chat.'; }
      if (action === 'notary-setup') {
        await allow('Configure Apple notarization', 'Open Apple’s notarytool in Terminal to store the EDEN-NOTARY Keychain profile. Enter account credentials only in that native flow.', { network: true });
        if (!openTerminal) throw new Error('Terminal integration unavailable.');
        await openTerminal(await findExecutable('xcrun'), ['notarytool', 'store-credentials', 'EDEN-NOTARY'], project);
        return 'Complete the EDEN-NOTARY profile setup in Terminal.';
      }
      if (action === 'install-godot') {
        const brew = await findExecutable('brew', ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']);
        await allow('Install Godot game engine', 'Run Homebrew to install the Godot application on this Mac. This downloads and installs software.', { network: true });
        await runner(brew, ['install', '--cask', 'godot'], { cwd: project || os.homedir(), env: await environment(), signal, timeout: 1200000 });
        return 'Godot installation command completed. Export templates and project export presets must be configured before exporting a game.';
      }
      if (action === 'game-export') return exportGame(project, signal);
      if (action === 'game-run') {
        await allow('Run game', 'Run this Godot project on your Mac: ' + project);
        const running = await command('godot', ['--path', project], project, { background: true, timeout: 4 * 60 * 60 * 1000 });
        games.add(running); void running.done.finally(() => games.delete(running)).catch(() => {});
        return 'The Godot process was started. Check the game window for startup errors.';
      }
      throw new Error('Unsupported project operation.');
    };
    void (async () => {
      try {
        const reply = await perform();
        await deliver({ reply, spoken: 'The project operation has finished. I’ve put the result in our conversation.', folder: project });
      } catch (error) {
        await deliver({ reply: 'I couldn’t complete the project operation. ' + error.message,
          spoken: 'The project operation needs attention. I’ve put the details in our conversation.' });
      } finally { operations = false; operationController = null; }
    })().catch(() => {});
    return 'I’m handling that project operation in the background. I’ll ask for any required installation or release approval and report the result here.';
  }
  function stop() { operationController?.abort(); }
  async function prepareTask(context) {
    taskID = context.id; sourceForTask = context.source;
    const info = await prepare(context.workspace, { signal: context.signal });
    const env = await environment();
    if (await exists(path.join(context.workspace, '.venv/bin/python'))) {
      env.VIRTUAL_ENV = path.join(context.workspace, '.venv');
      env.PATH = path.join(context.workspace, '.venv/bin') + path.delimiter + env.PATH;
    }
    return { ...info, executionEnvironment: env };
  }
  async function afterApply(folder, validation) {
    operations = true; operationController = new AbortController();
    try {
      await prepare(folder, { signal: operationController.signal });
      if (validation?.previewUrl) await openURL(validation.previewUrl);
    } finally { operations = false; operationController = null; }
  }
  async function close() { stop(); for (const running of games) running.stop(true); await Promise.all([...servers.keys()].map(root => stopPreview(root))); }
  return { detect, prepare, prepareTask, afterApply, preview, verify, handle, close, stop, requirements, publish };
}

module.exports = { createProjectTools, execute, findExecutable };
