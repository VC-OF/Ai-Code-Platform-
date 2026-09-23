package com.cbs.common.api;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.springframework.core.annotation.AliasFor;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Convenience meta-annotation for CBS REST controllers.
 * All controllers should be annotated with {@code @CbsController} and
 * return {@link ApiResponse} / {@link PageResponse} envelopes.
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@RestController
@RequestMapping("/api/v1")
public @interface CbsController {
    @AliasFor(annotation = RequestMapping.class, attribute = "path")
    String[] value() default {};
}
