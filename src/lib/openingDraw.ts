export const randomIndex = (length: number) => {
  if (length <= 1) return 0;
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] % length;
  }
  return Math.floor(Math.random() * length);
};

export const randomPair = (length: number) => {
  const first = randomIndex(length);
  if (length < 2) return [first, first] as const;
  let second = randomIndex(length - 1);
  if (second >= first) second += 1;
  return [first, second] as const;
};
