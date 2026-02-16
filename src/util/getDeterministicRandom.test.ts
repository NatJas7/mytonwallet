import getDeterministicRandom from './getDeterministicRandom';

describe('getDeterministicRandom', () => {
  describe('numeric seed', () => {
    test('returns value within range', () => {
      for (let i = 0; i < 20; i++) {
        const result = getDeterministicRandom(0, 10, i);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(10);
      }
    });

    test('is deterministic', () => {
      expect(getDeterministicRandom(0, 100, 5)).toBe(getDeterministicRandom(0, 100, 5));
      expect(getDeterministicRandom(10, 50, 42)).toBe(getDeterministicRandom(10, 50, 42));
    });

    test('returns different values for different indices', () => {
      const values = new Set([
        getDeterministicRandom(0, 100, 1),
        getDeterministicRandom(0, 100, 2),
        getDeterministicRandom(0, 100, 3),
      ]);
      expect(values.size).toBeGreaterThan(1);
    });

    test('handles single value range', () => {
      expect(getDeterministicRandom(5, 5, 0)).toBe(5);
      expect(getDeterministicRandom(5, 5, 10)).toBe(5);
    });

    test('handles negative ranges', () => {
      for (let i = 0; i < 20; i++) {
        const result = getDeterministicRandom(-10, -5, i);
        expect(result).toBeGreaterThanOrEqual(-10);
        expect(result).toBeLessThanOrEqual(-5);
      }
    });

    test('produces reasonable distribution', () => {
      const results: number[] = [];
      for (let i = 0; i < 1000; i++) {
        results.push(getDeterministicRandom(0, 9, i));
      }

      const uniqueValues = new Set(results);
      expect(uniqueValues.size).toBeGreaterThan(5);
      expect(Math.min(...results)).toBe(0);
      expect(Math.max(...results)).toBe(9);
    });
  });

  describe('string seed', () => {
    test('is deterministic', () => {
      const first = getDeterministicRandom(1, 100, 'seed');
      const second = getDeterministicRandom(1, 100, 'seed');
      expect(first).toBe(second);
    });

    test('stays within range', () => {
      const testCases = [
        { min: 1, max: 100 },
        { min: -50, max: 50 },
        { min: 999, max: 1000 },
      ];

      for (const { min, max } of testCases) {
        const result = getDeterministicRandom(min, max, 'input');
        expect(result).toBeGreaterThanOrEqual(min);
        expect(result).toBeLessThanOrEqual(max);
      }
    });

    test('empty string produces valid result', () => {
      expect(() => getDeterministicRandom(1, 10, '')).not.toThrow();
    });

    test('special characters affect output', () => {
      const str1 = getDeterministicRandom(1, 1000, 'hello@');
      const str2 = getDeterministicRandom(1, 1000, 'hello#');
      expect(str1).not.toBe(str2);
    });

    test('known values', () => {
      expect(getDeterministicRandom(0, 100, 'apple')).toBe(99);
      expect(getDeterministicRandom(10, 20, 'banana')).toBe(18);
      expect(getDeterministicRandom(1, 5, '')).toBe(1);
    });
  });
});
