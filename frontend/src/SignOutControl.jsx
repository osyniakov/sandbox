import { useAuth } from './AuthContext.jsx'

// Small "signed in as <email> / Sign out" affordance, reachable from every
// page (sandbox-dfr.5). Rendered directly inside each page's own top-level
// JSX rather than via a shared layout wrapper -- App.jsx documents (see its
// "Shared layout wrapper: deliberately NOT introduced here" comment,
// sandbox-zlt.6) that introducing a JSX-level wrapper around `<Routes>`
// risks double padding/a conflicting box model against each page's own
// independently-adopted root element. Duplicating this one small component
// across the three pages is the smaller change and doesn't reopen that
// layout question.
function SignOutControl() {
  const { email, signOut } = useAuth()

  return (
    <p className="mt-4 text-sm text-text">
      Signed in as {email}{' '}
      <button
        type="button"
        onClick={signOut}
        className="link cursor-pointer border-0 bg-transparent p-0 text-sm"
      >
        Sign out
      </button>
    </p>
  )
}

export default SignOutControl
