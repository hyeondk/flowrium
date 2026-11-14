const path = require('node:path');

// macOS 파일 시스템에서 같은 한글 경로를 Node와 Electron이 서로 다른
// 유니코드 조합으로 반환할 수 있다. 파일을 옮기거나 이름을 바꾸지 않고
// 경계 비교만 정규화한다. 다른 운영체제의 구별되는 파일명은 그대로 둔다.
function pathForComparison(value, platform = process.platform) {
  const absolute = path.resolve(value);
  return platform === 'darwin' ? absolute.normalize('NFC') : absolute;
}
function relativePath(from, to, platform = process.platform) {
  return path.relative(pathForComparison(from, platform), pathForComparison(to, platform));
}
function samePath(first, second, platform = process.platform) {
  return relativePath(first, second, platform) === '';
}

module.exports = { relativePath, samePath };
