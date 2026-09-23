package com.bank.platform.security.jwt;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Configuration for JWT signing. The HMAC secret must be at least 32 bytes
 * (256 bits) for HS256.
 */
@ConfigurationProperties(prefix = "security.jwt")
public record JwtProperties(
        String issuer,
        String audience,
        String hmacSecret,
        long accessTokenTtlSeconds,
        long refreshTokenTtlSeconds,
        long mfaTokenTtlSeconds
) {
    public JwtProperties {
        if (issuer == null || issuer.isBlank()) {
            issuer = "banking-platform";
        }
        if (audience == null || audience.isBlank()) {
            audience = "banking-clients";
        }
        if (hmacSecret == null || hmacSecret.getBytes().length < 32) {
            throw new IllegalStateException(
                "security.jwt.hmac-secret must be at least 32 bytes");
        }
        if (accessTokenTtlSeconds <= 0) {
            accessTokenTtlSeconds = 900; // 15 minutes
        }
        if (refreshTokenTtlSeconds <= 0) {
            refreshTokenTtlSeconds = 1209600; // 14 days
        }
        if (mfaTokenTtlSeconds <= 0) {
            mfaTokenTtlSeconds = 300; // 5 minutes
        }
    }
}
