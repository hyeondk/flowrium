const test = require('node:test');
const assert = require('node:assert/strict');
const { windowsProjectSandbox } = require('../electron/windows-project-sandbox.cjs');
const client = (config, origins = {}, requirements = null) => ({
  request: async method => method === 'config/read' ? { config, origins } : { requirements },
});

test('Windows 첫 실행용 파일 보호 선택은 제품 대화에만 전달한다', async () => {
  assert.deepEqual(await windowsProjectSandbox(client({}), 'C:\\work', 'win32'),
    { 'features.prefer_mxc': true, 'windows.sandbox': 'unelevated' });
  for (const config of [{ windows: { sandbox: 'elevated' } }, { windows: { sandbox: 'mxc' } },
    { windows: { sandbox: 'unelevated' } }, { features: { prefer_mxc: false } }]) {
    assert.equal(await windowsProjectSandbox(client(config), 'C:\\work', 'win32'), undefined);
  }
  for (const key of ['windows.allow_mxc', 'permissions.restricted', 'default_permissions']) {
    assert.equal(await windowsProjectSandbox(client({}, { [key]: {} }), 'C:\\work', 'win32'), undefined);
  }
  assert.equal(await windowsProjectSandbox(client({}, {}, { allowedWindowsSandboxImplementations: ['elevated'] }), 'C:\\work', 'win32'), undefined);
  assert.equal(await windowsProjectSandbox({ request: async () => {throw Error('unsupported');} }, 'C:\\work', 'win32'), undefined);
  await windowsProjectSandbox({ request: () => assert.fail('다른 운영체제에서 Windows 설정을 요청했습니다.') }, '/work', 'darwin');
});
