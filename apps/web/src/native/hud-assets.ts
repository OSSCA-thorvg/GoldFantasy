import gold from '../../../../packages/native-ui/assets/game/resource-gold.json';
import wood from '../../../../packages/native-ui/assets/game/resource-wood.json';
import stone from '../../../../packages/native-ui/assets/game/resource-stone.json';
import food from '../../../../packages/native-ui/assets/game/resource-food.json';
import water from '../../../../packages/native-ui/assets/game/resource-water.json';
import mana from '../../../../packages/native-ui/assets/game/resource-mana.json';
import residents from '../../../../packages/native-ui/assets/game/resource-residents.json';
import guests from '../../../../packages/native-ui/assets/game/resource-guests.json';
import renown from '../../../../packages/native-ui/assets/game/resource-renown.json';
import planks from '../../../../packages/native-ui/assets/game/resource-planks.json';
import cutStone from '../../../../packages/native-ui/assets/game/resource-cut-stone.json';
import bones from '../../../../packages/native-ui/assets/game/resource-bones.json';
import mural from '../../../../packages/native-ui/assets/game/sky-mural.svg?raw';
export const resourceIcons = [
  gold,
  wood,
  stone,
  food,
  water,
  mana,
  residents,
  guests,
  renown,
  planks,
  cutStone,
  bones,
].map((value) => JSON.stringify(value));
export const skyMural = mural;
/** C printf fixed precision: nearest decimal, ties to even, from the exact binary64 value. */
export function nativeFixed(value: number, digits: number): string {
  const negative = value < 0 || Object.is(value, -0),
    buffer = new ArrayBuffer(8),
    view = new DataView(buffer);
  view.setFloat64(0, Math.abs(value));
  const bits = view.getBigUint64(0),
    exponent = Number((bits >> 52n) & 2047n);
  let n = (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n),
    power = (exponent || 1) - 1023 - 52;
  n *= 10n ** BigInt(digits);
  let rounded: bigint;
  if (power >= 0) rounded = n << BigInt(power);
  else {
    const denominator = 1n << BigInt(-power),
      whole = n / denominator,
      remainder = n % denominator;
    rounded =
      whole +
      (remainder * 2n > denominator || (remainder * 2n === denominator && whole % 2n !== 0n) ? 1n : 0n);
  }
  const text = rounded.toString().padStart(digits + 1, '0');
  return (negative ? '-' : '') + (digits ? text.slice(0, -digits) + '.' + text.slice(-digits) : text);
}
