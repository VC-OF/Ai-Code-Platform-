package com.bank.identity.config;

import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@Configuration
@ComponentScan(basePackages = "com.bank.identity")
@EntityScan(basePackages = "com.bank.identity.domain")
@EnableJpaRepositories(basePackages = "com.bank.identity.repository")
public class IdentityAutoConfiguration {
}
