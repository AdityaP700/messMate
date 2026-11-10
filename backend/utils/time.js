// IST (Asia/Kolkata) Time Utility Helpers

const MEAL_SCHEDULE = {
  breakfast: { start: '07:30', end: '09:00', startMinutes: 7 * 60 + 30, endMinutes: 9 * 60 },
  lunch:     { start: '12:00', end: '14:00', startMinutes: 12 * 60,     endMinutes: 14 * 60 },
  snacks:    { start: '16:00', end: '17:00', startMinutes: 16 * 60,     endMinutes: 17 * 60 },
  dinner:    { start: '19:30', end: '21:00', startMinutes: 19 * 60 + 30, endMinutes: 21 * 60 }
};

/**
 * Returns current Date object in IST
 */
function getISTDateObj() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const istOffset = 5.5 * 60 * 60 * 1000;
  return new Date(utc + istOffset);
}

/**
 * Returns current date string formatted as YYYY-MM-DD in IST
 */
function getTodayIST() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

/**
 * Returns current day of week (e.g. 'Monday', 'Tuesday') in IST
 */
function getDayOfWeekIST() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long'
  }).format(new Date());
}

/**
 * Returns current time minutes from midnight in IST
 */
function getMinutesFromMidnightIST() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  }).formatToParts(new Date());

  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  return (hour % 24) * 60 + minute;
}

/**
 * Checks if current IST time falls strictly inside a meal window
 */
function isWithinMealWindow(mealType) {
  const meal = MEAL_SCHEDULE[mealType?.toLowerCase()];
  if (!meal) return false;
  const currentMinutes = getMinutesFromMidnightIST();
  return currentMinutes >= meal.startMinutes && currentMinutes <= meal.endMinutes;
}

/**
 * Determines current active meal or closest upcoming meal
 */
function getCurrentOrUpcomingMeal() {
  const currentMinutes = getMinutesFromMidnightIST();
  for (const [meal, timing] of Object.entries(MEAL_SCHEDULE)) {
    if (currentMinutes >= timing.startMinutes && currentMinutes <= timing.endMinutes) {
      return meal;
    }
  }

  // If outside meal windows, return closest upcoming meal
  if (currentMinutes < MEAL_SCHEDULE.breakfast.startMinutes) return 'breakfast';
  if (currentMinutes < MEAL_SCHEDULE.lunch.startMinutes) return 'lunch';
  if (currentMinutes < MEAL_SCHEDULE.snacks.startMinutes) return 'snacks';
  if (currentMinutes < MEAL_SCHEDULE.dinner.startMinutes) return 'dinner';
  return 'breakfast'; // Past dinner, next is tomorrow's breakfast
}

/**
 * Checks whether coupon skip is allowed based on cutoff minutes
 */
function canSkipMeal(mealDateStr, mealType, cutoffMinutes = 60) {
  const today = getTodayIST();
  if (mealDateStr > today) return { allowed: true };
  if (mealDateStr < today) return { allowed: false, reason: 'Cannot skip past meals' };

  const meal = MEAL_SCHEDULE[mealType?.toLowerCase()];
  if (!meal) return { allowed: false, reason: 'Invalid meal type' };

  const currentMinutes = getMinutesFromMidnightIST();
  const cutoffTime = meal.startMinutes - cutoffMinutes;

  if (currentMinutes >= meal.startMinutes) {
    return { allowed: false, reason: `Meal window for ${mealType} has already started.` };
  }

  if (currentMinutes > cutoffTime) {
    return {
      allowed: false,
      reason: `Cutoff time passed. Skips must be requested at least ${cutoffMinutes} minutes prior to ${meal.start}.`
    };
  }

  return { allowed: true };
}

module.exports = {
  MEAL_SCHEDULE,
  getISTDateObj,
  getTodayIST,
  getDayOfWeekIST,
  getMinutesFromMidnightIST,
  isWithinMealWindow,
  getCurrentOrUpcomingMeal,
  canSkipMeal
};
