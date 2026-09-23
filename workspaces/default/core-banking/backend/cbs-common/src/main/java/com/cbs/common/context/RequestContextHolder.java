package com.cbs.common.context;

/**
 * Thread-local holder for the current request context.
 * Cleared by the {@code JwtAuthenticationFilter} on completion.
 */
public final class RequestContextHolder {

    private static final ThreadLocal<RequestContext> HOLDER = new ThreadLocal<>();

    private RequestContextHolder() {
    }

    public static void set(RequestContext ctx) {
        HOLDER.set(ctx);
    }

    public static RequestContext get() {
        return HOLDER.get();
    }

    public static RequestContext require() {
        RequestContext ctx = HOLDER.get();
        if (ctx == null) {
            throw new IllegalStateException("No request context bound to current thread");
        }
        return ctx;
    }

    public static void clear() {
        HOLDER.remove();
    }
}
