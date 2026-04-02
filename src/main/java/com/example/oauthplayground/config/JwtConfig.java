package com.example.oauthplayground.config;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;

import java.util.UUID;

/**
 * JWT infrastructure beans.
 *
 * An RSA key pair is generated fresh on every startup — no files or config needed.
 * The same key pair is used for both signing (JwtEncoder) and verification (JwtDecoder),
 * which is the typical setup for a self-contained authorization server.
 *
 * Key concepts demonstrated:
 *   - Asymmetric signing: private key signs, public key verifies
 *   - JWKSet: JSON Web Key Set, the standard way to publish public keys
 *   - NimbusJwtEncoder / NimbusJwtDecoder: Spring Security's built-in JWT support
 */
@Configuration
public class JwtConfig {

    /**
     * Generates a 2048-bit RSA key pair at application startup.
     * In production you'd load a stable key from a secrets manager.
     */
    @Bean
    public RSAKey rsaKey() throws JOSEException {
        return new RSAKeyGenerator(2048)
                .keyID(UUID.randomUUID().toString())
                .generate();
    }

    /**
     * JwtEncoder uses the private key to sign JWTs we issue after federated login.
     */
    @Bean
    public JwtEncoder jwtEncoder(RSAKey rsaKey) {
        return new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(rsaKey)));
    }

    /**
     * JwtDecoder uses the public key to verify incoming Bearer JWTs on /api/** endpoints.
     */
    @Bean
    public JwtDecoder jwtDecoder(RSAKey rsaKey) throws JOSEException {
        return NimbusJwtDecoder.withPublicKey(rsaKey.toRSAPublicKey()).build();
    }

    /**
     * Maps our custom "roles" claim in the JWT to Spring Security GrantedAuthority objects.
     *
     * By default, Spring Security's JwtGrantedAuthoritiesConverter reads the "scope" or "scp"
     * claim and prefixes each value with "SCOPE_". Our JWTs use a "roles" claim instead,
     * and we want authorities like "ROLE_USER", "ROLE_ADMIN" (no prefix added).
     *
     * This converter is wired into the Resource Server filter chain in SecurityConfig.
     */
    @Bean
    public Converter<Jwt, AbstractAuthenticationToken> jwtAuthenticationConverter() {
        JwtGrantedAuthoritiesConverter authoritiesConverter = new JwtGrantedAuthoritiesConverter();
        authoritiesConverter.setAuthoritiesClaimName("roles");
        authoritiesConverter.setAuthorityPrefix("");   // roles already include ROLE_ prefix

        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(authoritiesConverter);
        return converter;
    }
}
