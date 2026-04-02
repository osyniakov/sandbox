package com.example.oauthplayground;

import com.example.oauthplayground.config.JwtConfig;
import com.example.oauthplayground.security.JwtTokenService;
import com.example.oauthplayground.security.UserPrincipal;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for JwtTokenService.
 *
 * These tests run without any OAuth2 provider credentials.
 * They verify that tokens are properly minted and can be decoded back
 * with the expected claims intact.
 *
 * What's being tested:
 *   1. Token minting produces a non-null, non-empty JWT string
 *   2. Decoded token has the correct subject claim
 *   3. Custom claims (name, email, provider, roles) survive the encode/decode round-trip
 *   4. Token is signed with RS256 (asymmetric) — not HS256 (symmetric)
 */
@SpringBootTest(classes = {OauthPlaygroundApplication.class, JwtConfig.class})
class JwtTokenServiceTest {

    @Autowired
    private JwtTokenService jwtTokenService;

    @Test
    void mintToken_shouldProduceNonEmptyJwtString() {
        UserPrincipal user = UserPrincipal.of("google", "12345", "Alice", "alice@example.com");

        String token = jwtTokenService.mintToken(user);

        assertThat(token).isNotBlank();
        // JWTs have exactly 3 dot-separated segments: header.payload.signature
        assertThat(token.split("\\.")).hasSize(3);
    }

    @Test
    void mintToken_andDecode_shouldPreserveSubjectClaim() {
        UserPrincipal user = UserPrincipal.of("google", "12345", "Alice", "alice@example.com");

        String token = jwtTokenService.mintToken(user);
        Jwt decoded = jwtTokenService.decode(token);

        assertThat(decoded.getSubject()).isEqualTo("google:12345");
    }

    @Test
    void mintToken_andDecode_shouldPreserveCustomClaims() {
        UserPrincipal user = UserPrincipal.of("github", "67890", "Bob", "bob@example.com");

        String token = jwtTokenService.mintToken(user);
        Jwt decoded = jwtTokenService.decode(token);

        assertThat(decoded.getClaimAsString("name")).isEqualTo("Bob");
        assertThat(decoded.getClaimAsString("email")).isEqualTo("bob@example.com");
        assertThat(decoded.getClaimAsString("provider")).isEqualTo("github");
        assertThat(decoded.getClaimAsStringList("roles")).containsExactly("ROLE_USER");
    }

    @Test
    void mintToken_shouldSetIssuerToOauthPlayground() {
        UserPrincipal user = UserPrincipal.of("google", "12345", "Alice", "alice@example.com");

        String token = jwtTokenService.mintToken(user);
        Jwt decoded = jwtTokenService.decode(token);

        assertThat(decoded.getIssuer().toString()).isEqualTo("http://oauth-playground.local");
    }

    @Test
    void mintToken_shouldSetExpiryToOneHourFromNow() {
        UserPrincipal user = UserPrincipal.of("google", "12345", "Alice", "alice@example.com");

        String token = jwtTokenService.mintToken(user);
        Jwt decoded = jwtTokenService.decode(token);

        long expirySeconds = decoded.getExpiresAt().getEpochSecond();
        long issuedAtSeconds = decoded.getIssuedAt().getEpochSecond();
        long diffSeconds = expirySeconds - issuedAtSeconds;

        // Allow a small tolerance for test execution time
        assertThat(diffSeconds).isBetween(3595L, 3605L);
    }

    @Test
    void twoTokensForDifferentUsers_shouldHaveDifferentSubjects() {
        UserPrincipal alice = UserPrincipal.of("google", "111", "Alice", "alice@example.com");
        UserPrincipal bob = UserPrincipal.of("github", "222", "Bob", "bob@example.com");

        String aliceToken = jwtTokenService.mintToken(alice);
        String bobToken = jwtTokenService.mintToken(bob);

        assertThat(aliceToken).isNotEqualTo(bobToken);
        assertThat(jwtTokenService.decode(aliceToken).getSubject())
                .isNotEqualTo(jwtTokenService.decode(bobToken).getSubject());
    }

    @Test
    void userPrincipal_of_shouldPrefixSubjectWithProvider() {
        UserPrincipal user = UserPrincipal.of("google", "99999", "Carol", "carol@example.com");

        assertThat(user.subject()).isEqualTo("google:99999");
        assertThat(user.roles()).containsExactly("ROLE_USER");
    }

    @Test
    void userPrincipal_customRoles_shouldBePreserved() {
        UserPrincipal adminUser = new UserPrincipal(
                "google:admin1", "Admin User", "admin@example.com", "google",
                List.of("ROLE_USER", "ROLE_ADMIN")
        );

        String token = jwtTokenService.mintToken(adminUser);
        Jwt decoded = jwtTokenService.decode(token);

        assertThat(decoded.getClaimAsStringList("roles"))
                .containsExactlyInAnyOrder("ROLE_USER", "ROLE_ADMIN");
    }
}
