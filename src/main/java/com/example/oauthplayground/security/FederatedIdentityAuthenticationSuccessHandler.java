package com.example.oauthplayground.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.Map;

/**
 * The bridge between Federated Identity (OAuth2 login) and JWT.
 *
 * Flow:
 *   1. User authenticates with Google or GitHub (OAuth2 Authorization Code flow)
 *   2. Spring Security creates an OAuth2AuthenticationToken
 *   3. This handler fires instead of the default redirect
 *   4. We normalize provider-specific user attributes into UserPrincipal
 *   5. We mint a JWT and return it as JSON
 *
 * After this point the client is stateless — it carries the JWT in every request.
 * No session cookie is needed for API calls.
 *
 * Provider attribute differences:
 *   Google (OpenID Connect):
 *     - User ID: "sub"  (e.g. "109876543210987654321")
 *     - Name:    "name"
 *     - Email:   "email"
 *
 *   GitHub (OAuth2 only, not OIDC):
 *     - User ID: "id"   (e.g. 1234567)
 *     - Name:    "name" (or "login" if name is null)
 *     - Email:   "email" (may be null if user keeps email private — needs user:email scope)
 */
@Component
public class FederatedIdentityAuthenticationSuccessHandler implements AuthenticationSuccessHandler {

    private final JwtTokenService jwtTokenService;
    private final ObjectMapper objectMapper;

    public FederatedIdentityAuthenticationSuccessHandler(
            JwtTokenService jwtTokenService,
            ObjectMapper objectMapper) {
        this.jwtTokenService = jwtTokenService;
        this.objectMapper = objectMapper;
    }

    @Override
    public void onAuthenticationSuccess(
            HttpServletRequest request,
            HttpServletResponse response,
            Authentication authentication) throws IOException {

        OAuth2AuthenticationToken oauthToken = (OAuth2AuthenticationToken) authentication;
        String registrationId = oauthToken.getAuthorizedClientRegistrationId(); // "google" | "github"
        OAuth2User oAuth2User = oauthToken.getPrincipal();

        UserPrincipal principal = switch (registrationId) {
            case "google" -> extractGoogleUser(oAuth2User);
            case "github" -> extractGithubUser(oAuth2User);
            default -> throw new IllegalArgumentException("Unsupported provider: " + registrationId);
        };

        String token = jwtTokenService.mintToken(principal);

        // Return the JWT as JSON. In a real SPA you might redirect with the token in a fragment.
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setStatus(HttpServletResponse.SC_OK);
        objectMapper.writeValue(response.getWriter(), Map.of(
                "token", token,
                "tokenType", "Bearer",
                "provider", registrationId,
                "subject", principal.subject()
        ));
    }

    private UserPrincipal extractGoogleUser(OAuth2User user) {
        // Google's OpenID Connect provides a standard "sub" claim as the stable user identifier
        String sub = user.getAttribute("sub");
        String name = user.getAttribute("name");
        String email = user.getAttribute("email");
        return UserPrincipal.of("google", sub, name, email);
    }

    private UserPrincipal extractGithubUser(OAuth2User user) {
        // GitHub uses "id" (numeric) as the stable user identifier
        Object idAttr = user.getAttribute("id");
        String id = idAttr != null ? idAttr.toString() : "unknown";
        String name = user.getAttribute("name");
        if (name == null) {
            // GitHub users may not have a display name; fall back to login handle
            name = user.getAttribute("login");
        }
        String email = user.getAttribute("email"); // may be null for private GitHub emails
        return UserPrincipal.of("github", id, name, email);
    }
}
