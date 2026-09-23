package com.cbs.common.api;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springdoc.core.annotations.ParameterObject;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.web.bind.annotation.RequestParam;

/**
 * Default pagination/sort parameters injected into controllers.
 */
@ParameterObject
public record PageRequestParams(
        @RequestParam(defaultValue = "0") @Min(0) int page,
        @RequestParam(defaultValue = "20") @Min(1) @Max(200) int size,
        @RequestParam(required = false) String sort,
        @RequestParam(defaultValue = "asc") String direction
) {
    public PageRequest toPageable() {
        Sort.Direction dir = "desc".equalsIgnoreCase(direction) ? Sort.Direction.DESC : Sort.Direction.ASC;
        Sort s = (sort == null || sort.isBlank()) ? Sort.unsorted() : Sort.by(dir, sort);
        return PageRequest.of(page, size, s);
    }
}
