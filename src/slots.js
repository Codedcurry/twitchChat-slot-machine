// Reward picking for the slot machine. A reward with a symbol is a win and
// lands three of that symbol; a reward without one (like "Nothing") lands a
// mixed row so it never looks like a win.

export function validateRewards(rewards) {
  if (!Array.isArray(rewards) || rewards.length === 0) {
    throw new Error('The rewards list needs at least one reward');
  }
  for (const r of rewards) {
    if (!r || typeof r.name !== 'string' || !r.name.trim()) {
      throw new Error('Every reward needs a name');
    }
    if (typeof r.weight !== 'number' || !Number.isFinite(r.weight) || r.weight < 0) {
      throw new Error(`Reward "${r.name}" needs a weight of 0 or more`);
    }
    if (r.symbol !== undefined && (typeof r.symbol !== 'string' || !r.symbol)) {
      throw new Error(`Reward "${r.name}" has an empty symbol; remove it or set one`);
    }
  }
  if (totalWeight(rewards) <= 0) {
    throw new Error('At least one reward needs a weight above 0');
  }
  if (rewards.some((r) => !r.symbol && r.weight > 0) && symbolPool(rewards).length < 2) {
    throw new Error('A reward without a symbol needs at least two symbols to mix on the reels');
  }
  return rewards;
}

export function symbolPool(rewards) {
  return [...new Set(rewards.map((r) => r.symbol).filter(Boolean))];
}

export function pickReward(rewards, rng = Math.random) {
  let roll = rng() * totalWeight(rewards);
  let last = null;
  for (const r of rewards) {
    if (r.weight <= 0) continue;
    if (roll < r.weight) return r;
    roll -= r.weight;
    last = r;
  }
  return last; // only reached through floating point rounding
}

export function buildReels(reward, symbols, rng = Math.random) {
  if (reward.symbol) return [reward.symbol, reward.symbol, reward.symbol];
  const pick = () => symbols[Math.floor(rng() * symbols.length)];
  const reels = [pick(), pick(), pick()];
  if (reels[0] === reels[1] && reels[1] === reels[2]) {
    const i = symbols.indexOf(reels[2]);
    reels[2] = symbols[(i + 1 + Math.floor(rng() * (symbols.length - 1))) % symbols.length];
  }
  return reels;
}

export function spin(rewards, rng = Math.random) {
  const reward = pickReward(rewards, rng);
  return {
    reward: reward.name,
    win: Boolean(reward.symbol),
    reels: buildReels(reward, symbolPool(rewards), rng),
  };
}

function totalWeight(rewards) {
  return rewards.reduce((sum, r) => sum + (r.weight > 0 ? r.weight : 0), 0);
}
