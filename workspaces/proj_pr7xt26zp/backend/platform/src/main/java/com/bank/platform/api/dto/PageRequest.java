package com.bank.platform.api.dto;

import java.util.List;

/**
 * Generic page query parameters exposed in the URL. Validated by the
 * controller using {@code @Valid}.
 */
public record PageRequest(
        int page,
        int size,
        String sortBy,
        String sortDirection,
        String search
) {
    public static final int MAX_SIZE = 200;

    public PageRequest {
        if (page < 0) page = 0;
        if (size <= 0 || size > MAX_SIZE) size = 20;
        if (sortDirection == null || sortDirection.isBlank()) sortDirection = "asc";
        else sortDirection = sortDirection.toLowerCase();
        if (sortBy == null || sortBy.isBlank()) sortBy = "createdAt";
        if (search != null) search = search.trim();
    }

    public boolean hasSearch() {
        return search != null && !search.isBlank();
    }

    public org.springframework.data.domain.PageRequest toSpringPageRequest() {
        org.springframework.data.domain.Sort.Direction dir =
            "desc".equals(sortDirection)
                ? org.springframework.data.domain.Sort.Direction.DESC
                : org.springframework.data.domain.Sort.Direction.ASC;
        return org.springframework.data.domain.PageRequest.of(
            page, size, org.springframework.data.domain.Sort.by(dir, sortBy));
    }

    public static org.springframework.data.domain.Pageable toPageable(
            int page, int size, String sortBy, String sortDirection) {
        return new PageRequest(page, size, sortBy, sortDirection, null).toSpringPageRequest();
    }
}
