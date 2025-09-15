// backend/middleware/roles.js
/**
 * allowRoles('admin','gatekeeper') → middleware that lets
 *  - any user whose role is in the list
 *  - *or* a superadmin
 *     otherwise responds 403.
 */
exports.allowRoles = (...roles) => (req, res, next) => {
  const role = req.user?.role;
  if (role === 'superadmin' || roles.includes(role)) return next();

  return res
    .status(403)
    .json({ msg: 'Access forbidden: insufficient rights' });
};
