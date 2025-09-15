/*  backend/controllers/analytics.js  */
const Request = require('../models/Request');
const Guest   = require('../models/Guest');

/**
 * Helper – builds an aggregation that groups by ISO-date
 *   pipeline(collection, 'createdAt')   →  [{ date:'2023-10-12', pending:3, out:1, … }]
 *   pipeline(collection, 'inAt')        →  same shape but grouping on another field
 */
const buildDailyStats = async (Model, dateField = 'createdAt', statuses) => {
  /* 1) flatten date to YYYY-MM-DD */
  const parts = await Model.aggregate([
    {
      $project: {
        status: 1,
        day: {
          $dateToString: { format: '%Y-%m-%d', date: `$${dateField}`, timezone: 'Asia/Karachi' }
        }
      }
    },
    { $group: { _id: { day: '$day', status: '$status' }, count: { $sum: 1 } } }
  ]);

  /* 2) reshape: one object per day → { date, pending, in, out … } */
  const byDay = {};
  for (const { _id, count } of parts) {
    if (!_id.day) continue;                 // null when dateField is null (e.g. outAt not set yet)
    if (!byDay[_id.day]) byDay[_id.day] = { date: _id.day };
    byDay[_id.day][_id.status] = count;
  }

  /* 3) make sure every status column exists (defaults to 0) */
  return Object.values(byDay)
    .map(row => {
      for (const s of statuses) if (row[s] == null) row[s] = 0;
      return row;
    })
    .sort((a, b) => a.date.localeCompare(b.date));      // ascending
};

/* ───────────────────────────────────────────────────────────── */

exports.getStats = async (_req, res) => {
  try {
    /* ------------------------------------------------------------------
       1.  LEAVE-REQUEST STATS  (createdAt always present)
    ------------------------------------------------------------------ */
    const requestStatuses = ['pending', 'approved', 'rejected', 'out', 'in'];
    const requestsByDate  = await buildDailyStats(Request, 'createdAt', requestStatuses);

    /* ------------------------------------------------------------------
       2.  GUEST-VISIT STATS
           – createdAt = entry created
           – inAt/outAt may be null  (so we call the helper twice)
    ------------------------------------------------------------------ */
    const guestStatuses   = ['pending', 'in', 'out'];
    const guestsByDate    = await buildDailyStats(Guest, 'createdAt', guestStatuses);

    /* Totals (handy for big counters) */
    const totalRequests = await Request.countDocuments();
    const totalGuests   = await Guest.countDocuments();

    res.json({
      ok: true,
      totals: { totalRequests, totalGuests },
      requestsByDate,
      guestsByDate
    });
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};
