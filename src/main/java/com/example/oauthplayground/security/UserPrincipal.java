package com.example.oauthplayground.security;

import java.util.List;

/**
 * Normalized representation of an authenticated user, regardless of which
 * Identity Provider they logged in through (Google, GitHub, etc.).
 *
 * Different providers return user attributes under different keys:
 *   - Google: "sub", "name", "email" (from OpenID Connect)
 *   - GitHub: "id", "name", "email" (from GitHub API)
 *
 * The FederatedIdentityAuthenticationSuccessHandler maps provider-specific
 * attributes into this common structure before issuing a JWT.
 *
 * The JWT "sub" claim is prefixed with the provider name (e.g. "google:12345")
 * to avoid collisions across providers.
 */
public record UserPrincipal(
        String subject,   // "google:12345" or "github:67890"
        String name,
        String email,
        String provider,  // "google" | "github"
        List<String> roles
) {

    /**
     * Convenience factory: creates a UserPrincipal with the default "ROLE_USER" role.
     */
    public static UserPrincipal of(String provider, String providerUserId, String name, String email) {
        return new UserPrincipal(
                provider + ":" + providerUserId,
                name,
                email,
                provider,
                List.of("ROLE_USER")
        );
    }
}
