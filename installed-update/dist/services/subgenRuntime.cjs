'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function modelsRoot(app) {
  return process.env.MLA_SUBGEN_MODELS_DIR?.trim() || path.join(app.getPath('userData'), 'subgen-models');
}
function scriptPath(app) {
  const source = path.join(app.getAppPath(), 'resources', 'subgen', 'generate_subtitles.py');
  const directory = path.join(app.getPath('userData'), 'subgen-tools');
  const target = path.join(directory, 'generate_subtitles.py');
  const content = fs.readFileSync(source);
  fs.mkdirSync(directory, { recursive: true });
  if (!fs.existsSync(target) || !fs.readFileSync(target).equals(content)) fs.writeFileSync(target, content);
  return target;
}
function requirementsPath(app) {
  const target = path.join(path.dirname(scriptPath(app)), 'requirements.txt');
  const content = fs.readFileSync(path.join(app.getAppPath(), 'resources', 'subgen', 'requirements.txt'));
  if (!fs.existsSync(target) || !fs.readFileSync(target).equals(content)) fs.writeFileSync(target, content);
  return target;
}
function pythonPath(app) {
  const candidates = [
    process.env.MLA_SUBGEN_PYTHON,
    path.join(app.getPath('userData'), 'subgen-runtime', 'Scripts', 'python.exe'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'medialibrary-plus', 'subgen-runtime', 'Scripts', 'python.exe')
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}
function spawnPython(app, args, options = {}) {
  const directory = path.dirname(args[0]);
  return spawn(pythonPath(app), args, {
    ...options,
    cwd: directory,
    windowsHide: true,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONNOUSERSITE: '1', ...(args[1] === 'generate' ? { HF_HUB_OFFLINE: '1' } : {}) }
  });
}
function checkModel(app, model) {
  if (!['small', 'medium', 'large-v3'].includes(model)) throw new Error('Unsupported Whisper model.');
  const directory = path.join(modelsRoot(app), model);
  const required = ['.mla-ready.json', 'config.json', 'model.bin', 'tokenizer.json'];
  const available = required.every(file => {
    try { const stat = fs.statSync(path.join(directory, file)); return stat.isFile() && stat.size > 0; } catch { return false; }
  });
  return { model, available, modelPath: available ? directory : null, message: available ? null : `${model} is not downloaded yet.` };
}
module.exports = { modelsRoot, scriptPath, requirementsPath, pythonPath, spawnPython, checkModel };
