import { defaultLaunchOptions, type LaunchOptions } from './application-contracts';

// main.cpp uses decimal std::stoul, then casts its native 64-bit unsigned long
// to uint32_t. Prefix parsing (including a sign) is intentionally preserved.
function seedNumber(text: string): number {
  const token = /^[\t\n\v\f\r ]*([+-]?)(\d+)/.exec(text);
  if (!token) throw new Error('stoul');
  const magnitude = BigInt(token[2]);
  if (magnitude > 0xffffffffffffffffn) throw new Error('stoul');
  return Number(BigInt.asUintN(32, token[1] === '-' ? -magnitude : magnitude));
}
const minNormal = 2 ** -1022;
function hexDouble(token: string): number {
  const match = /^([+-]?)0x([\da-f]*)(?:\.([\da-f]*))?(?:p([+-]?\d+))?$/i.exec(token)!;
  const sign = match[1] === '-' ? -1 : 1,
    digits = (match[2] || '') + (match[3] || ''),
    integer = BigInt('0x' + digits);
  if (!integer) return sign * 0;
  const power = BigInt(match[4] || '0') - BigInt((match[3]?.length || 0) * 4),
    bits = BigInt(integer.toString(2).length);
  const exponent = power + bits - 1n;
  if (exponent > 1023n || exponent < -1075n) throw new Error('stod');
  const unit = exponent - 52n > -1074n ? exponent - 52n : -1074n,
    shift = unit - power;
  let mantissa: bigint,
    inexact = false;
  if (shift <= 0n) mantissa = integer << -shift;
  else {
    mantissa = integer >> shift;
    const remainder = integer - (mantissa << shift),
      half = 1n << (shift - 1n);
    inexact = remainder !== 0n;
    if (remainder > half || (remainder === half && (mantissa & 1n) !== 0n)) mantissa++;
  }
  const value = Number(mantissa) * 2 ** Number(unit);
  if (!Number.isFinite(value) || value === 0 || (value < minNormal && inexact)) throw new Error('stod');
  if (value === minNormal) {
    const shiftToBoundary = power + 1076n;
    const below =
      shiftToBoundary >= 0n
        ? integer << shiftToBoundary < (1n << 54n) - 1n
        : integer < ((1n << 54n) - 1n) << -shiftToBoundary;
    if (below) throw new Error('stod');
  }
  return sign * value;
}
function exactSubnormalDecimal(token: string, value: number): boolean {
  const [mantissa, suffix = '0'] = token.replace(/^[+-]/, '').toLowerCase().split('e'),
    places = (mantissa.split('.')[1] || '').length,
    integer = BigInt(mantissa.replace('.', '')),
    power = Number(suffix) - places;
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, Math.abs(value));
  const binary = bits.getBigUint64(0) & 0xfffffffffffffn;
  return power >= 0
    ? (integer * 10n ** BigInt(power)) << 1074n === binary
    : integer << 1074n === binary * 10n ** BigInt(-power);
}
// std::stod accepts a numeric prefix, hexadecimal floats, inf/nan, and reports
// range errors for overflow or an inexact underflow. It does not validate days.
function dayNumber(text: string): number {
  const input = text.replace(/^[\t\n\v\f\r ]*/, '');
  const infinity = /^[+-]?inf(?:inity)?/i.exec(input);
  if (infinity) return input[0] === '-' ? -Infinity : Infinity;
  if (/^[+-]?nan(?:\([\da-z_]*\))?/i.test(input)) return NaN;
  const hex = /^[+-]?0x(?:[\da-f]+(?:\.[\da-f]*)?|\.[\da-f]+)(?:p[+-]?\d+)?/i.exec(input);
  if (hex) return hexDouble(hex[0]);
  const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(input);
  if (!decimal) throw new Error('stod');
  const token = decimal[0],
    value = Number(token);
  if (!Number.isFinite(value)) throw new Error('stod');
  if (value === 0 && /[1-9]/.test(token.split(/[eE]/)[0])) throw new Error('stod');
  if (value !== 0 && Math.abs(value) < minNormal && !exactSubnormalDecimal(token, value))
    throw new Error('stod');
  if (Math.abs(value) === minNormal) {
    const [mantissa, suffix = '0'] = token.replace(/^[+-]/, '').toLowerCase().split('e');
    const integer = BigInt(mantissa.replace('.', ''));
    const power = Number(suffix) - (mantissa.split('.')[1] || '').length;
    // glibc strtod detects tininess before the final denormal rounding. Values
    // below the normal boundary minus a quarter subnormal ULP report ERANGE.
    if (power < 0 && integer << 1076n < ((1n << 54n) - 1n) * 10n ** BigInt(-power)) throw new Error('stod');
  }
  return value;
}

/** Browser query spelling mirrors native main.cpp flags; order is significant.
 * Host-only parameters (renderer, viewport and test controls) are left to the host.
 * Random entropy is resolved by worldSeed after parsing, preserving this pure API.
 */
export function parseLaunchQuery(query: URLSearchParams): Partial<LaunchOptions> {
  const options: LaunchOptions = { ...defaultLaunchOptions(), titleScreen: true };
  for (const [name, value] of query) {
    switch (name) {
      case 'seed':
        options.seed = seedNumber(value);
        options.world = 'Random';
        break;
      case 'world':
        if (value === 'designed') options.world = 'Designed';
        else if (value === 'random') options.world = 'Random';
        else throw new Error('World must be designed or random');
        break;
      case 'map-file':
        options.mapFile = value;
        break;
      case 'ui-script':
        options.uiScript = value;
        break;
      case 'building-assets':
        options.buildingAssets = value;
        break;
      case 'demo':
        options.demo = true;
        break;
      case 'days':
        options.days = dayNumber(value);
        break;
      case 'weather':
        options.weather = value;
        break;
      case 'raid':
        options.raid = true;
        break;
      case 'character-studio':
        options.studio = true;
        break;
      case 'map-editor':
        options.mapEditor = true;
        break;
      case 'character-file':
        options.characterFile = value;
        break;
      case 'building-studio':
        options.buildingStudio = true;
        break;
      case 'building-file':
        options.buildingFile = value;
        break;
      case 'save-file':
        options.saveFile = value;
        break;
    }
  }
  return options;
}
