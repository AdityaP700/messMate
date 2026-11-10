const db = require('../config/db');
const { MEAL_SCHEDULE, getTodayIST, getMinutesFromMidnightIST } = require('./time');
const { MESS_HALLS, VALID_MESS_CODES } = require('./messConfig');

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
 * Summarizes meal consumption, savings, projected waste, and prep metrics for coupon rows.
 */
function summarizeCouponSlice(rows, dateStr, today, currentMinutes, historicalNoShowRate, prices) {
  const byMeal = {};
  let ate = 0;
  let skipped = 0;
  let onLeave = 0;
  let active = 0;
  let wastedPortions = 0;
  let savedPortions = 0;
  let foodSavedKg = 0;
  let moneySavedInr = 0;
  let projectedWasteKg = 0;
  let projectedWasteInr = 0;
  let recommendedPrep = 0;

  for (const meal of ['breakfast', 'lunch', 'snacks', 'dinner']) {
    const bucket = { ate: 0, skipped: 0, on_leave: 0, active: 0, expired: 0 };

    rows
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

    ate += bucket.ate;
    skipped += bucket.skipped;
    onLeave += bucket.on_leave;
    active += bucket.active;
    savedPortions += savedCount;
    wastedPortions += wastedCount;
    recommendedPrep += recommendedCook;

    foodSavedKg += savedCount * weight;
    moneySavedInr += savedCount * price;
    projectedWasteKg += wastedCount * weight;
    projectedWasteInr += wastedCount * price;
  }

  const denom = savedPortions + wastedPortions;
  const wastePreventionPct = denom > 0 ? Math.round((savedPortions / denom) * 100) : 100;

  return {
    totals: {
      ate,
      skipped,
      on_leave: onLeave,
      active_upcoming: active,
      saved_portions: savedPortions,
      projected_wasted_portions: wastedPortions,
      recommended_prep_portions: recommendedPrep,
      food_saved_kg: Number(foodSavedKg.toFixed(1)),
      money_saved_inr: Number(moneySavedInr.toFixed(0)),
      projected_waste_kg: Number(projectedWasteKg.toFixed(1)),
      projected_waste_inr: Number(projectedWasteInr.toFixed(0)),
      waste_prevention_pct: wastePreventionPct
    },
    by_meal: byMeal
  };
}

/**
 * Computes overall and per-mess consumption, skips, projected waste, and complaint redressal analytics.
 */
async function computeAnalytics(targetDate = null) {
  const today = getTodayIST();
  const dateStr = targetDate || today;
  const currentMinutes = getMinutesFromMidnightIST();
  const prices = await getMealPrices();

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

  const [couponRows] = await db.query(
    `SELECT mess_hall, meal_type, status, COUNT(*) AS cnt
     FROM coupons
     WHERE meal_date = ?
     GROUP BY mess_hall, meal_type, status`,
    [dateStr]
  );

  // Overall campus slice across both messes
  const overallSlice = summarizeCouponSlice(couponRows, dateStr, today, currentMinutes, historicalNoShowRate, prices);

  // Complaint breakdown overall & per mess/routing
  const [compByMess] = await db.query(
    `SELECT
       mess_hall,
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count,
       SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
       SUM(CASE WHEN status = 'escalated_to_vendor' THEN 1 ELSE 0 END) AS escalated_count,
       SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count,
       SUM(CASE WHEN routing_type = 'via_mess_rep' THEN 1 ELSE 0 END) AS via_rep_count,
       SUM(CASE WHEN routing_type = 'direct' THEN 1 ELSE 0 END) AS direct_count,
       ROUND(AVG(CASE WHEN status = 'resolved' AND resolved_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, created_at, resolved_at) / 60.0 ELSE NULL END), 1) AS avg_resolution_hours
     FROM complaints
     GROUP BY mess_hall`
  );

  const [todayComp] = await db.query(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count
     FROM complaints
     WHERE meal_date = ?`,
    [dateStr]
  );

  const byMess = {};
  let totalComp = 0;
  let totalOpen = 0;
  let totalInProgress = 0;
  let totalEscalated = 0;
  let totalResolved = 0;
  let totalViaRep = 0;
  let totalDirect = 0;
  const hoursWeighted = [];

  for (const code of VALID_MESS_CODES) {
    const meta = MESS_HALLS[code];
    const messCouponRows = couponRows.filter(r => (r.mess_hall || 'mess_1') === code);
    const slice = summarizeCouponSlice(messCouponRows, dateStr, today, currentMinutes, historicalNoShowRate, prices);

    const mc = compByMess.find(r => (r.mess_hall || 'mess_1') === code) || {};
    const mTotal = Number(mc.total || 0);
    const mOpen = Number(mc.open_count || 0);
    const mProg = Number(mc.in_progress_count || 0);
    const mEsc = Number(mc.escalated_count || 0);
    const mRes = Number(mc.resolved_count || 0);
    const mRep = Number(mc.via_rep_count || 0);
    const mDir = Number(mc.direct_count || 0);

    totalComp += mTotal;
    totalOpen += mOpen;
    totalInProgress += mProg;
    totalEscalated += mEsc;
    totalResolved += mRes;
    totalViaRep += mRep;
    totalDirect += mDir;
    if (mc.avg_resolution_hours && mRes > 0) {
      hoursWeighted.push(Number(mc.avg_resolution_hours) * mRes);
    }

    byMess[code] = {
      code,
      name: meta.name,
      shortName: meta.shortName,
      vendor: meta.vendor,
      ...slice.totals,
      complaints: {
        total: mTotal,
        open: mOpen,
        in_progress: mProg,
        escalated_to_vendor: mEsc,
        resolved: mRes,
        via_mess_rep: mRep,
        direct: mDir,
        redressal_rate_pct: mTotal > 0 ? Math.round((mRes / mTotal) * 100) : 100
      }
    };
  }

  const avgHours = totalResolved > 0 && hoursWeighted.length > 0
    ? Number((hoursWeighted.reduce((a, b) => a + b, 0) / totalResolved).toFixed(1))
    : 0;

  return {
    date: dateStr,
    historical_no_show_rate_pct: Number((historicalNoShowRate * 100).toFixed(1)),
    totals: overallSlice.totals,
    by_meal: overallSlice.by_meal,
    by_mess: byMess,
    complaints: {
      total: totalComp,
      open: totalOpen,
      in_progress: totalInProgress,
      escalated_to_vendor: totalEscalated,
      resolved: totalResolved,
      via_mess_rep: totalViaRep,
      direct: totalDirect,
      redressal_rate_pct: totalComp > 0 ? Math.round((totalResolved / totalComp) * 100) : 100,
      avg_resolution_hours: avgHours,
      today_total: Number(todayComp[0]?.total || 0),
      today_resolved: Number(todayComp[0]?.resolved_count || 0)
    }
  };
}

module.exports = {
  MEAL_WEIGHT_KG,
  computeAnalytics
};
