/**
 * Parse the x-ms-client-principal header injected by Azure Static Web Apps.
 * Returns { userId, userDetails (email), identityProvider, userRoles } or null.
 */
function getClientPrincipal(req) {
  const header = req.headers['x-ms-client-principal'];
  if (!header) return null;

  try {
    const decoded = Buffer.from(header, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/**
 * Extract the authenticated user's email from the SWA auth header.
 */
function getUserEmail(req) {
  const principal = getClientPrincipal(req);
  if (!principal) return null;
  return principal.userDetails ? principal.userDetails.toLowerCase().trim() : null;
}

module.exports = { getClientPrincipal, getUserEmail };
