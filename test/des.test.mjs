// DES 正确性回归测试：与 Go crypto/des(ECB)+PKCS7 的参考向量逐字节比对。
// 测试编译后的产物 dist/lib/des.js（先 npm run build）。
// 运行：node test/des.test.mjs
import { encrypto } from '../dist/lib/des.js';

// 参考值由 Go 的 encrypto() 生成（key="12345678"）。
const VECTORS = [
  ['', '/rlZt9RkL8s='],
  ['a', 'LxUY5YQ/D2k='],
  ['12345678', 'ltACiHjVjIn+uVm31GQvyw=='],
  ['hello world', 'KNugLrX23UddguNoHIO7dw=='],
  ['中文测试UTF-8编码', 'qmfESw+wOOsJjPmBX8UK8Z+FdGJggsqs'],
];

let pass = 0;
for (const [input, expect] of VECTORS) {
  const got = encrypto(input);
  const ok = got === expect;
  console.log(`${ok ? '✅' : '❌'} encrypto(${JSON.stringify(input)}) = ${got}`);
  if (!ok) { console.log(`   期望: ${expect}`); process.exitCode = 1; } else pass++;
}
console.log(`\n${pass}/${VECTORS.length} 通过`);
