const db = require('../config/db');
const { MEAL_SCHEDULE, getTodayIST, getMinutesFromMidnightIST } = require('./time');

const MEAL_WEIGHT_KG = {
  breakfast: 0.30,
  lunch: 0.50,
  snacks: 0.15,
  dinner: 0.48
};

/**
 * Fetches current meal prices from mess_settings
 */
async function getMealPrices() {
  const prices = { breakfast: 30, lunch: 50, snacks: 15, dinner: 50 };
  const [rows] = await db.query(
    "SELECT setting_key, setting_value FROM mess_settings WHERE setting_key IN ('breakfast_price','lunch_price','snacks_price','dinner_price')"
  );
  rows.forEach(r => {
    const meal = r.setting_key.replace('_price', '');
    const val = parseFloat(r.setting_value);
    if (!isNaN(val)) prices[meal] = val;
  });
  return prices;
}

/**
 * Computes consumption, skips, leaves, projected food waste, savings, and complaint redressal analytics.
 */
async function computeAnalytics(targetDate = null) {
  const today = getTodayIST();
  const dateStr = targetDate || today;
  const currentMinutes = getMinutesFromMidnightIST();
  const prices = await getMealPrices();

  // 1. Compute 7-day historical no-show rate from past days
  const [histRows] = await db.query(
    `SELECT
       SUM(CASE WHEN status IN ('used', 'expired', 'active') THEN 1 ELSE 0 END) AS committed,
       SUM(CASE WHEN status IN ('expired', 'active') THEN 1 ELSE 0 END) AS unclaimed
     FROM coupons
     WHERE meal_date < ? AND meal_date >= DATE_SUB(?, INTERVAL 7 DAY)`,
    [today, today]
  );
  const histCommitted = Number(histRows[0]?.committed || 0);
  const histUnclaimed = Number(histRows[0]?.unclaimed || 0);
  const historicalNoShowRate = histCommitted > 0
    ? Math.min(0.35, Math.max(0.02, histUnclaimed / histCommitted))
    : 0.08;

  // 2. Fetch coupon counts for dateStr grouped by meal_type & status
  const [couponRows] = await db.query(
    `SELECT meal_type, status, COUNT(*) AS cnt
     FROM coupons
     WHERE meal_date = ?
     GROUP BY meal_type, status`,
    [dateStr]
  );

  const byMeal = {};
  let totalAte = 0;
  let totalSkipped = 0;
  let totalOnLeave = 0;
  let totalActive = 0;
  let totalWastedPortions = 0;
  let totalSavedPortions = 0;
  let foodSavedKg = 0;
  let moneySavedInr = 0;
  let projectedWasteKg = 0;
  let projectedWasteInr = 0;
  let totalRecommendedPrep = 0;

  for (const meal of ['breakfast', 'lunch', 'snacks', 'dinner']) {
    const bucket = {
      ate: 0,
      skipped: 0,
      on_leave: 0,
      active: 0,
      expired: 0
    };

    couponRows
      .filter(r => r.meal_type === meal)
      .forEach(r => {
        const count = Number(r.cnt || 0);
        if (r.status === 'used') bucket.ate += count;
        else if (r.status === 'skipped') bucket.skipped += count;
        else if (r.status === 'on_leave') bucket.on_leave += count;
        else if (r.status === 'active') bucket.active += count;
        else if (r.status === 'expired') bucket.expired += count;
      });

    const mealEnded = dateStr < today || (dateStr === today && currentMinutes > MEAL_SCHEDULE[meal].endMinutes);
    const savedCount = bucket.skipped + bucket.on_leave;
    const wastedCount = mealEnded
      ? (bucket.active + bucket.expired)
      : Math.round(bucket.active * historicalNoShowRate);

    const recommendedCook = bucket.ate + Math.max(0, bucket.active - Math.round(bucket.active * historicalNoShowRate));
    const weight = MEAL_WEIGHT_KG[meal];
    const price = prices[meal];

    byMeal[meal] = {
      ...bucket,
      meal_ended: mealEnded,
      saved_portions: savedCount,
      projected_wasted_portions: wastedCount,
      recommended_cook: recommendedCook,
      food_saved_kg: Number((savedCount * weight).toFixed(2)),
      projected_waste_kg: Number((wastedCount * weight).toFixed(2))
    };

    totalAte += bucket.ate;
    totalSkipped += bucket.skipped;
    totalOnLeave += bucket.on_leave;
    totalActive += bucket.active;
    totalSavedPortions += savedCount;
    totalWastedPortions += wastedCount;
    totalRecommendedPrep += recommendedCook;

    foodSavedKg += savedCount * weight;
    moneySavedInr += savedCount * price;
    projectedWasteKg += wastedCount * weight;
    projectedWasteInr += wastedCount * price;
  }

  const denom = totalSavedPortions + totalWastedPortions;
  const wastePreventionPct = denom > 0 ? Math.round((totalSavedPortions / denom) * 100) : 100;

  // 3. Complaints & Redressal summary (overall + dateStr)
  const [compSummary] = await db.query(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count,
       SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
       SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count,
       ROUND(AVG(CASE WHEN status = 'resolved' AND resolved_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, created_at, resolved_at) / 60.0 ELSE NULL END), 1) AS avg_resolution_hours
     FROM complaints`
  );

  const [todayComp] = await db.query(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count
     FROM complaints
     WHERE meal_date = ?`,
    [dateStr]
  );

  const cTotal = Number(compSummary[0]?.total || 0);
  const cResolved = Number(compSummary[0]?.resolved_count || 0);

  return {
    date: dateStr,
    historical_no_show_rate_pct: Number((historicalNoShowRate * 100).toFixed(1)),
    totals: {
      ate: totalAte,
      skipped: totalSkipped,
      on_leave: totalOnLeave,
      active_upcoming: totalActive,
      saved_portions: totalSavedPortions,
      projected_wasted_portions: totalWastedPortions,
      recommended_prep_portions: totalRecommendedPrep,
      food_saved_kg: Number(foodSavedKg.toFixed(1)),
      money_saved_inr: Number(moneySavedInr.toFixed(0)),
      projected_waste_kg: Number(projectedWasteKg.toFixed(1)),
      projected_waste_inr: Number(projectedWasteInr.toFixed(0)),
      waste_prevention_pct: wastePreventionPct
    },
    by_meal: byMeal,
    complaints: {
      total: cTotal,
      open: Number(compSummary[0]?.open_count || 0),
      in_progress: Number(compSummary[0]?.in_progress_count || 0),
      resolved: cResolved,
      redressal_rate_pct: cTotal > 0 ? Math.round((cResolved / cTotal) * 100) : 100,
      avg_resolution_hours: compSummary[0]?.avg_resolution_hours ? Number(compSummary[0].avg_resolution_hours) : 0,
      today_total: Number(todayComp[0]?.total || 0),
      today_resolved: Number(todayComp[0]?.resolved_count || 0)
    }
  };
}

module.exports = {
  MEAL_WEIGHT_KG,
  computeAnalytics
};
