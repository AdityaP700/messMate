// Authentication and Role Authorization Middleware

function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }

  const isApi = req.originalUrl.startsWith('/api') || req.xhr || req.headers.accept?.includes('application/json');
  if (isApi) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }
  return res.redirect('/index.html');
}

function hasRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      const isApi = req.originalUrl.startsWith('/api') || req.xhr || req.headers.accept?.includes('application/json');
      if (isApi) {
        return res.status(401).json({ error: 'Authentication required. Please log in.' });
      }
      return res.redirect('/index.html');
    }

    if (roles.includes(req.session.user.role)) {
      return next();
    }

    const isApi = req.originalUrl.startsWith('/api') || req.xhr || req.headers.accept?.includes('application/json');
    if (isApi) {
      return res.status(403).json({ error: 'Access forbidden: Insufficient permissions.' });
    }
    return res.status(403).send('Forbidden: Insufficient privileges.');
  };
}

module.exports = {
  isAuthenticated,
  hasRole
};
