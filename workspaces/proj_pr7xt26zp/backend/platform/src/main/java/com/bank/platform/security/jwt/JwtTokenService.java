package com.bank.platform.security.jwt;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jws;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Issues and validates HMAC-SHA256 signed JWTs. Access tokens carry the
 * subject (userId), tenantId, roles and an immutable token identifier (jti).
 */
@Component
public class JwtTokenService {

    private final JwtProperties props;
    private final SecretKey signingKey;

    public JwtTokenService(JwtProperties props) {
        this.props = props;
        this.signingKey = Keys.hmacShaKeyFor(props.hmacSecret().getBytes(StandardCharsets.UTF_8));
    }

    public IssuedToken issueAccessToken(UUID userId,
                                        UUID tenantId,
                                        String username,
                                        List<String> roles,
                                        List<String> permissions,
                                        UUID branchId) {
        Instant now = Instant.now();
        Instant exp = now.plusSeconds(props.accessTokenTtlSeconds());
        Map<String, Object> claims = new HashMap<>();
        claims.put("typ", "access");
        claims.put("tenant", tenantId.toString());
        claims.put("roles", roles);
        claims.put("perms", permissions);
        if (branchId != null) {
            claims.put("branch", branchId.toString());
        }
        String token = Jwts.builder()
            .id(UUID.randomUUID().toString())
            .issuer(props.issuer())
            .audience().add(props.audience()).and()
            .subject(userId.toString())
            .issuedAt(Date.from(now))
            .expiration(Date.from(exp))
            .claims(claims)
            .signWith(signingKey, Jwts.SIG.HS256)
            .compact();
        return new IssuedToken(token, exp);
    }

    public IssuedToken issueRefreshToken(UUID userId, String username) {
        Instant now = Instant.now();
        Instant exp = now.plusSeconds(props.refreshTokenTtlSeconds());
        String token = Jwts.builder()
            .id(UUID.randomUUID().toString())
            .issuer(props.issuer())
            .audience().add(props.audience()).and()
            .subject(userId.toString())
            .claim("typ", "refresh")
            .claim("username", username)
            .issuedAt(Date.from(now))
            .expiration(Date.from(exp))
            .signWith(signingKey, Jwts.SIG.HS256)
            .compact();
        return new IssuedToken(token, exp);
    }

    public IssuedToken issueMfaToken(UUID userId, String username) {
        Instant now = Instant.now();
        Instant exp = now.plusSeconds(props.mfaTokenTtlSeconds());
        String token = Jwts.builder()
            .id(UUID.randomUUID().toString())
            .issuer(props.issuer())
            .audience().add(props.audience()).and()
            .subject(userId.toString())
            .claim("typ", "mfa")
            .claim("username", username)
            .issuedAt(Date.from(now))
            .expiration(Date.from(exp))
            .signWith(signingKey, Jwts.SIG.HS256)
            .compact();
        return new IssuedToken(token, exp);
    }

    public ParsedToken parse(String token) {
        try {
            Jws<Claims> jws = Jwts.parser()
                .verifyWith(signingKey)
                .requireIssuer(props.issuer())
                .build()
                .parseSignedClaims(token);
            Claims c = jws.getPayload();
            return new ParsedToken(
                UUID.fromString(c.getSubject()),
                c.getId(),
                c.get("typ", String.class),
                c.getExpiration().toInstant(),
                c
            );
        } catch (JwtException | IllegalArgumentException e) {
            throw new InvalidTokenException("Invalid or expired token", e);
        }
    }

    public record IssuedToken(String value, Instant expiresAt) {}

    public record ParsedToken(UUID subject, String jti, String type,
                              Instant expiresAt, Claims claims) {}
}
