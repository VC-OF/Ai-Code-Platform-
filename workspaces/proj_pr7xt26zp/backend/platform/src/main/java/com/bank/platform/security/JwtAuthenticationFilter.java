package com.bank.platform.security;

import com.bank.platform.security.jwt.JwtTokenService;
import com.bank.platform.security.jwt.ParsedToken;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Claims;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Extracts a Bearer JWT from the Authorization header, validates it and
 * populates the SecurityContext with an {@link AuthenticatedUser} principal.
 * Invalid tokens yield 401 with a problem+json body.
 */
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(JwtAuthenticationFilter.class);
    private static final String BEARER = "Bearer ";

    private final JwtTokenService tokens;
    private final ObjectMapper objectMapper;

    public JwtAuthenticationFilter(JwtTokenService tokens, ObjectMapper objectMapper) {
        this.tokens = tokens;
        this.objectMapper = objectMapper;
    }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request,
                                    @NonNull HttpServletResponse response,
                                    @NonNull FilterChain chain) throws ServletException, IOException {
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (header == null || !header.startsWith(BEARER)) {
            chain.doFilter(request, response);
            return;
        }
        String token = header.substring(BEARER.length()).trim();
        try {
            ParsedToken parsed = tokens.parse(token);
            Claims claims = parsed.claims();
            if (!"access".equals(parsed.type())) {
                throw new IllegalStateException("Wrong token type: " + parsed.type());
            }
            AuthenticatedUser user = new AuthenticatedUser(
                parsed.subject(),
                UUID.fromString(claims.get("tenant", String.class)),
                claims.get("branch", String.class) != null
                    ? UUID.fromString(claims.get("branch", String.class)) : null,
                claims.get("username", String.class),
                claims.get("displayName", String.class),
                claims.get("email", String.class),
                asList(claims, "roles"),
                asList(claims, "perms"),
                Boolean.TRUE.equals(claims.get("mfa", Boolean.class)),
                true
            );
            UsernamePasswordAuthenticationToken auth =
                new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities());
            auth.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
            SecurityContextHolder.getContext().setAuthentication(auth);
            chain.doFilter(request, response);
        } catch (Exception ex) {
            log.debug("JWT validation failed: {}", ex.getMessage());
            SecurityContextHolder.clearContext();
            writeUnauthorized(response, ex.getMessage());
        }
    }

    private void writeUnauthorized(HttpServletResponse response, String detail) throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        Map<String, Object> body = Map.of(
            "type", "about:blank",
            "title", "Unauthorized",
            "status", 401,
            "detail", detail
        );
        objectMapper.writeValue(response.getOutputStream(), body);
    }

    @SuppressWarnings("unchecked")
    private static List<String> asList(Claims claims, String name) {
        Object v = claims.get(name);
        if (v instanceof List<?> l) {
            return l.stream().map(Object::toString).toList();
        }
        return List.of();
    }
}
