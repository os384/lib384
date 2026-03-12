const base32mi = "0123456789ADMRTxQjrEywcLBdHpNufk" // "v05.05" (strongpinVersion ^0.6.0)
const base62Regex = new RegExp(`[${base32mi}.concat(' ')]`); // lenient, allows spaces

// encodes a 19-bit number into a 4-character string
export function b32encode(num: number): string {
  const charMap = base32mi;
  if (num < 0 || num > 0x7ffff)
    throw new Error('Input number is out of range. Expected a 19-bit integer.');
  let bitsArr15 = [
    (num >> 14) & 0x1f,
    (num >> 9) & 0x1f,
    (num >> 4) & 0x1f,
    (num) & 0x0f
  ];
  bitsArr15[3] |= (bitsArr15[0] ^ bitsArr15[1] ^ bitsArr15[2]) & 0x10;
  return bitsArr15.map(val => charMap[val]).join('');
}

export function b32process(str: string): string {
  const substitutions: { [key: string]: string } = {
    "o": "0", "O": "0", "i": "1", "I": "1",
    "l": "1", "z": "2", "Z": "2", "s": "5",
    "S": "5", "b": "6", "G": "6", "a": "9",
    "g": "9", "q": "9", "m": "M", "t": "T",
    "X": "x", "J": "j", "e": "E", "Y": "y",
    "W": "w", "C": "c", "P": "p", "n": "N",
    "h": "N", "U": "u", "v": "u", "V": "u",
    "F": "f", "K": "k"
  }
  let processedStr = '';
  for (let char of str)
    processedStr += substitutions[char] || char;
  return processedStr;
}

export function b32decode(encoded: string): number | null {
  if (!base62Regex.test(encoded))
    throw new Error(`Input string contains invalid characters (${encoded}) - use 'process()'.`);
  let bin = Array.from(encoded)
    .map(c => base32mi.indexOf(c))
  if (bin.reduce((a, b) => (a ^ b)) & 0x10)
    return null;
  return (((bin[0] * 32 + bin[1]) * 32 + bin[2]) * 16 + (bin[3] & 0x0f));
}
