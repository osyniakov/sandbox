package com.example.oauthplayground.config;

import com.example.oauthplayground.security.FederatedIdentityAuthenticationSuccessHandler;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.core.convert.converter.Converter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.web.SecurityFilterChain;

/**
 * Security configuration demonstrating two distinct Spring Security filter chains:
 *
 * Chain 1 — API (stateless, JWT):
 *   Matches /api/** requests.
 *   Expects a Bearer JWT in the Authorization header.
 *   Validates the JWT signature using the RSA public key from JwtConfig.
 *   No session is created (STATELESS).
 *
 * Chain 2 — Browser / OAuth2 Login (stateful for the login flow itself):
 *   Handles all other requests.
 *   Supports federated login via Google and GitHub (OAuth2 Authorization Code flow).
 *   On success, FederatedIdentityAuthenticationSuccessHandler issues a JWT and returns it.
 *   Public routes (/public/**, /actuator/health) are open.
 *
 * Why two chains?
 *   Separating API and browser concerns is a best practice:
 *   - API clients use stateless Bearer tokens (no cookies/sessions).
 *   - Browser clients need the OAuth2 redirect dance (temporary session during login).
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private final FederatedIdentityAuthenticationSuccessHandler successHandler;
    private final Converter<Jwt, AbstractAuthenticationToken> jwtAuthenticationConverter;

    public SecurityConfig(
            FederatedIdentityAuthenticationSuccessHandler successHandler,
            Converter<Jwt, AbstractAuthenticationToken> jwtAuthenticationConverter) {
        this.successHandler = successHandler;
        this.jwtAuthenticationConverter = jwtAuthenticationConverter;
    }

    /**
     * Chain 1: Stateless JWT Resource Server for /api/** endpoints.
     *
     * Higher @Order means this chain is evaluated first.
     * If the request does NOT match /api/**, Spring falls through to Chain 2.
     */
    @Bean
    @Order(1)
    public SecurityFilterChain apiSecurityFilterChain(HttpSecurity http) throws Exception {
        http
                .securityMatcher("/api/**")
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/api/admin/**").hasAuthority("ROLE_ADMIN")
                        .anyRequest().authenticated()
                )
                // Validate Bearer JWT tokens using the JwtDecoder bean from JwtConfig.
                // jwtAuthenticationConverter maps our custom "roles" claim to Spring authorities.
                .oauth2ResourceServer(rs -> rs.jwt(jwt ->
                        jwt.jwtAuthenticationConverter(jwtAuthenticationConverter)))
                // No sessions for API calls — each request must present a valid JWT
                .sessionManagement(session ->
                        session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                // Disable CSRF for stateless API (JWT prevents CSRF by design)
                .csrf(csrf -> csrf.disable());

        return http.build();
    }

    /**
     * Chain 2: OAuth2 Login chain for browser-based flows.
     *
     * Handles the full Authorization Code flow:
     *   GET /oauth2/authorization/google  → redirect to Google
     *   GET /login/oauth2/code/google     → handle callback, issue JWT
     */
    @Bean
    @Order(2)
    public SecurityFilterChain oauth2LoginSecurityFilterChain(HttpSecurity http) throws Exception {
        http
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/public/**", "/actuator/health").permitAll()
                        .anyRequest().authenticated()
                )
                .oauth2Login(oauth2 -> oauth2
                        // After successful OAuth2 login: issue JWT and return as JSON
                        .successHandler(successHandler)
                );

        return http.build();
    }
}
