/** Is this pathname the sign-in route (or below it)? Anchored: the proxy used
 *  `startsWith('/auth')`, which also matched `/authors` or `/authority` and would
 *  have sent a signed-in user from there to /reader, or let a signed-out one
 *  through to a page that is not the sign-in screen. */
export function isAuthPath(pathname: string): boolean {
  return pathname === '/auth' || pathname.startsWith('/auth/')
}
