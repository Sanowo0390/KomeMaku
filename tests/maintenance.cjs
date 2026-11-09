'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

const manifest=require('../manifest.json');
assert.equal(manifest.manifest_version,3);
assert.match(manifest.version,/^\d+\.\d+\.\d+$/,'Version is a semantic three-part version');

const readme=read('README.md');
assert.match(readme,/^# KomeMaku\s*$/m,'README is an overview instead of a version history');
assert.doesNotMatch(readme,/^##\s*v\d+\.\d+\.\d+/m,'README must not be a release-by-release changelog');
for(const section of ['主な機能','インストール','設定方法','YCS Continuedとの連携','動作とプライバシーに関する注意','開発とテスト','ライセンス']){
  assert.ok(readme.includes('## '+section),'README missing '+section);
}

const workflow=read('.github/workflows/build.yml');
assert.match(workflow,/permissions:\s*\n\s*contents: read/,'Build requires no write permission');
assert.doesNotMatch(workflow,/git\s+(?:push|commit)/,'Build must not commit into the main branch');
assert.match(workflow,/python scripts\/render-icons\.py/,'Generate icons from SVG');
assert.match(workflow,/path: dist\//,'Upload the extracted extension directory, not a ZIP inside a ZIP');

const contentScript=read('content.js');
assert.match(contentScript,/function replaceRendererCanvas\(\)\s*\{/);
assert.equal((contentScript.match(/replaceRendererCanvas\(\)/g)||[]).length,3,
  'Failed WebGL initialization and manual engine switching must share the canvas replacement helper');

console.log('PASS: README stays concise, version checks are centralized, Actions is read-only, renderer canvas replacement is shared');
