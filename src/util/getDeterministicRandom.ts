function computeSeedFromString(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return hash;
}

/**
 * Deterministic pseudo-random number in [min, max] from a numeric index or string seed.
 * NOT cryptographically secure — intended for stable UI values (e.g. skeleton widths).
 * Used to generate stable "random-looking" values (e.g. skeleton placeholder widths)
 * that stay the same across re-renders for the same input.
 */
export default function getDeterministicRandom(min: number, max: number, seed: number | string) {
  const normalizedMin = Math.floor(Math.min(min, max));
  const normalizedMax = Math.floor(Math.max(min, max));
  const range = normalizedMax - normalizedMin + 1;

  let x = Math.floor(typeof seed === 'string' ? Math.abs(computeSeedFromString(seed)) : seed);
  x = (x * 7 + (x % 13) * 3 + 5) % 65536;

  return normalizedMin + (x % range);
}
