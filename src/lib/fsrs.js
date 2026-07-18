/**
 * IntuMedix App - FSRS v5 Scheduler
 * Implementation of Free Spaced Repetition Scheduler v5
 */

const FSRS_PARAMS = {
  w: [0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0589, 1.5330, 0.1544, 0.9369, 1.9787, 0.1100, 0.2900, 2.2700, 0.2500, 2.9898],
  requestRetention: 0.9,
  maximumInterval: 36500,
  easyBonus: 1.3,
  hardInterval: 1.2,
};

export const Rating = { Again: 1, Hard: 2, Good: 3, Easy: 4 };
export const State = { New: 0, Learning: 1, Review: 2, Relearning: 3 };

function forgettingCurve(elapsedDays, stability) {
  return Math.pow(1 + (elapsedDays / (9 * stability)), -1);
}

function initDS(rating) {
  const w = FSRS_PARAMS.w;
  let d = w[4] - Math.exp(w[5] * (rating - 1)) + 1;
  d = Math.min(10, Math.max(1, d));
  let s;
  if (rating === Rating.Again) s = w[0];
  else if (rating === Rating.Hard) s = w[1];
  else if (rating === Rating.Good) s = w[2];
  else s = w[3];
  return { d, s };
}

function nextDifficulty(d, rating) {
  const w = FSRS_PARAMS.w;
  let nextD = d + w[6] * (rating - 3);
  return Math.min(10, Math.max(1, nextD - w[7] * (nextD - d)));
}

function shortTermStability(s, rating) {
  const w = FSRS_PARAMS.w;
  return s * Math.exp(w[17] * (rating - 3 + w[18]));
}

function recallStability(d, s, r, rating) {
  const w = FSRS_PARAMS.w;
  const hard = rating === Rating.Hard ? w[15] : 1;
  const easy = rating === Rating.Easy ? w[16] : 1;
  return s * (Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) *
    (Math.exp((1 - r) * w[10]) - 1) * hard * easy);
}

function forgetStability(d, s, r) {
  const w = FSRS_PARAMS.w;
  return w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]);
}

function nextInterval(s) {
  const r = FSRS_PARAMS.requestRetention;
  const interval = (9 * s * (1 / r - 1));
  return Math.min(FSRS_PARAMS.maximumInterval, Math.max(1, Math.round(interval)));
}

/**
 * Schedule a card based on rating
 * @param {Object} card - current card state
 * @param {number} rating - Rating.Again/Hard/Good/Easy
 * @param {Date} now - current time
 * @returns {Object} updated card state
 */
export function scheduleCard(card, rating, now = new Date()) {
  const updatedCard = { ...card };
  updatedCard.lastReview = now.toISOString();
  updatedCard.reps = (card.reps || 0) + 1;

  if (card.state === State.New || !card.stability) {
    // First review
    const { d, s } = initDS(rating);
    updatedCard.difficulty = d;
    updatedCard.stability = s;
    
    if (rating === Rating.Again) {
      updatedCard.state = State.Learning;
      updatedCard.dueDate = new Date(now.getTime() + 60 * 1000).toISOString(); // 1 min
      updatedCard.scheduledDays = 0;
    } else if (rating === Rating.Hard) {
      updatedCard.state = State.Learning;
      updatedCard.dueDate = new Date(now.getTime() + 5 * 60 * 1000).toISOString(); // 5 min
      updatedCard.scheduledDays = 0;
    } else if (rating === Rating.Good) {
      updatedCard.state = State.Review;
      updatedCard.scheduledDays = nextInterval(s);
      updatedCard.dueDate = addDays(now, updatedCard.scheduledDays).toISOString();
    } else { // Easy
      updatedCard.stability = s * FSRS_PARAMS.easyBonus;
      updatedCard.state = State.Review;
      updatedCard.scheduledDays = nextInterval(updatedCard.stability);
      updatedCard.dueDate = addDays(now, updatedCard.scheduledDays).toISOString();
    }
  } else if (card.state === State.Learning || card.state === State.Relearning) {
    if (rating === Rating.Again) {
      updatedCard.state = card.state;
      updatedCard.dueDate = new Date(now.getTime() + 60 * 1000).toISOString();
      updatedCard.scheduledDays = 0;
    } else if (rating === Rating.Good || rating === Rating.Hard) {
      updatedCard.state = State.Review;
      const newS = shortTermStability(card.stability, rating);
      updatedCard.stability = newS;
      updatedCard.scheduledDays = nextInterval(newS);
      updatedCard.dueDate = addDays(now, updatedCard.scheduledDays).toISOString();
    } else { // Easy
      const newS = shortTermStability(card.stability, rating) * FSRS_PARAMS.easyBonus;
      updatedCard.stability = newS;
      updatedCard.state = State.Review;
      updatedCard.scheduledDays = nextInterval(newS);
      updatedCard.dueDate = addDays(now, updatedCard.scheduledDays).toISOString();
    }
  } else { // Review
    const elapsedDays = Math.max(1, daysBetween(new Date(card.lastReview), now));
    const r = forgettingCurve(elapsedDays, card.stability);
    updatedCard.difficulty = nextDifficulty(card.difficulty, rating);
    
    if (rating === Rating.Again) {
      updatedCard.state = State.Relearning;
      updatedCard.lapses = (card.lapses || 0) + 1;
      updatedCard.stability = forgetStability(card.difficulty, card.stability, r);
      updatedCard.dueDate = new Date(now.getTime() + 10 * 60 * 1000).toISOString(); // 10 min
      updatedCard.scheduledDays = 0;
    } else {
      updatedCard.state = State.Review;
      updatedCard.stability = recallStability(card.difficulty, card.stability, r, rating);
      updatedCard.scheduledDays = nextInterval(updatedCard.stability);
      updatedCard.dueDate = addDays(now, updatedCard.scheduledDays).toISOString();
    }
  }

  return updatedCard;
}

/**
 * Get preview of next intervals for all ratings
 */
export function getNextIntervals(card, now = new Date()) {
  const previews = {};
  for (const [name, rating] of Object.entries(Rating)) {
    const scheduled = scheduleCard(card, rating, now);
    previews[name] = {
      rating,
      days: scheduled.scheduledDays,
      label: formatInterval(scheduled.scheduledDays, scheduled.dueDate, now),
    };
  }
  return previews;
}

function formatInterval(days, dueDate, now) {
  if (days === 0) {
    const ms = new Date(dueDate) - now;
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins}د`;
    return `${Math.round(mins / 60)}س`;
  }
  if (days === 1) return 'غداً';
  if (days < 7) return `${days} أيام`;
  if (days < 30) return `${Math.round(days / 7)} أسابيع`;
  if (days < 365) return `${Math.round(days / 30)} شهور`;
  return `${(days / 365).toFixed(1)} سنوات`;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function daysBetween(d1, d2) {
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

export function isDue(card, now = new Date()) {
  if (!card.dueDate) return true;
  return new Date(card.dueDate) <= now;
}

export function createNewCard(noteId, deckId) {
  return {
    noteId,
    deckId,
    state: State.New,
    stability: null,
    difficulty: null,
    dueDate: new Date().toISOString(),
    lastReview: null,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
  };
}
