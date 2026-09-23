package com.bank.platform.security.ratelimit;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Configured via {@code security.rate-limit.*}.
 *
 * <p>Limits are expressed as a fixed number of requests per second per
 * (client IP, route bucket) tuple.
 */
@ConfigurationProperties(prefix = "security.rate-limit")
public record RateLimitProperties(
        boolean enabled,
        int defaultRequestsPerMinute,
        int authRequestsPerMinute
) {
    public RateLimitProperties {
        if (defaultRequestsPerMinute <= 0) defaultRequestsPerMinute = 120;
        if (authRequestsPerMinute <= 0) authRequestsPerMinute = 10;
    }
}
