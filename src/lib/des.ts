// des.ts — 纯 TS 实现 DES-ECB + PKCS7 padding + Base64。
// Web Crypto API 不支持 DES，这里手写以对齐 Go 的 crypto/des(ECB) + encrypto()。
// 已用 Go 参考向量逐字节校验（见 test/des.test.mjs）。

const IP: number[] = [
  58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4,
  62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
  61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
];

const FP: number[] = [
  40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31,
  38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
  36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27,
  34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25,
];

const E: number[] = [
  32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11,
  12, 13, 12, 13, 14, 15, 16, 17, 16, 17, 18, 19, 20, 21, 20, 21,
  22, 23, 24, 25, 24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1,
];

const P: number[] = [
  16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10,
  2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25,
];

const PC1: number[] = [
  57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18,
  10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36,
  63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22,
  14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4,
];

const PC2: number[] = [
  14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10,
  23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2,
  41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48,
  44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32,
];

const SHIFTS: number[] = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];

const SBOX: number[][] = [
  [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7,
    0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
    4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0,
    15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
  [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10,
    3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5,
    0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15,
    13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
  [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8,
    13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
    13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7,
    1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
  [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15,
    13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
    10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4,
    3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
  [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9,
    14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
    4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14,
    11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
  [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11,
    10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
    9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6,
    4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
  [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1,
    13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
    1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2,
    6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
  [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7,
    1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
    7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8,
    2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
];

// bytes -> bit array (MSB first)
function bytesToBits(bytes: Uint8Array): number[] {
  const bits: number[] = new Array(bytes.length * 8);
  for (let i = 0; i < bytes.length; i++) {
    for (let j = 0; j < 8; j++) {
      bits[i * 8 + j] = (bytes[i]! >> (7 - j)) & 1;
    }
  }
  return bits;
}

function bitsToBytes(bits: number[]): Uint8Array {
  const out = new Uint8Array(bits.length / 8);
  for (let i = 0; i < out.length; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | bits[i * 8 + j]!;
    }
    out[i] = b;
  }
  return out;
}

// table 为 1-indexed
function permute(src: number[], table: number[]): number[] {
  const out: number[] = new Array(table.length);
  for (let i = 0; i < table.length; i++) {
    out[i] = src[table[i]! - 1]!;
  }
  return out;
}

function leftRotate(arr: number[], n: number): number[] {
  return arr.slice(n).concat(arr.slice(0, n));
}

function buildSubKeys(keyBytes: Uint8Array): number[][] {
  const keyBits = bytesToBits(keyBytes); // 64
  const permuted = permute(keyBits, PC1); // 56
  let c = permuted.slice(0, 28);
  let d = permuted.slice(28, 56);
  const subKeys: number[][] = [];
  for (let round = 0; round < 16; round++) {
    c = leftRotate(c, SHIFTS[round]!);
    d = leftRotate(d, SHIFTS[round]!);
    subKeys.push(permute(c.concat(d), PC2)); // 48
  }
  return subKeys;
}

function feistel(rBits: number[], subKey: number[]): number[] {
  const expanded = permute(rBits, E); // 48
  const xored: number[] = new Array(48);
  for (let i = 0; i < 48; i++) xored[i] = expanded[i]! ^ subKey[i]!;

  const sOut: number[] = new Array(32);
  for (let box = 0; box < 8; box++) {
    const off = box * 6;
    const b0 = xored[off]!, b1 = xored[off + 1]!, b2 = xored[off + 2]!;
    const b3 = xored[off + 3]!, b4 = xored[off + 4]!, b5 = xored[off + 5]!;
    const row = (b0 << 1) | b5;
    const col = (b1 << 3) | (b2 << 2) | (b3 << 1) | b4;
    const val = SBOX[box]![row * 16 + col]!;
    const o = box * 4;
    sOut[o] = (val >> 3) & 1;
    sOut[o + 1] = (val >> 2) & 1;
    sOut[o + 2] = (val >> 1) & 1;
    sOut[o + 3] = val & 1;
  }
  return permute(sOut, P); // 32
}

function encryptBlock(blockBits: number[], subKeys: number[][]): number[] {
  const permuted = permute(blockBits, IP); // 64
  let l = permuted.slice(0, 32);
  let r = permuted.slice(32, 64);
  for (let round = 0; round < 16; round++) {
    const f = feistel(r, subKeys[round]!);
    const newR: number[] = new Array(32);
    for (let i = 0; i < 32; i++) newR[i] = l[i]! ^ f[i]!;
    l = r;
    r = newR;
  }
  return permute(r.concat(l), FP); // preoutput R||L 后 FP
}

function pkcs7Pad(bytes: Uint8Array, blockSize: number): Uint8Array {
  let pad = blockSize - (bytes.length % blockSize);
  if (pad === 0) pad = blockSize;
  const out = new Uint8Array(bytes.length + pad);
  out.set(bytes, 0);
  out.fill(pad, bytes.length);
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function base64Encode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i]! << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (rem === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}

// DES-ECB 加密 + PKCS7 填充。
export function desEcbEncrypt(plainBytes: Uint8Array, keyBytes: Uint8Array): Uint8Array {
  const padded = pkcs7Pad(plainBytes, 8);
  const subKeys = buildSubKeys(keyBytes);
  const out = new Uint8Array(padded.length);
  for (let off = 0; off < padded.length; off += 8) {
    const blockBits = bytesToBits(padded.subarray(off, off + 8));
    const cipherBits = encryptBlock(blockBits, subKeys);
    out.set(bitsToBytes(cipherBits), off);
  }
  return out;
}

const DES_KEY = new TextEncoder().encode('12345678');

// encrypto(jsonString) -> base64(DES-ECB(pkcs7(utf8(jsonString)), "12345678"))，对齐 main.go。
export function encrypto(plainString: string): string {
  const plainBytes = new TextEncoder().encode(plainString);
  const cipher = desEcbEncrypt(plainBytes, DES_KEY);
  return base64Encode(cipher);
}
