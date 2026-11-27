const fs = require('node:fs/promises');
const path = require('node:path');

async function qrDecoderSource() {
  const folder=path.dirname(require.resolve('jsqr/package.json'));
  const [license,script]=await Promise.all([
    fs.readFile(path.join(folder,'LICENSE'),'utf8'),
    fs.readFile(path.join(folder,'dist','jsQR.js'),'utf8'),
  ]);
  return '/* jsQR / Copyright 2018 jsQR contributors\n'+license+'\n*/\n'+script;
}

module.exports={qrDecoderSource};
