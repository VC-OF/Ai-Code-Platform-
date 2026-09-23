package com.bank.platform.config;

import com.bank.platform.security.CurrentUser;
import org.springframework.data.domain.AuditorAware;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;

import java.util.Optional;

/**
 * Provides the auditor used by JPA auditing ({@code @CreatedBy},
 * {@code @LastModifiedBy}). The value is the current user's username, or
 * "system" if there is no authenticated user.
 */
@Configuration
@EnableJpaAuditing
public class JpaAuditingConfig {

    @Bean
    AuditorAware<String> auditorProvider(CurrentUser currentUser) {
        return () -> currentUser.get().map(u -> u.getUsername()).or(() -> Optional.of("system"));
    }
}
