package com.cbs.common.api;

import com.cbs.kernel.domain.util.Page;
import com.cbs.kernel.domain.util.PageQuery;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Component;

/**
 * Translates domain {@link PageQuery} to Spring Data
 * {@link PageRequest}.
 */
@Component
public class PageMapper {

    public PageRequest toPageable(PageQuery q) {
        Sort.Direction dir = q.direction() == PageQuery.SortDirection.ASC ? Sort.Direction.ASC : Sort.Direction.DESC;
        Sort sort = q.sort() == null || q.sort().isBlank()
                ? Sort.unsorted()
                : Sort.by(dir, q.sort());
        return PageRequest.of(q.page(), q.size(), sort);
    }

    public <T> PageResponse<T> toResponse(org.springframework.data.domain.Page<T> page) {
        return PageResponse.of(
                page.getContent(),
                page.getNumber(),
                page.getSize(),
                page.getTotalElements()
        );
    }

    public <T> Page<T> toDomain(org.springframework.data.domain.Page<T> page) {
        return Page.of(
                page.getContent(),
                page.getNumber(),
                page.getSize(),
                page.getTotalElements()
        );
    }
}
