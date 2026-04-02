package com.example.oauthplayground.web;

import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * REST API demonstrating the three levels of access:
 *
 *   /public/hello     — open to everyone, no token required
 *   /api/me           — requires a valid Bearer JWT (any authenticated user)
 *   /api/admin/secret — requires a valid Bearer JWT AND the ROLE_ADMIN claim
 *
 * The @AuthenticationPrincipal Jwt parameter is injected by Spring Security's
 * resource server support — it contains all the decoded JWT claims.
 */
@RestController
public class ApiController {

    /**
     * Public endpoint — demonstrates that some routes can be open without authentication.
     * Accessible without any token.
     */
    @GetMapping("/public/hello")
    public ResponseEntity<Map<String, String>> hello() {
        return ResponseEntity.ok(Map.of(
                "message", "Hello, World!",
                "description", "This endpoint is public — no authentication needed."
        ));
    }

    /**
     * Protected endpoint — demonstrates JWT-based authentication.
     *
     * The JWT is validated by the Resource Server filter chain before this method is called.
     * @AuthenticationPrincipal Jwt gives direct access to all JWT claims.
     *
     * Try: GET /api/me with Authorization: Bearer <your-jwt>
     */
    @GetMapping("/api/me")
    public ResponseEntity<Map<String, Object>> me(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(Map.of(
                "subject", jwt.getSubject(),
                "name", getClaimOrEmpty(jwt, "name"),
                "email", getClaimOrEmpty(jwt, "email"),
                "provider", getClaimOrEmpty(jwt, "provider"),
                "roles", jwt.getClaimAsStringList("roles"),
                "issuedAt", jwt.getIssuedAt().toString(),
                "expiresAt", jwt.getExpiresAt().toString(),
                "issuer", jwt.getIssuer().toString()
        ));
    }

    /**
     * Admin-only endpoint — demonstrates role-based authorization on top of JWT auth.
     *
     * Access requires the JWT to contain "ROLE_ADMIN" in the roles claim.
     * The SecurityConfig maps this to the "SCOPE_ROLE_ADMIN" authority Spring Security checks.
     *
     * Try: GET /api/admin/secret with a JWT that has roles: ["ROLE_ADMIN"]
     */
    @GetMapping("/api/admin/secret")
    public ResponseEntity<Map<String, String>> adminSecret(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(Map.of(
                "secret", "You have admin access!",
                "grantedTo", jwt.getSubject()
        ));
    }

    private String getClaimOrEmpty(Jwt jwt, String claim) {
        String value = jwt.getClaimAsString(claim);
        return value != null ? value : "";
    }
}
