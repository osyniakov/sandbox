package com.example.oauthplayground.security;

import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

/**
 * Issues and validates JWTs for this application.
 *
 * JWT structure produced by mintToken():
 * Header:  { "alg": "RS256", "kid": "<key-id>" }
 * Payload: {
 *   "iss": "oauth-playground",       -- issuer
 *   "sub": "google:12345",           -- subject (provider:userId)
 *   "iat": <now>,                    -- issued at
 *   "exp": <now + 1h>,               -- expiry
 *   "name": "Alice",
 *   "email": "alice@example.com",
 *   "provider": "google",
 *   "roles": ["ROLE_USER"]
 * }
 *
 * The token is signed with RS256 (RSA + SHA-256).
 * The Resource Server (SecurityConfig) uses the same RSA public key to verify it.
 */
@Service
public class JwtTokenService {

    // Must be a URI — Spring Security's getIssuer() validates the iss claim as a URL
    private static final String ISSUER = "http://oauth-playground.local";
    private static final long TOKEN_VALIDITY_HOURS = 1;

    private final JwtEncoder encoder;
    private final JwtDecoder decoder;

    public JwtTokenService(JwtEncoder encoder, JwtDecoder decoder) {
        this.encoder = encoder;
        this.decoder = decoder;
    }

    /**
     * Mints a signed JWT for the given user principal.
     *
     * @param user the authenticated user
     * @return a compact, URL-safe JWT string (three Base64URL segments joined by dots)
     */
    public String mintToken(UserPrincipal user) {
        Instant now = Instant.now();

        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(ISSUER)
                .subject(user.subject())
                .issuedAt(now)
                .expiresAt(now.plus(TOKEN_VALIDITY_HOURS, ChronoUnit.HOURS))
                .claim("name", user.name())
                .claim("email", user.email())
                .claim("provider", user.provider())
                .claim("roles", user.roles())
                .build();

        return encoder.encode(JwtEncoderParameters.from(claims)).getTokenValue();
    }

    /**
     * Decodes and validates a JWT string.
     * Throws JwtException (unchecked) if the token is malformed, expired, or has an invalid signature.
     *
     * @param token the JWT string
     * @return the decoded Jwt with all claims accessible
     */
    public Jwt decode(String token) {
        return decoder.decode(token);
    }
}
