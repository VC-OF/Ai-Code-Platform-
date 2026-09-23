package com.bank.platform.api.dto;

import java.util.List;

/**
 * Generic paginated response envelope. Carries the page metadata plus the
 * raw content list.
 */
public record PageResponse<T>(
        List<T> content,
        long totalElements,
        int totalPages,
        int page,
        int size,
        boolean hasNext,
        boolean hasPrevious,
        Sort sort
) {
    public record Sort(String property, String direction) {}
}
