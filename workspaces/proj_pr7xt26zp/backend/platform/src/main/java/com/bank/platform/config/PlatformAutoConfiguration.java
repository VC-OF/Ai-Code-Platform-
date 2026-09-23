package com.bank.platform.config;

import com.bank.platform.security.jwt.JwtProperties;
import com.bank.platform.security.ratelimit.RateLimitProperties;
import com.bank.platform.web.cors.CorsProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.transaction.annotation.EnableTransactionManagement;

@Configuration
@EnableAsync
@EnableTransactionManagement
@EnableConfigurationProperties({
        JwtProperties.class,
        RateLimitProperties.class,
        CorsProperties.class
})
public class PlatformAutoConfiguration {
}
