package com.cbs.kernel.domain.util;

import java.util.List;
import java.util.Set;

/**
 * Generic page query with sort and filter support. Used at the application
 * boundary to translate HTTP query params into a domain query.
 */
public record PageQuery(
        int page,
        int size,
        String sort,
        SortDirection direction,
        List<Filter> filters
) {
    public static final int MAX_PAGE_SIZE = 200;
    public static final Set<String> SORT_FIELDS = Set.of();

    public PageQuery {
        if (page < 0) page = 0;
        if (size <= 0) size = 20;
        if (size > MAX_PAGE_SIZE) size = MAX_PAGE_SIZE;
        if (direction == null) direction = SortDirection.ASC;
        if (filters == null) filters = List.of();
    }

    public static PageQuery of(int page, int size) {
        return new PageQuery(page, size, null, SortDirection.ASC, List.of());
    }

    public enum SortDirection {
        ASC, DESC
    }

    public record Filter(String field, String operator, String value) {
        public enum Op {
            EQ("eq"), NEQ("neq"), LIKE("like"), GT("gt"), GTE("gte"), LT("lt"), LTE("lte"), IN("in");

            private final String code;
            Op(String code) { this.code = code; }
            public String code() { return code; }
        }
    }
}
