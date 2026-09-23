package com.cbs.common.config;

import com.cbs.common.audit.AuditLogger;
import com.cbs.common.error.GlobalExceptionHandler;
import com.cbs.common.ratelimit.RateLimitFilter;
import com.cbs.common.security.JwtAuthenticationFilter;
import com.cbs.common.security.SecurityConfig;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Import;

@AutoConfiguration
@ComponentScan(basePackageClasses = {
        SecurityConfig.class,
        JwtAuthenticationFilter.class,
        RateLimitFilter.class,
        GlobalExceptionHandler.class,
        AuditLogger.class
})
@Import({JacksonConfig.class, OpenApiConfig.class})
public class CommonAutoConfiguration {
}
