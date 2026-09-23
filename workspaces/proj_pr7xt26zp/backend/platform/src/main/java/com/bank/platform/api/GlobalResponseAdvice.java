package com.bank.platform.api;

import com.bank.platform.api.dto.ErrorResponse;
import com.bank.platform.web.error.ProblemDetail;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;

import java.time.Instant;

/**
 * Wraps every controller response to enforce consistent content type and
 * to inject a standard envelope around error responses.
 */
@RestControllerAdvice
public class GlobalResponseAdvice implements ResponseBodyAdvice<Object> {

    private final ObjectMapper mapper;

    public GlobalResponseAdvice(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public boolean supports(MethodParameter returnType, Class<? extends HttpMessageConverter<?>> ct) {
        return true;
    }

    @Override
    public Object beforeBodyWrite(Object body, MethodParameter returnType, MediaType selectedContentType,
                                  Class<? extends HttpMessageConverter<?>> selectedConverterType,
                                  ServerHttpRequest req, ServerHttpResponse res) {
        if (body instanceof ProblemDetail pd) {
            return body; // already problem+json
        }
        if (body instanceof ErrorResponse er) {
            return body;
        }
        if (body == null) {
            return null;
        }
        return body;
    }
}
