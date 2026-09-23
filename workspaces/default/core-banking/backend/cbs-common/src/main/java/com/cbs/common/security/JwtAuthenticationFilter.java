package com.cbs.common.security;

import com.cbs.common.context.RequestContext;
import com.cbs.common.context.RequestContextHolder;
import com.cbs.common.error.GlobalExceptionHandler;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jws;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import lombok.Getter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.crypto.SecretKey;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Collection;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * JWT authentication filter. Validates the bearer token, extracts the
 * claims and creates a {@link UsernamePasswordAuthenticationToken} with
 * the authorities ({@code PERM_*} strings) as granted authorities.
 */
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final SecretKey signingKey;
    private final ObjectMapper objectMapper;
    private final GlobalExceptionHandler globalExceptionHandler;
    @Getter
    private final Duration accessTokenTtl;

    public JwtAuthenticationFilter(
            @Value("${app.security.jwt.secret}") String secret,
            @Value("${app.security.jwt.access-token-ttl-minutes:15}") long accessTokenTtlMinutes,
            ObjectMapper objectMapper,
            GlobalExceptionHandler globalExceptionHandler) {
        if (secret == null || secret.length() < 32) {
            throw new IllegalStateException("app.security.jwt.secret must be at least 32 chars");
        }
        this.signingKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.accessTokenTtl = Duration.ofMinutes(accessTokenTtlMinutes);
        this.objectMapper = objectMapper;
        this.globalExceptionHandler = globalExceptionHandler;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header == null || !header.startsWith("Bearer ")) {
            filterChain.doFilter(request, response);
            return;
        }
        String token = header.substring(7);
        try {
            Jws<Claims> jws = Jwts.parser().verifyWith(signingKey).build().parseSignedClaims(token);
            Claims claims = jws.getPayload();
            String subject = claims.getSubject();
            UUID userId = UUID.fromString(claims.get("uid", String.class));
            UUID branchId = claims.get("bid") == null ? null : UUID.fromString(claims.get("bid", String.class));
            @SuppressWarnings("unchecked")
            List<String> permissions = (List<String>) claims.getOrDefault("perms", List.of());

            Collection<GrantedAuthority> authorities = permissions.stream()
                    .map(p -> (GrantedAuthority) new SimpleGrantedAuthority("PERM_" + p))
                    .collect(Collectors.toList());

            AuthenticatedUser principal = new AuthenticatedUser(userId, subject, branchId, permissions);
            UsernamePasswordAuthenticationToken auth =
                    new UsernamePasswordAuthenticationToken(principal, null, authorities);

            SecurityContextHolder.getContext().setAuthentication(auth);
            RequestContextHolder.set(new RequestContext(
                    userId, subject, branchId, permissions, request.getRemoteAddr()));
        } catch (JwtException | IllegalArgumentException ex) {
            SecurityContextHolder.clearContext();
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json");
            GlobalExceptionHandler.ApiError error = GlobalExceptionHandler.ApiError.builder()
                    .timestamp(Instant.now())
                    .status(401)
                    .code("INVALID_TOKEN")
                    .message("JWT validation failed: " + ex.getMessage())
                    .path(request.getRequestURI())
                    .build();
            response.getWriter().write(objectMapper.writeValueAsString(error));
            return;
        }
        try {
            filterChain.doFilter(request, response);
        } finally {
            SecurityContextHolder.clearContext();
            RequestContextHolder.clear();
        }
    }

    public String createAccessToken(UUID userId, String username, UUID branchId, List<String> permissions) {
        Instant now = Instant.now();
        Instant exp = now.plus(accessTokenTtl);
        return Jwts.builder()
                .subject(username)
                .claim("uid", userId.toString())
                .claim("bid", branchId == null ? null : branchId.toString())
                .claim("perms", permissions)
                .issuedAt(Date.from(now))
                .expiration(Date.from(exp))
                .signWith(signingKey)
                .compact();
    }

    public Claims parseAndValidate(String token) {
        return Jwts.parser().verifyWith(signingKey).build().parseSignedClaims(token).getPayload();
    }
}
