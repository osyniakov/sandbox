package com.example.oauthplayground;

import com.example.oauthplayground.security.JwtTokenService;
import com.example.oauthplayground.security.UserPrincipal;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Integration tests for ApiController using MockMvc.
 *
 * These tests run without any real OAuth2 provider.
 * They mint real JWTs using JwtTokenService and send them as Bearer tokens,
 * exercising the full Spring Security filter chain.
 *
 * What's tested:
 *   1. Public endpoint is accessible without any token
 *   2. Protected endpoint requires a token (401 without one)
 *   3. Protected endpoint returns user info when a valid JWT is provided
 *   4. Admin endpoint returns 403 for non-admin users
 *   5. Admin endpoint returns 200 for users with ROLE_ADMIN
 */
@SpringBootTest
@AutoConfigureMockMvc
class ApiControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JwtTokenService jwtTokenService;

    // ── Public endpoint ──────────────────────────────────────────────────────

    @Test
    void publicHello_shouldReturn200WithoutToken() throws Exception {
        mockMvc.perform(get("/public/hello"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message").value("Hello, World!"));
    }

    // ── /api/me endpoint ─────────────────────────────────────────────────────

    @Test
    void apiMe_withoutToken_shouldReturn401() throws Exception {
        mockMvc.perform(get("/api/me"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void apiMe_withValidToken_shouldReturn200AndUserInfo() throws Exception {
        UserPrincipal alice = UserPrincipal.of("google", "12345", "Alice", "alice@example.com");
        String token = jwtTokenService.mintToken(alice);

        mockMvc.perform(get("/api/me")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.subject").value("google:12345"))
                .andExpect(jsonPath("$.name").value("Alice"))
                .andExpect(jsonPath("$.email").value("alice@example.com"))
                .andExpect(jsonPath("$.provider").value("google"))
                .andExpect(jsonPath("$.issuer").value("http://oauth-playground.local"));
    }

    @Test
    void apiMe_withGithubToken_shouldReturn200() throws Exception {
        UserPrincipal bob = UserPrincipal.of("github", "67890", "Bob", "bob@example.com");
        String token = jwtTokenService.mintToken(bob);

        mockMvc.perform(get("/api/me")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.subject").value("github:67890"))
                .andExpect(jsonPath("$.provider").value("github"));
    }

    // ── /api/admin/secret endpoint ───────────────────────────────────────────

    @Test
    void adminSecret_withoutToken_shouldReturn401() throws Exception {
        mockMvc.perform(get("/api/admin/secret"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void adminSecret_withNonAdminToken_shouldReturn403() throws Exception {
        // Regular user — only has ROLE_USER
        UserPrincipal regularUser = UserPrincipal.of("google", "12345", "Alice", "alice@example.com");
        String token = jwtTokenService.mintToken(regularUser);

        mockMvc.perform(get("/api/admin/secret")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isForbidden());
    }

    @Test
    void adminSecret_withAdminToken_shouldReturn200() throws Exception {
        // Admin user — has both ROLE_USER and ROLE_ADMIN
        UserPrincipal adminUser = new UserPrincipal(
                "google:admin1", "Admin Alice", "admin@example.com", "google",
                List.of("ROLE_USER", "ROLE_ADMIN")
        );
        String token = jwtTokenService.mintToken(adminUser);

        mockMvc.perform(get("/api/admin/secret")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.secret").value("You have admin access!"))
                .andExpect(jsonPath("$.grantedTo").value("google:admin1"));
    }
}
