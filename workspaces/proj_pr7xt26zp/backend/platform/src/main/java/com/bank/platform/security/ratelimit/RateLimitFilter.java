package com.bank.platform.security.ratelimit;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;
import java.util.Map;

/**
 * Fixed-window per-IP rate limiter using Redis. The {@code /api/v1/auth/*}
 * routes use a stricter bucket than everything else. Returns 429 with a
 * problem+json body when the limit is exceeded.
 */
@Component
public class RateLimitFilter extends OncePerRequestFilter {

    private static final String AUTH_BUCKET_PREFIX = "rl:auth:";
    private static final String DEFAULT_BUCKET_PREFIX = "rl:default:";

    private final RateLimitProperties props;
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;

    public RateLimitFilter(RateLimitProperties props, StringRedisTemplate redis, ObjectMapper mapper) {
        this.props = props;
        this.redis = redis;
        this.mapper = mapper;
    }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request,
                                    @NonNull HttpServletResponse response,
                                    @NonNull FilterChain chain) throws ServletException, IOException {
        if (!props.enabled()) {
            chain.doFilter(request, response);
            return;
        }
        String ip = clientIp(request);
        String path = request.getRequestURI();
        boolean isAuth = path.startsWith("/api/v1/auth/");
        int limit = isAuth ? props.authRequestsPerMinute() : props.defaultRequestsPerMinute();
        String bucket = (isAuth ? AUTH_BUCKET_PREFIX : DEFAULT_BUCKET_PREFIX) + ip;

        Long current = redis.opsForValue().increment(bucket);
        if (current != null && current == 1L) {
            redis.expire(bucket, Duration.ofMinutes(1));
        }
        long remaining = Math.max(0, limit - (current == null ? 0 : current));
        response.setHeader("X-Rate-Limit-Limit", String.valueOf(limit));
        response.setHeader("X-Rate-Limit-Remaining", String.valueOf(remaining));

        if (current != null && current > limit) {
            response.setStatus(429);
            response.setContentType("application/problem+json");
            mapper.writeValue(response.getOutputStream(), Map.of(
                "type", "about:blank",
                "title", "Too Many Requests",
                "status", 429,
                "detail", "Rate limit exceeded; retry after 60 seconds"
            ));
            return;
        }
        chain.doFilter(request, response);
    }

    private String clientIp(HttpServletRequest req) {
        String xff = req.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            int comma = xff.indexOf(',');
            return (comma > 0 ? xff.substring(0, comma) : xff).trim();
        }
        return req.getRemoteAddr();
    }
}
